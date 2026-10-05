"""Isolated Chromium: both sides observe one real library page; originals stay unchanged."""
import base64
import hashlib
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session

def main():
    with tempfile.TemporaryDirectory(prefix='pd-workspace-source-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() + '\nglobalThis.agentTestDispatch = dispatchAgentOperation;\n')
        with extension_session('pd-workspace-page-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            # Stable offline fixture; canvas recording can miss frames in headless Chrome.
            # ffmpeg -f lavfi -i testsrc2=size=320x180:rate=12 -t 2.4 -c:v libx264
            #   -preset veryslow -crf 35 -pix_fmt yuv420p -movflags +faststart review-workspace-smoke.mp4
            original_video = list((Path(__file__).parent / 'fixtures/review-workspace-smoke.mp4').read_bytes())
            png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW6kAAAAASUVORK5CYII=')
            assets=[{'id':'image-one','kind':'image','storageMode':'managed','mimeType':'image/png','width':1,'height':1,'byteSize':len(png)},
                    {'id':'image-two','kind':'image','storageMode':'managed','mimeType':'image/png','width':1,'height':1,'byteSize':len(png)},
                    {'id':'video-one','kind':'video','storageMode':'managed','mimeType':'video/mp4','width':320,'height':180,'durationMs':2400,'byteSize':len(original_video)}]
            run.seed_storage(page,{'entries':[{'id':'case-one','title':'同步审片案例','text':'原始资料原文保持','url':'https://example.com/source','savedAt':'2026-10-01T00:00:00Z','mediaAssets':assets,'primaryMediaId':'image-one','customLabels':['人工标签']}]})
            page.evaluate("""async ({png,video})=>{const {saveMediaBlob}=await import('./media-store.js');
                for(const id of ['image-one','image-two'])await saveMediaBlob(id,new Blob([new Uint8Array(png)],{type:'image/png'}));
                await saveMediaBlob('video-one',new Blob([new Uint8Array(video)],{type:'video/mp4'}));}""",{'png':list(png),'video':original_video})
            page.reload(); expect(page.locator('.case-card')).to_have_count(1)
            worker=run.context.service_workers[0]
            def call(op,data={}):return worker.evaluate('([op,input])=>agentTestDispatch(op,input)',[op,data])
            current=call('read_live_workspace');assert current['state']=='ready',current
            tab_id=current['tabId']
            before=call('read_case_details',{'caseId':'case-one'})['revision']
            def snapshot():return call('read_live_workspace',{'tabId':tab_id})
            def command(action,**kwargs):
                current=snapshot()
                return call('control_workspace',{'requestId':'cmd-'+str(command.count),'tabId':tab_id,'expectedRevision':current['controlRevision'],'action':action,**kwargs})
            command.count=0
            def act(action,**kwargs):
                command.count+=1;return command(action,**kwargs)
            opened=act('open_case',caseId='case-one');assert opened['state']=='executed' and 'displayVerified' not in opened
            expect(page.locator('#detail-drawer')).to_be_visible()
            assert snapshot()['snapshot']['promptSource']=='shared'
            for label,key in [('当前媒体','media'),('原始提示词','shared')]:
                page.get_by_role('tab',name=label,exact=True).click()
                assert snapshot()['snapshot']['promptSource']==key
            waiting=snapshot()
            worker.evaluate("input => { self.pendingWorkspaceRead=agentTestDispatch('wait_workspace_changes',input); return true; }", {'tabId':tab_id,'afterRevision':waiting['revision'],'waitMs':15000})
            page.locator('.detail-visual-thumb').nth(1).click()
            changes=worker.evaluate('() => self.pendingWorkspaceRead');assert changes['revision']!=waiting['revision'];assert not changes['reset']
            assert any(event['source']=='human' for event in changes['changes'])
            page.wait_for_function("() => document.querySelector('.detail-visual-gallery').dataset.displayedAssetId==='image-two'")
            assert snapshot()['snapshot']['viewedAssetId']=='image-two'
            stale=snapshot()
            page.locator('.detail-visual-thumb').nth(0).click()
            page.wait_for_function("() => document.querySelector('.detail-visual-gallery').dataset.displayedAssetId==='image-one'")
            rejected=worker.evaluate("""async input=>{try{return await agentTestDispatch('control_workspace',input)}catch(e){return {code:e.code}}}""",{'requestId':'stale','tabId':tab_id,'expectedRevision':stale['controlRevision'],'action':'select_media','assetId':'image-two'})
            assert rejected['code']=='workspace_changed',rejected
            assert snapshot()['snapshot']['viewedAssetId']=='image-one'
            layout=page.locator('#case-list').bounding_box()
            rejected=worker.evaluate("""async input=>{try{return await agentTestDispatch('control_workspace',input)}catch(e){return {error:e.message}}}""",{'requestId':'removed-candidates','tabId':tab_id,'expectedRevision':snapshot()['controlRevision'],'action':'present_candidates','caseIds':['case-one']})
            assert rejected.get('error'),rejected
            expect(page.locator('#agent-candidates')).to_have_count(0)
            assert page.locator('#case-list').bounding_box()==layout
            assert snapshot()['snapshot']['selectedCaseIds']==[]
            act('select_media',assetId='video-one');expect(page.locator('.detail-visual-stage video')).to_be_visible()
            download_drag=page.get_by_role('button',name='下载副本',exact=True).evaluate("""async button=>{
              const data=new DataTransfer();button.dispatchEvent(new DragEvent('dragstart',{dataTransfer:data,bubbles:true,cancelable:true}));
              const file=JSON.parse(data.getData('application/x-promptdirector-file'));
              return {caseId:data.getData('application/x-promptdirector-case'),bytes:Array.from(new Uint8Array(await (await fetch(file.url)).arrayBuffer()))};
            }""")
            assert download_drag['caseId']=='case-one';assert download_drag['bytes']==original_video
            try: act('set_review',enabled=True)
            except Exception:
                print({'playback_failure':page.locator('.detail-visual-stage video').evaluate('(v)=>({src:v.src,connected:v.isConnected,state:v.readyState,error:v.error&&{code:v.error.code,message:v.error.message}})')},flush=True)
                raise
            assert page.locator('.detail-primary > .detail-body').is_hidden()
            assert snapshot()['snapshot']['playback']['durationMs']>=2000
            assert snapshot()['snapshot']['mediaRead']=={'operation':'read_media','input':{'caseId':'case-one','assetId':'video-one'}}
            assert page.locator('.detail-visual-stage video').evaluate('(v)=>!v.draggable')
            assert page.locator('.detail-visual-stage video').evaluate('(v)=>!v.controls')
            assert page.locator('.detail-visual-stage .review-timeline input').count()==1
            assert page.locator('#detail-prev').is_hidden() and page.locator('#detail-next').is_hidden()
            assert page.locator('#add-menu #open-temporary-review').count()==1
            assert page.locator('#temporary-review-file').count()==1
            assert page.locator('.review-range-controls').evaluate('(bar)=>Boolean(bar.closest(".detail-visual-caption"))')
            act('seek',positionMs=800)
            page.wait_for_function("() => Math.abs(document.querySelector('.detail-visual-stage video').currentTime-.8)<.01")
            artifact_directory=os.environ.get('PD_E2E_ARTIFACT_DIR')
            if artifact_directory:
                Path(artifact_directory).mkdir(parents=True,exist_ok=True)
                page.screenshot(path=str(Path(artifact_directory)/'review.png'))
            # A trusted drag on the shared timeline seeks the video, not a case drag.
            player=page.locator('.detail-visual-stage video'); player.hover()
            box=page.locator('.review-timeline input').bounding_box(); y=box['y']+box['height']/2
            page.mouse.move(box['x']+box['width']*.34,y);page.mouse.down()
            page.mouse.move(box['x']+box['width']*.78,y,steps=10);page.mouse.up()
            page.wait_for_function("() => document.querySelector('.detail-visual-stage video').currentTime>1.4")
            assert snapshot()['snapshot']['viewedCaseId']=='case-one'
            paused=act('pause');assert paused['snapshot']['playback']['paused']
            act('set_loop',enabled=True,startMs=200,endMs=1000)
            assert snapshot()['snapshot']['playback']['loop']=={'startMs':200,'endMs':1000}
            assert not snapshot()['snapshot']['playback']['paused']
            assert page.locator('[data-review-range-status]').count()==0
            expect(page.locator('.review-timeline-selection')).to_be_visible()
            expect(page.locator('[data-review-mark=in]')).to_be_visible()
            expect(page.locator('[data-review-mark=out]')).to_be_visible()
            page.locator('[data-review-loop]').click()
            act('pause')
            page.locator('[data-review-loop]').click()
            page.wait_for_function("() => !document.querySelector('.detail-visual-stage video').paused")
            act('play'); assert not snapshot()['snapshot']['playback']['paused']
            act('pause')
            page.locator('#detail-review-toggle').click();assert page.locator('.detail-primary > .detail-body').is_visible()
            # Authored fields are visible, saved through the same versioned service, and survive readback.
            header_collision=page.evaluate("""() => {
              const button=document.querySelector('#detail-review-toggle').getBoundingClientRect();
              const edit=document.querySelector('.entry-editor-inline > summary').getBoundingClientRect();
              return button.left<edit.right && button.right>edit.left && button.top<edit.bottom && button.bottom>edit.top;
            }""")
            assert not header_collision
            assert page.locator('[data-creative-editor]').count()==0
            page.keyboard.press('m')
            page.get_by_role('button',name='使用入出点区间',exact=True).click()
            editor=page.locator('.review-feedback-panel');expect(editor).to_be_visible()
            purpose=editor.locator('textarea');purpose.fill('表演很好，第二镜需要调整')
            purpose.press('ControlOrMeta+A')
            selected_text=snapshot()['snapshot']['textSelection']
            assert selected_text['text']=='表演很好，第二镜需要调整';assert selected_text['fieldId']=='reviewFeedback'
            draft=snapshot()['snapshot']['draft'];assert draft['dirty']
            purpose.evaluate("node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))")
            assert snapshot()['snapshot']['reviewFeedback']['dirty']
            purpose.press('ArrowRight');purpose.press('Shift+Enter');assert purpose.input_value().endswith('\n')
            purpose.press('Enter')
            page.wait_for_function("() => document.querySelector('.review-feedback-form').dataset.dirty==='false'")
            media_notes=json.loads(call('read_case_details',{'caseId':'case-one','part':'annotations'})['content'])['timeNotes']
            assert media_notes[0]['text'].strip()=='表演很好，第二镜需要调整'
            assert media_notes[0]['startMs']==200 and media_notes[0]['endMs']==1000
            editor.locator('.review-feedback-jump').click()
            page.wait_for_function("() => Math.abs(document.querySelector('.detail-visual-stage video').currentTime-.2)<.01")
            assert player.evaluate('(v)=>!v.controls')
            act('pause')
            editor.locator('button[aria-label="收起备注"]').click()
            # Settings are a page within the same modal; no new browser tab.
            page.locator('#detail-close').click()
            page.locator('#open-settings').click();page.locator('[data-settings-tab=shortcuts]').click()
            settings=page.locator('#settings-shortcuts-panel');expect(settings).to_be_visible()
            settings.locator('#shortcut-markIn').click();settings.locator('#shortcut-markIn').press('q')
            settings.locator('button[type=submit]').click();expect(settings.locator('#shortcut-feedback')).to_have_text('已保存')
            settings.locator('#shortcut-toggleLoop').click();settings.locator('#shortcut-toggleLoop').press('Tab')
            expect(settings.locator('#shortcut-toggleLoop')).to_have_value('Tab')
            settings.locator('button[type=submit]').click();expect(settings.locator('#shortcut-feedback')).to_have_text('已保存')
            page.locator('[data-settings-tab=general]').click();expect(page.locator('#settings-general-panel')).to_be_visible()
            page.locator('[data-settings-tab=shortcuts]').click();expect(settings.locator('#shortcut-markIn')).to_have_value('Q')
            if artifact_directory: page.screenshot(path=str(Path(artifact_directory)/'shortcuts.png'))
            page.locator('#settings-close').click();page.reload()
            page.locator('#open-settings').click();page.locator('[data-settings-tab=shortcuts]').click()
            expect(settings.locator('#shortcut-markIn')).to_have_value('Q');expect(settings.locator('#shortcut-toggleLoop')).to_have_value('Tab')
            settings.locator('#shortcut-markOut').click();settings.locator('#shortcut-markOut').press('q');settings.locator('button[type=submit]').click()
            expect(settings.locator('#shortcut-feedback')).to_contain_text('按键重复')
            page.locator('#settings-close').click();act('open_case',caseId='case-one');act('select_media',assetId='video-one');act('set_review',enabled=True)
            act('set_loop',enabled=True,startMs=200,endMs=1000);page.locator('[data-review-loop]').click();act('pause')
            act('seek',positionMs=700);page.locator('[data-review-point=in]').focus()
            page.keyboard.press('i');assert snapshot()['snapshot']['playback']['range']['startMs']==200
            page.keyboard.press('q');assert abs(snapshot()['snapshot']['playback']['range']['startMs']-700)<10
            act('seek',positionMs=1300);page.keyboard.press('o');assert abs(snapshot()['snapshot']['playback']['range']['endMs']-1300)<10
            cleared=act('clear_range')['snapshot']['playback']
            assert cleared['range']['startMs'] is None and cleared['range']['endMs'] is None and cleared['loop'] is None,cleared
            source=json.loads(call('read_case_details',{'caseId':'case-one','part':'document'})['content']);assert source['text']=='原始资料原文保持'
            # Human temporary file needs no library save; Agent receives exactly its bytes.
            if artifact_directory: page.screenshot(path=str(Path(artifact_directory)/'creative-notes.png'))
            page.locator('#detail-close').click()
            def stage_sample(transfer_id):
                digest=hashlib.sha256(bytes(original_video)).hexdigest()
                transfer=call('begin_transfer',{'id':transfer_id,'name':'sample.mp4','mimeType':'video/mp4','byteSize':len(original_video),'sha256':digest})
                if transfer['offset']<len(original_video):
                    call('append_transfer',{'id':transfer_id,'offset':transfer['offset'],'data':base64.b64encode(bytes(original_video[transfer['offset']:])).decode()})
                assert call('finish_transfer',{'id':transfer_id})['state']=='ready'
            stage_sample('review-first')
            act('open_temporary',transferId='review-first')
            expect(page.locator('#temporary-review-dialog')).to_be_visible()
            page.wait_for_function("() => document.querySelector('#temporary-review-media video').readyState>=2")
            if artifact_directory: page.screenshot(path=str(Path(artifact_directory)/'temporary-review.png'))
            temp=snapshot()['snapshot']['temporary'];assert temp['saved'] is False
            assert snapshot()['snapshot']['mediaRead']=={'operation':'read_review_media','input':{'tabId':tab_id,'temporaryId':temp['id']}}
            downloaded=call('read_review_media',{'tabId':tab_id,'temporaryId':temp['id']})
            assert base64.b64decode(downloaded['data'])==bytes(original_video)
            assert downloaded['sha256']==hashlib.sha256(bytes(original_video)).hexdigest()
            temp_player=page.locator('#temporary-review-media video')
            act('play'); assert not snapshot()['snapshot']['playback']['paused']
            page.locator('#temporary-review-close').click()
            assert snapshot()['snapshot']['temporary'] is None
            # Agent sends a sample to the same player; neither direction creates a case.
            transfer_id='agent-review-sample'
            stage_sample(transfer_id)
            shown=act('open_temporary',transferId=transfer_id)
            assert shown['state']=='executed' and 'displayVerified' not in shown;assert shown['snapshot']['temporary']['saved'] is False
            expect(page.locator('#temporary-review-dialog')).to_be_visible()
            act('seek',positionMs=600)
            assert abs(snapshot()['snapshot']['playback']['positionMs']-600)<10
            received=call('read_review_media',{'tabId':tab_id,'temporaryId':shown['snapshot']['temporary']['id']})
            assert base64.b64decode(received['data'])==bytes(original_video)
            # Explicit next sample replaces the old one without a manual close.
            stage_sample('review-replacement')
            replaced=act('open_temporary',transferId='review-replacement')
            assert replaced['snapshot']['temporary']['id']!=shown['snapshot']['temporary']['id']
            temp_player=page.locator('#temporary-review-media video')
            page.wait_for_function("() => document.querySelector('#temporary-review-media video').readyState>=2")
            assert temp_player.evaluate('(v)=>!v.controls')
            assert page.locator('#temporary-review-media .review-timeline input').count()==1
            act('seek',positionMs=400)
            page.keyboard.press('m');temp_notes=page.locator('#temporary-review-notes .review-feedback-panel')
            expect(temp_notes).to_be_visible()
            temp_notes.locator('textarea').fill('这段动作很好，保留')
            page.locator('#temporary-review-actions [data-review-capture]').click()
            expect(page.locator('.temporary-review-frame img')).to_have_count(1)
            page.wait_for_function("() => !document.querySelector('#temporary-review-actions [data-review-capture]').disabled")
            temp_notes.locator('textarea').press('Enter')
            page.wait_for_function("() => document.querySelector('#temporary-review-notes .review-feedback-form').dataset.dirty==='false'")
            feedback=snapshot()['snapshot']['temporary']['feedback']
            assert feedback['notes'][0]['text']=='这段动作很好，保留' and feedback['notes'][0]['startMs']==400
            assert feedback['frames'][0]['assetId'] and feedback['frames'][0]['standalone']
            page.locator('#temporary-review-actions [data-review-capture]').click()
            expect(page.locator('.temporary-review-frame img')).to_have_count(2)
            page.wait_for_function("() => !document.querySelector('#temporary-review-actions [data-review-capture]').disabled")
            page.get_by_role('button',name='查看截图',exact=True).click()
            page.get_by_role('button',name='删除截图',exact=True).nth(1).click()
            expect(page.locator('.temporary-review-frame img')).to_have_count(1)
            assert snapshot()['snapshot']['temporary']['feedback']['notes']==feedback['notes']

            act('close_temporary');act('open_temporary',transferId='review-replacement')
            page.keyboard.press('m');expect(page.locator('#temporary-review-notes .review-feedback-row p')).to_have_text('这段动作很好，保留')
            if artifact_directory: page.screenshot(path=str(Path(artifact_directory)/'temporary-feedback.png'))
            page.locator('#temporary-review-save').click()
            page.wait_for_function("() => document.querySelector('#temporary-review-save').getAttribute('aria-label')==='已保存'")
            saved=snapshot()['snapshot']['temporary'];assert saved['saved']
            saved_id=saved['savedCase']['entryId']
            saved_media=json.loads(call('read_case_details',{'caseId':saved_id,'part':'media'})['content'])
            saved_notes=json.loads(call('read_case_details',{'caseId':saved_id,'part':'annotations'})['content'])['timeNotes']
            assert saved_notes[0]['text']=='这段动作很好，保留' and saved_notes[0]['startMs']==400
            assert saved_notes[0]['createdAt']==feedback['notes'][0]['createdAt']
            assert any(a['id']==feedback['frames'][0]['assetId'] for a in saved_media)
            assert call('read_media',{'caseId':saved_id,'assetId':feedback['frames'][0]['assetId']})['mimeType']=='image/webp'
            original=call('read_media',{'caseId':saved_id,'assetId':saved_media[0]['id']})
            assert base64.b64decode(original['data'])==bytes(original_video)
            assert original['sha256']==hashlib.sha256(bytes(original_video)).hexdigest()
            # Saving the same temporary identity again replays, never duplicates.
            replay=act('save_temporary',temporaryId=saved['id']);assert replay['saved']['entryId']==saved_id
            act('close_temporary')
            # Human import is tucked into Add and uses the exact same shared player.
            page.locator('#temporary-review-file').set_input_files({'name':'本机样片.mp4','mimeType':'video/mp4','buffer':bytes(original_video)})
            expect(page.locator('#temporary-review-dialog')).to_be_visible()
            page.wait_for_function("() => document.querySelector('#temporary-review-media video').readyState>=2")
            manual=snapshot()['snapshot']['temporary']
            assert manual['name']=='本机样片.mp4' and not manual['saved']
            assert page.locator('#temporary-review-media video').evaluate('(v)=>!v.controls')
            assert page.locator('#temporary-review-media .review-timeline input').count()==1
            page.keyboard.press('m');expect(page.locator('#temporary-review-notes .review-feedback-panel')).to_be_visible()
            act('close_temporary')
            stored=call('read_case_details',{'caseId':'case-one','part':'media'})
            assert [a['id'] for a in json.loads(stored['content'])]==[a['id'] for a in assets]
            assert call('search',{'countOnly':True})['total']==2
            assert call('read_case_details',{'caseId':'case-one'})['revision']!=before # only deliberate authored note save
            # A mixed local batch retains every original and per-item feedback in one case.
            payloads=[{'name':f'video-{i}.mp4','mimeType':'video/mp4','buffer':bytes(original_video)+bytes([i])} for i in range(5)]
            payloads += [{'name':f'image-{i}.png','mimeType':'image/png','buffer':png+bytes([i])} for i in range(3)]
            page.locator('#temporary-review-file').set_input_files(payloads)
            expect(page.locator('#temporary-review-dialog')).to_be_visible()
            batch=snapshot()['snapshot']['temporary'];assert batch['batch']['total']==8
            first_id=batch['assetId'];ids=[item['assetId'] for item in batch['batch']['items']]
            act('seek',positionMs=500);page.keyboard.press('m')
            panel=page.locator('#temporary-review-notes .review-feedback-panel')
            panel.locator('textarea').fill('第一项反馈');panel.locator('textarea').press('Enter')
            page.wait_for_function("() => document.querySelector('#temporary-review-notes .review-feedback-form').dataset.dirty==='false'")
            first_note=snapshot()['snapshot']['temporary']['feedback']['notes'][0]
            panel.get_by_role('button',name='收起备注',exact=True).click()
            page.locator('#temporary-review-actions [data-review-capture]').click()
            page.wait_for_function("() => !document.querySelector('#temporary-review-actions [data-review-capture]').disabled")
            assert page.locator('.temporary-review-frames').is_hidden(),'screening never creates a permanent second bottom row'
            old_identity=batch['id']
            act('select_media',assetId=ids[5]);assert snapshot()['snapshot']['temporary']['batch']['index']==5
            try: call('read_review_media',{'tabId':tab_id,'temporaryId':old_identity})
            except Exception as error: assert '切换' in str(error) or 'review_changed' in str(error)
            else: raise AssertionError('old temporary identity cannot read a different batch member')
            page.keyboard.press('m');panel.locator('textarea').fill('图片反馈');panel.locator('textarea').press('Enter')
            page.wait_for_function("() => document.querySelector('#temporary-review-notes .review-feedback-form').dataset.dirty==='false'")
            image_note=snapshot()['snapshot']['temporary']['feedback']['notes'][0]
            panel.get_by_role('button',name='收起备注',exact=True).click()
            act('select_media',assetId=first_id)
            assert snapshot()['snapshot']['temporary']['feedback']['notes'][0]==first_note
            page.locator('#temporary-review-save').click()
            page.wait_for_function("() => document.querySelector('#temporary-review-save').getAttribute('aria-label')==='已保存'")
            group_saved=snapshot()['snapshot']['temporary'];group_case=group_saved['savedCase']['entryId']
            stored_media=json.loads(call('read_case_details',{'caseId':group_case,'part':'media'})['content'])
            stored_notes=json.loads(call('read_case_details',{'caseId':group_case,'part':'annotations'})['content'])['timeNotes']
            assert len([item for item in stored_media if item.get('usage')!='poster'])==9,stored_media
            assert {note['assetId'] for note in stored_notes}=={first_id,ids[5]}
            assert {note['createdAt'] for note in stored_notes}=={first_note['createdAt'],image_note['createdAt']}
            for asset_id,payload in zip(ids,payloads):
                raw=call('read_media',{'caseId':group_case,'assetId':asset_id})
                assert base64.b64decode(raw['data'])==payload['buffer']
                assert raw['sha256']==hashlib.sha256(payload['buffer']).hexdigest()
            act('select_media',assetId=ids[5]);assert snapshot()['snapshot']['temporary']['saved']
            again=act('save_temporary',temporaryId=snapshot()['snapshot']['temporary']['id'])
            assert again['saved']['entryId']==group_case
            assert call('search',{'countOnly':True})['total']==3
            if artifact_directory:page.screenshot(path=str(Path(artifact_directory)/'mixed-batch-saved.png'))
            act('close_temporary')
            print({'mixedBatch':8,'singleSavedCase':True,'independentVideoAndImageFeedback':True,'screenshotsIncluded':True,'allOriginalsSha256':True,'batchSwitchViaAgent':True,'staleIdentityRejected':True})
            print({'live_page':True,'human_selection':True,'ordered_wait':True,'stale_rejected':True,'no_extra_candidates_layout':True,'single_timeline':True,'custom_shortcuts':True,'review_and_seek':True,'draft_save_readback':True,'temporary_original':True,'agent_temporary':True,'manual_temporary':True,'case_count':2,'temporary_feedback_frame_save_readback':True})
if __name__=='__main__':main()
