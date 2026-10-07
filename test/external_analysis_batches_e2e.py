"""External batch results through the actual extension; isolated profile, no model calls."""
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-batch-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() + '\nglobalThis.agentTestDispatch=dispatchAgentOperation;\n')
        with extension_session('pd-batch-profile-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            run.seed_storage(page, {'entries': [{'id': 'first', 'title': '案例一', 'text': '人工正文', 'savedAt': '2026-10-01T00:00:00Z',
                'mediaAssets': [{'id': 'picture', 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png'}],
                'primaryMediaId': 'picture', 'mediaPrompts': [{'assetId': 'picture', 'source': 'manual', 'text': '原始提示词'}]},
                {'id': 'second', 'title': '案例二', 'text': '保留正文', 'savedAt': '2026-10-01T00:00:00Z'}]})
            digest = page.evaluate('''async () => {
              const {saveMediaBlob}=await import('./media-store.js');
              const {sha256Blob}=await import('./blob-digest.js');
              const blob=new Blob(['original fixture'],{type:'image/png'});
              await saveMediaBlob('picture',blob);return sha256Blob(blob);
            }''')
            delivered = page.evaluate('''async () => {
              const {createLocalComposerLibraryTools}=await import('./composer-library-host.js');
              const {createComposerSession}=await import('./composer.js');
              const session=createComposerSession({messages:[{id:'u',role:'user',content:'使用案例一的图片'}]});
              const tools=createLocalComposerLibraryTools({session,vision:true});
              return tools.execute('use_case_images',{caseId:'first',imageIds:['picture']},{callId:'image'});
            }''')
            assert delivered['data']['media'][0]['sha256'] == digest, delivered
            assert len(delivered['images']) == 1
            worker = run.context.service_workers[0]
            def call(name, args):
                return worker.evaluate('''async ([name,input])=>{try{return await agentTestDispatch(name,input);}catch(e){return {error:e.message,code:e.code};}}''', [name, args])
            def read():
                return call('read_analysis_batch', {'batchId': 'browser-batch'})
            def control(action, request, **more):
                return call('manage_analysis_batch', {'action': action, 'requestId': request, 'batchId': 'browser-batch', 'expectedRevision': read()['revision'], **({'epoch': read()['epoch']} if action == 'cancel' else {}), **more})
            first = call('read_case_details', {'caseId': 'first'})
            second = call('read_case_details', {'caseId': 'second'})
            created = call('manage_analysis_batch', {'action': 'create', 'requestId': 'browser-batch', 'instruction': '批量提炼已选资料', 'items': [
                {'caseId': 'first', 'expectedRevision': first['revision'], 'assets': [{'assetId': 'picture', 'sha256': digest, 'coverage': '隔离测试原件，无真实模型分析'}]},
                {'caseId': 'second', 'expectedRevision': second['revision'], 'assets': []}]})
            assert created['ok'], created
            assert control('seal', 'seal')['ok']
            rows = read()['items']
            submit = {'batchId': 'browser-batch', 'requestId': 'save-first', 'caseId': 'first', 'attemptId': rows[0]['attemptId'], 'epoch': 0,
                      'model': 'isolated-fixture', 'result': {'mediaPrompts': [{'assetId': 'picture', 'text': 'AI逆推测试'}], 'tags': [{'g': 'scene.place', 't': '摄影棚'}]}}
            saved = call('submit_analysis_result', submit)
            assert saved['item']['state'] == 'saved', saved
            assert call('submit_analysis_result', submit)['replayed']
            internal = page.evaluate('''async () => chrome.runtime.sendMessage({type:'CASE_OPERATION',operation:'read_analysis_batch',input:{batchId:'browser-batch'}})''')
            assert internal == read(), internal
            after = call('read_case_details', {'caseId': 'first', 'part': 'annotations'})
            assert after['revision'] == saved['item']['savedRevision'], (after, saved)
            annotations = json.loads(after['content'])
            assert any(p['source'] == 'manual' and p['text'] == '原始提示词' for p in annotations['mediaPrompts'])
            assert any(p['source'] == 'ai-suggestion' and p['text'] == 'AI逆推测试' for p in annotations['mediaPrompts'])
            assert annotations['facetAssignments'][0]['visualId'] == 'picture'
            # Original body text is protected by default (user-confirmed rule, case-field-access.js); the concurrent
            # human edit therefore declares an explicit source correction, and an undeclared rewrite must be refused.
            correction = {'reason': '隔离夹具：用户明确修正正文', 'fields': ['text']}
            refused = call('edit_case', {'caseId': 'second', 'expectedRevision': second['revision'], 'requestId': 'undeclared-edit', 'patch': {'text': '未声明修正'}})
            assert refused.get('code') == 'source_protected', refused
            edited = call('edit_case', {'caseId': 'second', 'expectedRevision': second['revision'], 'requestId': 'human-edit', 'sourceCorrection': correction, 'patch': {'text': '人工后来改过'}})
            assert edited['ok'], edited
            stale = call('submit_analysis_result', {'batchId': 'browser-batch', 'requestId': 'stale', 'caseId': 'second', 'epoch': 0,
                'attemptId': rows[1]['attemptId'], 'result': {'tags': [{'g': 'scene.weather'}]}})
            assert stale['item']['error']['code'] == 'case_conflict', stale
            assert stale['status'] == 'partial'
            assert control('cancel', 'cancel')['status'] == 'canceled'
            assert control('resume', 'resume')['epoch'] == 1
            new_input = {'caseId': 'second', 'expectedRevision': edited['cases'][0]['revision'], 'assets': []}
            retried = control('retry', 'retry', items=[new_input])
            assert retried['item']['attemptId'] != rows[1]['attemptId']
            result = call('submit_analysis_result', {'batchId': 'browser-batch', 'requestId': 'save-second', 'caseId': 'second', 'epoch': 1,
                'attemptId': retried['item']['attemptId'], 'result': {'tags': [{'g': 'scene.weather'}]}})
            assert result['status'] == 'completed', result
            page.reload()
            assert read()['saved'] == 2 and read()['failed'] == 0
            found = call('list_analysis_batches', {'query': '批量提炼', 'status': 'completed'})
            assert found['total'] == 1 and found['batches'][0]['id'] == 'browser-batch', found
            discovered = page.evaluate("async () => chrome.runtime.sendMessage({type:'CASE_OPERATION',operation:'list_analysis_batches',input:{}})")
            assert discovered['total'] == 1, discovered
            document = json.loads(call('read_case_details', {'caseId': 'second', 'part': 'document'})['content'])
            assert document['text'] == '人工后来改过'
            detail = json.loads(call('read_analysis_batch', {'batchId': 'browser-batch', 'part': 'result', 'caseId': 'second'})['content'])
            assert detail['previousAttempts'][0]['error']['code'] == 'case_conflict'
            page_items = [{'caseId': case_id, 'expectedRevision': call('read_case_details', {'caseId': case_id})['revision'], 'assets': []}
                          for case_id in ['first', 'second']]
            assert call('manage_analysis_batch', {'action': 'create', 'requestId': 'page-batch', 'instruction': '合并结果测试', 'items': page_items})['ok']
            page_rows = call('read_analysis_batch', {'batchId': 'page-batch'})['items']
            assert call('edit_case', {'caseId': 'second', 'expectedRevision': page_items[1]['expectedRevision'], 'requestId': 'page-human-edit', 'sourceCorrection': correction, 'patch': {'text': '合并提交前人工新改'}})['ok']
            page_submit = {'requestId': 'save-page', 'batchId': 'page-batch', 'epoch': 0, 'items': [
                {'caseId': row['caseId'], 'attemptId': row['attemptId'], 'result': {'tags': [{'g': 'scene.weather', 't': '晴天'}]}} for row in page_rows]}
            page_saved = call('submit_analysis_results', page_submit)
            assert [item['state'] for item in page_saved['items']] == ['saved', 'failed'], page_saved
            assert page_saved['items'][1]['error']['code'] == 'case_conflict'
            assert call('submit_analysis_results', page_submit)['replayed']
            page.reload()
            assert call('read_analysis_batch', {'batchId': 'page-batch'})['saved'] == 1
            assert json.loads(call('read_case_details', {'caseId': 'second', 'part': 'document'})['content'])['text'] == '合并提交前人工新改'
            assert page_saved['items'][0]['savedRevision'] == call('read_case_details', {'caseId': 'first'})['revision']
            # Fresh isolated fixture for the complete result shapes. No provider calls.
            run.seed_storage(page, {'entries': [{'id': 'complete', 'title': '完整分析隔离案例', 'text': '保留人工正文',
                'savedAt': '2026-10-01T00:00:00Z', 'primaryMediaId': 'full-image',
                'mediaAssets': [{'id': asset_id, 'kind': kind, 'storageMode': 'managed', 'mimeType': mime, **({'durationMs': 10000} if kind == 'video' else {})}
                                for asset_id, kind, mime in [('full-image', 'image', 'image/png'), ('full-image2', 'image', 'image/png'), ('full-video', 'video', 'video/mp4')]],
                'mediaPrompts': [{'assetId': 'full-image', 'source': 'manual', 'text': '保留原始提示词'}]}]})
            hashes = page.evaluate('''async () => {
              const {saveMediaBlob}=await import('./media-store.js');const {sha256Blob}=await import('./blob-digest.js');
              const image=await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')).blob();
              const video=new Blob(['isolated video bytes'],{type:'video/mp4'});
              const values={};for(const [id,blob] of [['full-image',image],['full-image2',image],['full-video',video]]) {
                await saveMediaBlob(id,blob);values[id]=await sha256Blob(blob);
              }return values;
            }''')
            registered = call('manage_analysis_batch', {'action': 'create', 'requestId': 'complete-batch', 'instruction': '仅隔离夹具，模型未执行', 'items': [{
                'caseId': 'complete', 'expectedRevision': call('read_case_details', {'caseId': 'complete'})['revision'],
                'assets': [{'assetId': asset_id, 'sha256': sha, 'coverage': '仅0至2秒画面，无音频' if asset_id == 'full-video' else '完整图片'} for asset_id, sha in hashes.items()]}]})
            assert registered['ok'], registered
            row = call('read_analysis_batch', {'batchId': 'complete-batch'})['items'][0]
            image_tags = [{'g': 'scene.place', 't': '摄影棚'}]
            result = {'imageAnalyses': [{'assetId': asset_id, 'reconstructionPrompt': '隔离图片逆推 ' + asset_id, 'tags': image_tags} for asset_id in ['full-image', 'full-image2']],
                'videoAnalyses': [{'assetId': 'full-video', 'reconstructionPrompt': '隔离视频逆推：角色走向镜头', 'tags': [
                    {'g': 'style.render', 't': '电影写实'}, {'g': 'camera.shot', 't': '近景'}, {'g': 'light.palette', 't': '冷暖对比'}, {'g': 'action.change', 't': '渐变显现'}],
                    'uncertainties': ['实际焦距未知'], 'analysisScope': 'visual'}],
                'visualSetAnalyses': [{'assetIds': ['full-image', 'full-image2'], 'imageRoles': [{'assetId': 'full-image', 'role': '主体'}, {'assetId': 'full-image2', 'role': '场景'}],
                    'sharedVisualSystem': ['暖色'], 'differences': ['不同机位'], 'continuity': ['同一人物'], 'compositionRules': ['中心构图'], 'reusablePrompt': '隔离整组人物场景提示词'}]}
            complete_input = {'batchId': 'complete-batch', 'requestId': 'complete-save', 'caseId': 'complete', 'epoch': 0, 'attemptId': row['attemptId'], 'model': 'isolated-fixture', 'result': result}
            complete_saved = page.evaluate('''async input => chrome.runtime.sendMessage({type:'CASE_OPERATION',operation:'submit_analysis_result',input})''', complete_input)
            assert complete_saved['item']['state'] == 'saved', complete_saved
            assert call('submit_analysis_result', complete_input)['replayed']
            page.reload()
            complete_media = call('read_case_details', {'caseId': 'complete', 'part': 'media'})
            assert complete_media['revision'] == complete_saved['item']['savedRevision'], (complete_media, complete_saved)
            media = json.loads(complete_media['content'])
            assert media[0]['visionAnalysis']['providerType'] == 'external'
            assert media[0]['visionAnalysis']['inputEvidence']['assets'][0]['sha256'] == hashes['full-image']
            annotations = json.loads(call('read_case_details', {'caseId': 'complete', 'part': 'annotations'})['content'])
            assert annotations['mediaPrompts'][0]['text'] == '保留原始提示词'
            assert annotations['videoAnalyses'][0]['uncertainties'] == ['实际焦距未知']
            assert annotations['visualSetAnalyses'][0]['imageRoles'] == result['visualSetAnalyses'][0]['imageRoles']
            assert annotations['visualSetAnalyses'][0]['continuity'] == ['同一人物']
            coverage = json.loads(call('read_case_details', {'caseId': 'complete', 'part': 'analysis_coverage'})['content'])
            assert coverage['mediaWithRecordedScope'] == 3 and coverage['currentBytesVerified'] is False
            assert coverage['media'][2]['analyses'][0]['coverage'] == '仅0至2秒画面，无音频'
            page.locator('.case-card[data-entry-id="complete"]').click()
            # The detail prompt section is now tabbed (library.js createMediaPromptSection): it opens on the preserved
            # case original, the manual media prompt and the external AI result are separate tabs, none overwritten.
            prompt_section = page.locator('.media-prompt-section').first
            prompt_section.locator('[data-prompt-tab="shared"][aria-selected="true"]').wait_for()
            prompt_section.get_by_text('保留人工正文', exact=True).wait_for()
            prompt_section.locator('[data-prompt-tab="media"]').click()
            prompt_section.get_by_text('保留原始提示词', exact=True).wait_for()
            prompt_section.locator('[data-prompt-tab="ai"]').click()
            prompt_section.get_by_text('隔离图片逆推 full-image', exact=True).wait_for()
            page.locator('.visual-set-analysis summary').click()
            page.get_by_text('隔离整组人物场景提示词', exact=True).wait_for()
            assert 'imageAnalyses' in call('status', {})['analysisResultFields']
            print('PASS: complete image/video/set results through shared internal/external endpoints; durable normalization/revision, exact observed scope and rendered detail after reload')
            print('PASS: task discovery after reload and shared internal endpoint; merged page partial save, conflict preservation, receipt replay and persisted revision readback')
            print('PASS: isolated real extension batch register/write/readback, shared internal endpoint, native normalization revisions, original/manual preservation, conflict/partial/retry/cancel/resume, durable reload and failed-attempt evidence; no real library or model calls')


if __name__ == '__main__':
    main()
