from pathlib import Path
import re
import tempfile
from playwright.sync_api import expect
from e2e_support import extension_session


def main():
    with extension_session('pd-input-safety-') as run:
        run.context.set_offline(True)
        # This checks our saved reference and embed URL, not third-party playback.
        run.context.route('https://player.bilibili.com/**', lambda route: route.fulfill(content_type='text/html', body='<title>Player fixture</title>'))
        page = run.open_page('library.html', wait_until='networkidle')
        if page.locator('#settings-dialog').is_visible():
            page.locator('#settings-close').click()
        page.evaluate('chrome.permissions.request = async () => false')
        page.locator('#add-menu > summary').click()
        page.locator('#add-video-reference').click()
        dialog = page.locator('#promptdirector-app-dialog')
        url = 'bilibili.com/video/BV1gveN6WEpC/?trackid=abc&spm_id_from=333.1007&p=2'
        dialog.locator('[name="url"]').fill(url)
        page.mouse.click(5, 5)
        expect(dialog).to_be_visible()
        expect(dialog.locator('[name="url"]')).to_have_value(url)
        shot = Path(tempfile.gettempdir()) / 'pd-input-safety.png'
        page.screenshot(path=str(shot))
        dialog.locator('[type="submit"]').click()
        expect(dialog).not_to_be_visible()
        entry = page.evaluate('''async () => {
          const state = await chrome.runtime.sendMessage({type:'GET_STATE'});
          return state.entries.find(e => e.mediaAssets.some(a=>a.reference?.url?.includes('BV1gveN6WEpC')));
        }''')
        assert entry, 'Protocol-less video link must save an actual case'
        assert entry['mediaAssets'][0]['reference']['url'] == 'https://www.bilibili.com/video/BV1gveN6WEpC/?p=2'
        page.locator(f'.case-card[data-entry-id="{entry["id"]}"]').click()
        expect(page.locator('.referenced-video-embed iframe')).to_have_attribute('src', re.compile('.*bvid=BV1gveN6WEpC.*'))
        page.locator('#detail-close').click()
        page.locator('#select-cases').click()
        page.locator('.case-card').first.click()
        if not page.locator('#share-export').is_visible():
            page.locator('#selection-more-menu > summary').click()
        page.locator('#share-export').click()
        expect(page.locator('#share-dialog')).to_be_visible()
        page.mouse.click(5, 5)
        expect(page.locator('#share-dialog')).to_be_visible()
        page.locator('#share-dialog-close').click()
        # Exercise the shared dialog used by renaming and other input callers.
        page.evaluate('''() => { import('./ui-dialogs.js').then(({promptAppText}) => {
          window.dialogResult = 'waiting';
          promptAppText({title:'重命名项目',value:'保留输入'}).then(v=>window.dialogResult=v);
        }); }''')
        expect(dialog).to_be_visible()
        page.mouse.click(5, 5)
        expect(dialog.locator('input')).to_have_value('保留输入')
        dialog.locator('.app-dialog-close').click()
        expect(dialog).not_to_be_visible()
        # Backdrop/Escape cannot settle a pending action or lose its failure.
        page.evaluate('''() => { import('./ui-dialogs.js').then(({showAppDialog}) => {
          window.dialogResult='waiting';
          showAppDialog({title:'执行中',fields:[{id:'value',value:'draft'}],onSubmit:()=>new Promise((_,reject)=>window.rejectSubmit=reject)}).then(v=>window.dialogResult=v);
        }); }''')
        expect(dialog).to_be_visible()
        dialog.locator('[type="submit"]').click()
        page.keyboard.press('Escape')
        page.mouse.click(5, 5)
        expect(dialog).to_be_visible()
        assert page.evaluate('window.dialogResult') == 'waiting'
        page.evaluate('window.rejectSubmit(new Error("保留错误和输入"))')
        expect(dialog.locator('.app-dialog-status')).to_have_text('保留错误和输入')
        expect(dialog.locator('input')).to_have_value('draft')
        dialog.locator('.app-dialog-close').click()
        expect(dialog).not_to_be_visible()
        print({'bare_url_saved_and_reopened': True, 'input_backdrop_preserved': True, 'pending_escape_preserved': True, 'screenshot': str(shot)})

if __name__ == '__main__': main()
