from __future__ import annotations

import json
import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import ai_configuration_fixture, base_entry, extension_session, wait_for_async_condition

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='


def main():
    with extension_session('prompt-director-tool-images-') as run:
        setup = run.open_page('collector.html')
        entries = []
        for name in ['A', 'B']:
            entry = base_entry(name, f'{name}画面', f'{name}案例的文字', 'content:prompt:image')
            entry['mediaAssets'] = [{'id': f'{name}-image', 'kind': 'image', 'usage': 'content', 'mimeType': 'image/png', 'storageMode': 'managed', 'width': 1, 'height': 1}]
            entry['primaryMediaId'] = f'{name}-image'
            entries.append(entry)
        run.seed_storage(setup, {'schemaVersion': 24, 'entries': entries, **ai_configuration_fixture(providers={
            'openai': {'apiKey': 'isolated-key', 'consent': True, 'models': {'creativePlanning': 'gpt-5-mini', 'imageAnalysis': 'gpt-5-mini'}}
        }, assignments={'creativePlanning': {'providerId': 'openai', 'model': 'gpt-5-mini'}})})
        setup.evaluate('''async png => {
          const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          const blob = new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], {type:'image/png'});
          await saveMediaBlob('A-image', blob); await saveMediaBlob('B-image', blob);
        }''', PNG)
        requests = []
        mode = 'ordinary'

        def reply(route):
            body = route.request.post_data_json
            requests.append(body)
            results = [item for item in body['input'] if item.get('type') == 'function_call_output']
            output = [{'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': '{"route":"chat","status":"ready"}\n已回答本轮要求。'}]}]
            if mode == 'image' and not results:
                output = [{'type': 'function_call', 'call_id': 'wrong', 'name': 'use_case_images', 'arguments': json.dumps({'caseId': 'B', 'imageIds': ['B-image']})}]
            elif mode == 'image' and len(results) == 1:
                assert 'error' in json.loads(results[0]['output']), results
                output = [{'type': 'function_call', 'call_id': 'right', 'name': 'use_case_images', 'arguments': json.dumps({'caseId': 'A', 'imageIds': ['A-image']})}]
            elif mode == 'denied' and not results:
                output = [{'type': 'function_call', 'call_id': 'denied', 'name': 'use_case_images', 'arguments': json.dumps({'caseId': 'A', 'imageIds': ['A-image']})}]
            route.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 'completed', 'model': 'gpt-5-mini', 'output': output, 'usage': {'input_tokens': 20, 'output_tokens': 10, 'total_tokens': 30}}, ensure_ascii=False))

        run.context.route('https://api.openai.com/**', reply)
        page = run.open_page('composer.html')

        def send(text, expected):
            before = len(requests)
            messages = page.locator('.composer-message.chat').count()
            page.locator('#composer-instruction').fill(text)
            page.locator('#composer-action').click()
            expect(page.locator('.composer-message.chat')).to_have_count(messages + 1)
            wait_for_async_condition(page, '''async () => {
              const sessionId = new URL(location.href).searchParams.get('session');
              return !(await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION', sessionId})).session.activeTurn;
            }''')
            assert len(requests) == before + expected, requests[before:]
            return requests[before:]

        ordinary = send('写一句产品文案', 1)
        assert 'image_url' not in json.dumps(ordinary)
        mode = 'image'
        sent = send('用A画面的图片做构图参考', 3)
        assert 'image_url' not in json.dumps(sent[:2])
        images = [part for item in sent[-1]['input'] for part in item.get('content', []) if isinstance(part, dict) and part.get('type') == 'input_image']
        assert len(images) == 1 and images[0]['image_url'].endswith(PNG), images
        labels = [part['text'] for item in sent[-1]['input'] for part in item.get('content', []) if isinstance(part, dict) and part.get('type') == 'input_text']
        assert any('A-image' in label for label in labels), labels
        assert not any('B-image' in label for label in labels), labels
        expect(page.locator('#composer-send-note')).to_contain_text('本轮已附 1 张图片')
        expect(page.locator('#composer-send-note')).to_contain_text('输入 60 / 输出 30 tokens')
        expect(page.locator('.composer-tool-event.error')).to_have_count(1)
        mode = 'denied'
        denied = send('使用A画面的文字，不要发送图片', 2)
        assert 'image_url' not in json.dumps(denied)
        expect(page.locator('#composer-send-note')).to_contain_text('本轮已附 0 张图片')
        page.reload()
        expect(page.locator('.composer-tool-event.error')).to_have_count(2)
        expect(page.locator('.composer-tool-summary')).to_contain_text('输入 40 / 输出 20 tokens')
        if os.environ.get('PROMPTDIRECTOR_E2E_ARTIFACT_DIR'):
            folder = Path(os.environ['PROMPTDIRECTOR_E2E_ARTIFACT_DIR'])
            folder.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(folder / 'composer-tool-image-scope.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            if 'nav-open' in (page.locator('#composer-shell').get_attribute('class') or ''):
                page.locator('#composer-nav-close').click()
            wait_for_async_condition(page, "() => document.querySelector('#composer-nav').getBoundingClientRect().right <= 0")
            expect(page.locator('.composer-tool-summary')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile overflow'
            page.screenshot(path=str(folder / 'composer-tool-mobile.png'), full_page=True)
        assert not run.page_errors, run.page_errors
        print('PASS: Responses native images, unauthorized case denied, exact original payload, no extra analysis, negative instruction, persisted events, mobile layout')


if __name__ == '__main__':
    main()
