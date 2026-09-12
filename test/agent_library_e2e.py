"""Real Chromium library/offscreen integration, with a test-only dispatcher hook.
Native transport is covered separately; this is not native permission acceptance.
"""
import base64
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-agent-browser-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() +
            '\n// Test-only transport boundary; production package has no hook.\n' +
            'globalThis.agentTestDispatch = dispatchAgentOperation;\n')
        with extension_session('pd-agent-library-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            run.seed_storage(page, {'entries': []})
            worker = run.context.service_workers[0]
            def call(operation, data):
                return worker.evaluate('([op, data]) => globalThis.agentTestDispatch(op, data)', [operation, data])
            def receipt(request_id):
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    result = call('get_task', {'requestId': request_id})
                    if result['state'] not in ('queued', 'running'):
                        assert result['state'] == 'completed', result
                        return result
                    time.sleep(0.05)
                raise AssertionError('Agent save did not finish')
            original = 'Fixture original document: 原始提示词与创作经验'.encode()
            digest = hashlib.sha256(original).hexdigest()
            transfer_id = 'browser-original'
            call('begin_transfer', {'id': transfer_id, 'name': 'original.txt', 'mimeType': 'text/plain', 'byteSize': len(original), 'sha256': digest})
            call('append_transfer', {'id': transfer_id, 'offset': 0, 'data': base64.b64encode(original).decode()})
            assert call('finish_transfer', {'id': transfer_id})['state'] == 'ready'
            args = {'requestId': 'browser-save', 'title': 'Agent browser fixture', 'text': 'Use the original as reference.', 'kind': 'creation', 'transferIds': [transfer_id], 'filePrompts': {transfer_id: '保留附件对应提示词'}}
            call('save_material', args)
            saved = receipt(args['requestId'])
            case_id = saved['result']['results'][0]['entryId']
            call('save_material', args)
            found = call('search', {'query': 'Agent browser fixture'})
            assert found['total'] == 1, found
            case = call('read_case', {'caseId': case_id})
            assert case['content'] == args['text'], case
            assert case['provenance']['kind'] == 'creation', case
            prompts = call('read_case', {'caseId': case_id, 'part': 'media_prompts'})
            assert '保留附件对应提示词' in prompts['content'], prompts
            asset_id = case['media'][0]['assetId']
            media = call('read_media', {'caseId': case_id, 'assetId': asset_id})
            assert base64.b64decode(media['data']) == original
            assert media['sha256'] == digest
            document = call('read_case', {'caseId': case_id, 'part': 'document'})
            assert '原始提示词与创作经验' in document['content'], document
            page.reload()
            page.wait_for_function("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.length === 1")
            assert page.locator('#toggle-agent-connection').count() == 1
            assert page.locator('#agent-connection-help').count() == 1
            run.seed_storage(page, {'capturePermissionOnboarding': {'version': 1, 'acknowledgedAt': '2026-09-12T00:00:00Z', 'clipboardIncluded': True}})
            page.evaluate("() => { if (!document.querySelector('#settings-dialog').open) document.querySelector('#open-settings').click(); }")
            page.locator('[data-settings-tab="general"]').click()
            # Clipboard is isolated to the test; clicking still runs the actual
            # instance preparation and builds the same user-facing request.
            page.evaluate("() => { navigator.clipboard.writeText = async text => { window.copiedAgentRequest = text; }; }")
            page.locator('#copy-agent-connection').click()
            page.wait_for_function('() => !!window.copiedAgentRequest')
            copied = page.evaluate('window.copiedAgentRequest')
            connection = page.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_AGENT_CONNECTION'})).connection")
            assert connection['instanceId'] in copied and 'connector/INSTALL.md' in copied
            assert connection['enabled'] is False, connection
            page.locator('#copy-agent-connection').click()
            assert page.evaluate('window.copiedAgentRequest') == copied
            page.locator('#copy-agent-connection').scroll_into_view_if_needed()
            evidence = Path(os.environ.get('PROMPTDIRECTOR_LAB_EVIDENCE_DIR', str(ext)))
            evidence.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(evidence / 'agent-onboarding.png'))
            page.set_viewport_size({'width': 390, 'height': 844})
            page.screenshot(path=str(evidence / 'agent-onboarding-mobile.png'))
            print('PASS: actual worker, offscreen document preparation, original bytes, prompt association, search/read, retry and persistent library')

if __name__ == '__main__':
    main()
