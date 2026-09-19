"""Synthetic compatible-provider replies through the real Composer UI; no paid calls."""
import json
from playwright.sync_api import expect
from e2e_support import ai_configuration_fixture, base_entry, extension_session, wait_for_async_condition

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='


def run_protocol(protocol):
    endpoint = 'https://compatible.example/v1/' + ('responses' if protocol == 'responses' else 'chat/completions')
    with extension_session('pd-compatible-stream-') as run:
        setup = run.open_page('collector.html')
        entry = base_entry('reference', '选中的图片', '保留原始提示词', 'content:prompt:image')
        entry['mediaAssets'] = [{'id': 'original', 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png', 'width': 1, 'height': 1}]
        entry['primaryMediaId'] = 'original'
        run.seed_storage(setup, {'entries': [entry], **ai_configuration_fixture(providers={'custom-text': {
            'endpoint': endpoint, 'protocol': protocol, 'apiKey': 'fixture-key', 'consent': True,
            'models': {'creativePlanning': 'account-model'},
            'discoveredModels': [{'id': 'account-model', 'status': 'available', 'confidence': 'declared',
                                 'tasks': ['creativePlanning'], 'inputModalities': [], 'outputModalities': ['text']}]
        }}, assignments={'creativePlanning': {'providerId': 'custom-text', 'model': 'account-model'}})})
        setup.evaluate('''async png => {
          const {saveMediaBlob} = await import('./media-store.js');
          const {createComposerSession} = await import('./composer.js');
          await saveMediaBlob('original', new Blob([Uint8Array.from(atob(png), c=>c.charCodeAt(0))], {type:'image/png'}));
          const session = createComposerSession({id:'stream-session', routeMode:'analyze_materials',
            aiProfile:{serviceId:'custom-text',model:'account-model'},
            referenceSnapshots:[{entryId:'reference',alias:'@参考1',referenceKind:'prompt',originalText:'保留原始提示词',
              imageRefs:[{visualId:'original',mimeType:'image/png'}]}]});
          const result = await chrome.runtime.sendMessage({type:'UPSERT_COMPOSER_SESSION',session});
          if (!result.ok) throw new Error(result.message);
        }''', PNG)
        requests = []
        truncated = False

        def reply(route):
            requests.append(route.request.post_data_json)
            text = '不完整内容' if truncated else '图片的主体轮廓清晰，原始提示词已读到。'
            events = [
                {'type': 'response.output_text.delta', 'delta': text},
                {'type': 'response.completed', 'response': {'status': 'completed', 'model': 'account-model'}}
            ] if protocol == 'responses' else [
                {'model': 'account-model', 'choices': [{'delta': {'content': text}}]},
                {'choices': [{'delta': {}, 'finish_reason': 'stop'}]}
            ]
            frames = ['\r'.join('data: ' + line for line in json.dumps(event, ensure_ascii=False, indent=2).splitlines()) + '\r\r' for event in events]
            if truncated:
                frames[-1] = frames[-1].rstrip('\r')[:-1]
            route.fulfill(status=200, content_type='text/event-stream', body=''.join(frames), headers={'Access-Control-Allow-Origin': '*'})

        run.context.route(endpoint, reply)
        page = run.open_page('composer.html?session=stream-session', wait_until='networkidle')
        expect(page.locator('.composer-input-reference-card')).to_have_count(1)
        page.locator('#composer-instruction').fill('分析选中原图和原始提示词')
        page.locator('#composer-action').click()
        expect(page.locator('.composer-message.analysis')).to_contain_text('图片的主体轮廓清晰')
        wait_for_async_condition(page, "async()=>!(await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION',sessionId:'stream-session'})).session.activeTurn")
        assert len(requests) == 1, requests
        body = requests[0]
        assert body['model'] == 'account-model' and body['stream'] is True
        contents = [part for item in body.get('input', body.get('messages', [])) for part in (item.get('content', []) if isinstance(item.get('content'), list) else [])]
        images = [part for part in contents if part.get('type') in ['input_image', 'image_url']]
        assert len(images) == 1, body
        url = images[0]['image_url'] if protocol == 'responses' else images[0]['image_url']['url']
        assert url == 'data:image/png;base64,' + PNG
        page.reload()
        expect(page.locator('.composer-message.analysis')).to_have_count(1)
        expect(page.locator('.composer-message.analysis')).to_contain_text('图片的主体轮廓清晰')
        completed = page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION',sessionId:'stream-session'})).session")

        truncated = True
        page.locator('#composer-instruction').fill('再次分析')
        page.locator('#composer-action').click()
        wait_for_async_condition(page, "async()=>{const {session}=await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION',sessionId:'stream-session'});return session?.activeTurn?.status==='failed' && Boolean(session.lastFailure)}")
        page.reload()
        assert len(requests) == 2, 'interrupted provider work must not be sent again automatically'
        expect(page.locator('.composer-message.analysis', has_text='图片的主体轮廓清晰')).to_have_count(1)
        failed = page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION',sessionId:'stream-session'})).session")
        assert failed['activeTurn']['partialText'] == '不完整内容'
        assert failed['activeTurn']['status'] == 'failed'
        assert [m for m in failed['messages'] if m['role'] == 'assistant'] == [m for m in completed['messages'] if m['role'] == 'assistant']
        saved = page.evaluate("async()=>(await chrome.storage.local.get('entries')).entries[0]")
        assert saved['text'] == entry['text']
        print(json.dumps({'protocol': protocol, 'originalImageSent': True, 'replyPersisted': True, 'incompleteReplyRejected': True, 'requests': len(requests), 'paidRequests': 0}))


if __name__ == '__main__':
    for protocol in ['chat_completions', 'responses']:
        run_protocol(protocol)
