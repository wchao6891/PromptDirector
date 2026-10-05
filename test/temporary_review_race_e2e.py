"""A pending original read must not erase feedback typed or saved during the wait."""
import base64
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-review-race-source-') as directory:
        extension = Path(directory)
        for path in EXTENSION_DIR.iterdir():
            if path.name not in ['background.js', 'library-agent-workspace.js']:
                (extension / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (extension / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() + '\nglobalThis.agentTestDispatch=dispatchAgentOperation;\n')
        original = "import { getMediaBlob } from './media-store.js';"
        gate = """import { getMediaBlob as readOriginal } from './media-store.js';
async function getMediaBlob(id) {
  if (globalThis.delayedReviewAsset === id) {
    globalThis.reviewReadPending = true;
    await new Promise(resolve => { globalThis.releaseReviewRead = resolve; });
  }
  return readOriginal(id);
}"""
        source = (EXTENSION_DIR / 'library-agent-workspace.js').read_text()
        assert source.count(original) == 1
        (extension / 'library-agent-workspace.js').write_text(source.replace(original, gate))
        with extension_session('pd-review-race-', extension_dir=extension) as run:
            page = run.open_page('library.html')
            run.seed_storage(page, {'entries': []})
            page.reload()
            worker = run.context.service_workers[0]

            def call(operation, data=None):
                return worker.evaluate('([operation,input])=>agentTestDispatch(operation,input)', [operation, data or {}])

            def snapshot():
                return call('read_live_workspace')

            png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW6kAAAAASUVORK5CYII=')
            page.locator('#temporary-review-file').set_input_files([
                {'name': 'first.png', 'mimeType': 'image/png', 'buffer': png},
                {'name': 'second.png', 'mimeType': 'image/png', 'buffer': png + b'2'}])
            expect(page.locator('#temporary-review-dialog')).to_be_visible()
            first = snapshot()['snapshot']['temporary']
            target = first['batch']['items'][1]['assetId']
            page.locator('#temporary-review-actions [data-review-feedback]').click()
            textarea = page.locator('#temporary-review-notes textarea')
            for actor in ['human', 'agent']:
                page.evaluate('(id)=>{globalThis.delayedReviewAsset=id;globalThis.reviewReadPending=false}', target)
                if actor == 'human':
                    page.locator('#temporary-review-actions [data-review-media=next]').click()
                else:
                    current = snapshot()
                    worker.evaluate("input=>{globalThis.pendingReviewSwitch=agentTestDispatch('control_workspace',input).catch(e=>({code:e.code}));return true}",
                        {'tabId': current['tabId'], 'requestId': 'switch-race', 'expectedRevision': current['controlRevision'],
                         'action': 'select_media', 'assetId': target})
                page.wait_for_function('()=>globalThis.reviewReadPending')
                textarea.fill('加载期间补写的备注 ' + actor)
                page.evaluate('()=>globalThis.releaseReviewRead()')
                if actor == 'agent':
                    result = worker.evaluate('()=>globalThis.pendingReviewSwitch')
                    assert result.get('code') in ['workspace_changed', 'unsaved_workspace'], result
                else:
                    expect(page.locator('#temporary-review-actions [role=status]')).to_contain_text('请先保存当前备注')
                expect(textarea).to_have_value('加载期间补写的备注 ' + actor)
                current = snapshot()['snapshot']
                assert current['temporary']['assetId'] == first['assetId'], current
                assert current['reviewFeedback']['dirty'], current
                textarea.fill('')
                textarea.blur()
            # A normal later switch still works and retains the first item's saved feedback.
            textarea.fill('保存后可以继续切换'); textarea.press('Enter')
            expect(page.locator('#temporary-review-notes form')).to_have_attribute('data-dirty', 'false')
            page.evaluate('()=>{globalThis.delayedReviewAsset=null}')
            page.locator('#temporary-review-actions [data-review-media=next]').click()
            expect(page.locator('.detail-media-position')).to_have_text('2/2')
            page.locator('#temporary-review-actions [data-review-media=previous]').click()
            expect(page.locator('.detail-media-position')).to_have_text('1/2')
            assert snapshot()['snapshot']['temporary']['feedback']['notes'][0]['text'] == '保存后可以继续切换'
            print(json.dumps({'humanAndAgentWaitPreserveDraft': True, 'normalSwitchStillWorks': True, 'savedNoteRetained': True}))


if __name__ == '__main__':
    main()
