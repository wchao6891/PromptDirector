"""English shared-dialog contract, exercised in a disposable extension profile."""
from pathlib import Path
import argparse
import json
import tempfile
import re

from playwright.sync_api import expect
from e2e_support import extension_session, base_entry


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence-dir', type=Path)
    args = parser.parse_args()
    out = args.evidence_dir or Path(tempfile.mkdtemp(prefix='pd-dialog-localization-evidence-'))
    out.mkdir(parents=True, exist_ok=True)
    with extension_session('pd-dialog-localization-', viewport={'width': 1280, 'height': 900}) as run:
        setup = run.open_page('collector.html')
        original_entries = [base_entry('a', 'First reference', 'Original text A', 'content:note'),
                            base_entry('b', 'Second reference', 'Original text B', 'content:note')]
        original_entries[0]['customLabels'] = ['保留中文标签']
        original_entries[0]['mediaAssets'] = [{'id':'dialog-image','kind':'image','storageMode':'managed','mimeType':'image/png','width':2,'height':2}]
        original_entries[0]['primaryMediaId'] = 'dialog-image'
        run.seed_storage(setup, {
            'entries': original_entries,
            'organizerState': {'version':1,'collections':[{'id':'collection:dialog','name':'保留我的中文项目','entryIds':['a','b'],'parentId':None,'order':0,'visibility':'library'}]},
            'uiPreferences': {'locale': 'en', 'theme': 'dark', 'motion': 'reduced'},
        })
        setup.evaluate("""async()=>{const {saveMediaBlob}=await import('./media-store.js');const canvas=document.createElement('canvas');canvas.width=canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);await saveMediaBlob('dialog-image',await new Promise(resolve=>canvas.toBlob(resolve,'image/png')))}""")
        baseline = setup.evaluate("() => chrome.runtime.sendMessage({type:'GET_STATE'})")
        page = run.open_page('library.html')
        page.wait_for_selector('body[data-library-state="ready"]')
        expect(page.locator('.case-card')).to_have_count(2)
        page.locator('#select-cases').click()
        page.locator('.case-card').nth(0).click()
        page.locator('.case-card').nth(1).click()
        page.locator('#selection-more-menu > summary').click()
        page.locator('#selection-combine').click()
        dialog = page.locator('#promptdirector-app-dialog')
        expect(dialog.get_by_role('heading')).to_have_text('Combine cases')
        expect(dialog.locator('[type=submit]')).to_have_text('Create combined case')
        expect(dialog.get_by_text('Combined case name', exact=True)).to_be_visible()
        page.screenshot(path=str(out / 'english-combine.png'))
        dialog.locator('input').fill('Combined reference')
        dialog.locator('[type=submit]').click()
        expect(dialog).not_to_be_visible()
        expect(page.locator('.case-card')).to_have_count(1)
        state = page.evaluate("() => chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert {e['id']: e['text'] for e in state['entries']} == {'a': 'Original text A', 'b': 'Original text B'}
        assert len(state['compoundCases']) == 1
        # Exercise the real split caller, not just the shared dialog constructor.
        page.locator('.case-card').first.click()
        page.get_by_role('button', name='Split into separate cases', exact=True).click()
        expect(dialog).to_be_visible()
        for width in [1280,390]:
            page.set_viewport_size({'width':width,'height':900})
            page.screenshot(path=str(out / f'english-real-split-{width}.png'))
            assert dialog.evaluate('el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth}')
        page.set_viewport_size({'width':1280,'height':900})
        split_text = dialog.inner_text()
        print(json.dumps({'realSplitDialog': split_text, 'screenshots': str(out)}, ensure_ascii=False), flush=True)
        assert not re.search(r'[\u3400-\u9fff]', split_text), split_text
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        cancelled = page.evaluate("() => chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert len(cancelled['compoundCases']) == 1
        page.get_by_role('button', name='Split into separate cases', exact=True).click()
        dialog.get_by_role('button', name='Split', exact=True).click()
        expect(dialog).not_to_be_visible()
        expect(page.locator('.case-card')).to_have_count(2)
        split = page.evaluate("() => chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert split['compoundCases'] == [], split['compoundCases']
        assert split['entries'] == baseline['entries'], 'Split changed original entries'
        assert split['organizerState'] == baseline['organizerState'], 'Split changed original project relations'
        assert page.evaluate("""async()=>{const {getMediaBlob}=await import('./media-store.js');const blob=await getMediaBlob('dialog-image');return blob?.size>0&&blob.type==='image/png'}""")
        page.keyboard.press('Escape')
        # These constructors deliberately receive raw Chinese system labels, as real
        # callers do. User-authored field values must not be translated or discarded.
        for confirm, expected in [('拆分', 'Split'), ('放弃修改', 'Discard changes'),
                                  ('媒体移入回收站', 'Move media to recycle bin')]:
            page.evaluate('''({confirm}) => { import('./ui-dialogs.js').then(({showAppDialog}) => {
              void showAppDialog({title:'组合案例',confirmLabel:confirm,cancelLabel:'取消',
                fields:[{id:'title',label:'案例名称',value:'保留我的中文标题'}],
                onSubmit:()=>{throw new Error('手选范围已失效，请在当前页面重新选择一个案例')}});
            }); }''', {'confirm': confirm})
            expect(dialog.locator('[type=submit]')).to_have_text(expected)
            expect(dialog.get_by_role('button', name='Cancel', exact=True)).to_be_visible()
            dialog.locator('[type=submit]').click()
            expect(dialog.locator('.app-dialog-status')).to_have_text(
                'Your selection is no longer available. Select a case on the current page again.')
            expect(dialog.locator('.app-dialog-status')).to_have_count(1)
            expect(dialog.locator('input')).to_have_value('保留我的中文标题')
            if confirm == '拆分':
                page.screenshot(path=str(out / 'english-dialog-error.png'))
            dialog.get_by_role('button', name='Cancel', exact=True).click()
            expect(dialog).not_to_be_visible()
        assert not run.page_errors, run.page_errors
        print(json.dumps({'combineSaved': True, 'splitCancelAndConfirm': True, 'originalEntriesMediaAndProjectsPreserved': True,
                          'sharedDialogErrorTranslatedOnce': True, 'userTitlePreserved': True,
                          'screenshots': str(out)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
