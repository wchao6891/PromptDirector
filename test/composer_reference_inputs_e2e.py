"""Reference choices through real UI and durable jobs; a local provider records exact payloads."""
import json
import threading
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import ai_configuration_fixture, extension_session, wait_for_async_condition
from composer_video_dialogue_e2e import streaming_provider
from zhipu_glm_analysis_e2e import extension_with_local_provider_permission
from compatible_composer_stream_e2e import PNG
from composer_e2e_support import set_composer_reference_media, set_composer_direction


def main():
    requests = []
    release = threading.Event()
    release.set()
    with streaming_provider(requests, release) as origin, extension_with_local_provider_permission(origin) as directory, extension_session('reference-inputs-', extension_dir=directory) as run:
        setup = run.open_page('collector.html')
        run.seed_storage(setup, {'entries': [], **ai_configuration_fixture(providers={'custom-text': {
            'apiKey':'fixture-key', 'endpoint':origin+'/chat/completions','protocol':'chat_completions','consent':True,
            'models':{'creativePlanning':'unknown-multimodal'},
            'discoveredModels':[{'id':'unknown-multimodal','tasks':['creativePlanning'],'inputModalities':['text'],'outputModalities':['text'],'status':'available'}]
        }, 'custom-media': {'apiKey':'saved-vision-key','endpoint':origin+'/chat/completions','protocol':'chat_completions','consent':True,
                           'models':{'imageAnalysis':'saved-understanding-model'}}}, assignments={'creativePlanning':{'providerId':'custom-text','model':'unknown-multimodal'}})})
        setup.evaluate('''async png=>{
          const {saveMediaBlob}=await import('./media-store.js');
          const {createComposerSession}=await import('./composer.js');
          await saveMediaBlob('image',new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'}));
          await saveMediaBlob('video',new Blob(['synthetic video'],{type:'video/mp4'}));
          const session=createComposerSession({id:'reference-inputs',targetType:'video',routeMode:'analyze_materials',
            aiProfile:{serviceId:'custom-text',model:'unknown-multimodal'},imageReferenceMode:'text_only',videoReferenceMode:'text_only',
            referenceSnapshots:[{entryId:'image-case',alias:'@参考1',referenceKind:'prompt',referenceText:'图片原始提示词',imageRefs:[{visualId:'image'}]},
              {entryId:'video-case',alias:'@参考2',referenceKind:'video_sources',referenceText:'视频原始提示词和逆推文字',assetRefs:[{assetId:'video',kind:'video',mimeType:'video/mp4'}]}]});
          await chrome.runtime.sendMessage({type:'UPSERT_COMPOSER_SESSION',session});
        }''', PNG)
        page=run.open_page('composer.html?session=reference-inputs', wait_until='networkidle')
        expect(page.locator('#composer-send-images')).not_to_be_checked()
        expect(page.locator('#composer-send-videos')).not_to_be_checked()
        direction = page.locator('#composer-direction-trigger')
        expect(direction).to_have_attribute('title', '创作方向：视频。影响提示词和可选参考，不会直接生成成品。')
        direction.focus(); direction.press('Enter')
        expect(page.locator('#composer-direction input[value="image"]')).to_be_visible()
        page.locator('#composer-direction input[value="image"]').focus()
        page.keyboard.press('Space')
        expect(page.locator('#composer-direction')).not_to_have_attribute('open', '')
        expect(direction).to_be_focused()
        expect(direction).to_have_attribute('title', '创作方向：图片。影响提示词和可选参考，不会直接生成成品。')
        set_composer_direction(page, 'video')
        page.reload()
        expect(page.locator('#composer-direction-icon')).to_have_attribute('href', 'assets/ui-icons.svg#icon-video')
        assert len(requests) == 0
        page.locator('#composer-model-trigger').click()
        expect(page.locator('#composer-model-dynamic')).to_contain_text('saved-understanding-model')
        page.locator('#composer-model-trigger').click()
        for images, videos in [(False,False),(True,False),(False,True),(True,True)]:
            set_composer_reference_media(page, images=images, videos=videos)
            page.reload()
            expect(page.locator('#composer-send-images')).to_be_checked(checked=images)
            expect(page.locator('#composer-send-videos')).to_be_checked(checked=videos)
            count=len(requests)
            page.locator('#composer-instruction').fill('总结已选参考内容')
            page.locator('#composer-action').click()
            wait_for_async_condition(page,"async()=>{const s=await chrome.storage.local.get('creativeJobs');return s.creativeJobs?.items?.at(-1)?.status==='completed'}")
            expect(page.locator('.composer-message.analysis')).to_have_count(count+1)
            assert len(requests)==count+1
            body=requests[-1]
            content=body['messages'][-1]['content']
            assert sum(p['type']=='image_url' for p in content)==int(images), body
            assert sum(p['type']=='video_url' for p in content)==int(videos), body
            assert '视频原始提示词和逆推文字' in json.dumps(body,ensure_ascii=False)
            assert '图片原始提示词' in json.dumps(body,ensure_ascii=False)
        screenshots=Path(__import__('os').environ.get('PROMPTDIRECTOR_E2E_ARTIFACT_DIR','/private/tmp/pd-b4-ui'));screenshots.mkdir(exist_ok=True)
        page.emulate_media(reduced_motion='reduce')
        for width in [1280,900,640,390]:
            page.set_viewport_size({'width':width,'height':900})
            if width <= 640:
                if 'nav-open' in (page.locator('#composer-shell').get_attribute('class') or ''): page.locator('#composer-nav-close').click()
                page.wait_for_function("()=>document.querySelector('#composer-nav').getBoundingClientRect().right<=0")
            assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
            expect(page.locator('.composer-input-tools #composer-reference-inputs')).to_be_visible()
            expect(page.locator('#composer-image-input-status, #composer-image-input-model')).to_have_count(0)
            assert page.locator('#composer-reference-inputs').bounding_box()['y'] >= page.locator('#composer-instruction').bounding_box()['y'] + page.locator('#composer-instruction').bounding_box()['height']
            for theme in ['dark','light']:
                page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
                page.screenshot(path=str(screenshots/f'{theme}-{width}.png'),full_page=True,animations='disabled')
                page.locator('.composer-input-box').screenshot(path=str(screenshots/f'toolbar-{theme}-{width}.png'),animations='disabled')
                for menu_id in ['composer-direction','composer-reference-inputs','composer-options']:
                    menu=page.locator('#'+menu_id)
                    trigger=menu.locator('summary')
                    trigger.click()
                    page.wait_for_function("""id=>{
                      const m=document.getElementById(id), p=m.querySelector('.composer-options-panel');
                      const r=p.getBoundingClientRect(), a=m.querySelector('summary').getBoundingClientRect();
                      return m.open && r.left>=0 && r.right<=document.querySelector('#composer-shell').getBoundingClientRect().right+1 && (id==='composer-options' || r.bottom<=a.top);
                    }""",arg=menu_id)
                    page.evaluate('async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)}')
                    panel=menu.locator('.composer-options-panel').bounding_box()
                    assert panel['x']>=0 and panel['x']+panel['width']<=page.locator('#composer-shell').bounding_box()['width']+1, panel
                    assert panel['y']>=0 and panel['y']+panel['height']<=900, panel
                    if menu_id != 'composer-options':
                        assert panel['y']+panel['height'] <= trigger.bounding_box()['y'], panel
                    page.screenshot(path=str(screenshots/f'{theme}-{width}-{menu_id}.png'),full_page=True,animations='disabled')
                    page.keyboard.press('Escape')
                    expect(menu).not_to_have_attribute('open', '')
                    expect(trigger).to_be_focused()
        page.evaluate('()=>document.documentElement.dataset.theme="dark"')
        page.locator('#composer-direction-trigger').click()
        page.locator('#composer-reference-inputs-trigger').click()
        expect(page.locator('#composer-direction')).not_to_have_attribute('open', '')
        page.locator('#composer-instruction').click(position={'x':8,'y':8})
        expect(page.locator('#composer-reference-inputs')).not_to_have_attribute('open', '')
        # New conversations start with text, without modifying older conversations.
        page.set_viewport_size({'width':1280,'height':900})
        page.locator('#composer-new').click()
        page.locator('#composer-attachment-files').set_input_files({'name':'test.png','mimeType':'image/png','buffer':__import__('base64').b64decode(PNG)})
        expect(page.locator('#composer-send-images')).not_to_be_checked()
        # A generation-only connection works without an understanding key.
        from ai_provider_registry_e2e import open_ai_settings
        library = open_ai_settings(run)
        library.locator('[data-ai-routing-tab="providers"]').click()
        library.locator('#open-ai-routing').click()
        dialog = library.locator('#promptdirector-app-dialog')
        dialog.locator('#promptdirector-app-dialog-providerEditor').select_option('custom-media')
        expect(dialog.locator('#promptdirector-app-dialog-provider_custom_media_apiKey')).to_be_hidden()
        key = dialog.locator('#promptdirector-app-dialog-provider_custom_media_imageApiKey')
        key.click(); key.fill('generation-only-fixture')
        dialog.locator('#promptdirector-app-dialog-provider_custom_media_imageProtocol').select_option('images_generations')
        dialog.locator('#promptdirector-app-dialog-provider_custom_media_imageEndpoint').fill(origin+'/images/generations')
        dialog.locator('#promptdirector-app-dialog-provider_custom_media_model_imageGeneration').fill('fixture-image-model')
        dialog.locator('#promptdirector-app-dialog-provider_custom_media_consent').check()
        library.screenshot(path=str(screenshots/'generation-connection.png'),full_page=True)
        library.evaluate('()=>{chrome.permissions.request=async()=>true}')
        dialog.get_by_role('button',name='保存配置',exact=True).click()
        expect(dialog).to_be_hidden()
        expect(library.locator('[data-provider-id="custom-media"]')).to_contain_text('已连接')
        print(json.dumps({'referenceCombinations':4,'savedVisionModelSelectable':True,'narrowLayout':True, 'iconMenus':True, 'keyboardAndOutsideClose':True,'paidRequests':0}))

if __name__=='__main__': main()
