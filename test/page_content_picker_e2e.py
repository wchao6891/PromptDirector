"""Synthetic shadow-comment fixture; production picker and extraction, no live-site claim."""
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session

ROOT=Path(__file__).resolve().parents[1]

def main():
    with extension_session('page-content-picker-') as run:
        run.context.route('https://wchao6891.github.io/picker-fixture',lambda route:route.fulfill(content_type='text/html',body='<html><body></body></html>'))
        page=run.context.new_page()
        page.goto('https://wchao6891.github.io/picker-fixture')
        page.set_content('<nav>Navigation must not be saved</nav><main><h1>Video title</h1><div id="comments"></div></main>')
        page.evaluate('''()=>{const root=document.querySelector('#comments').attachShadow({mode:'open'});root.innerHTML='<div class="comment"><p>用户指定的完整评论提示词，必须可以手动选中保存。</p><p>另一条评论内容。</p></div>';}''')
        picker=(ROOT/'extension/page-content-picker.js').read_text().replace('export function','function',1)
        page.add_script_tag(content=picker)
        page.evaluate('()=>{window.picked=pickPageContent();}')
        page.locator('#comments p').first.click()
        selected=page.evaluate('()=>window.picked')
        assert '用户指定' in selected['html'] and 'Navigation' not in selected['html'] and '另一条' not in selected['html'],selected
        setup=run.open_page('collector.html')
        capture=setup.evaluate("async()=>String((await import('./page-capture.js')).collectPageCaptureSnapshot)")
        result=page.evaluate('async ({source,html})=>await (0,eval)(`(${source})`)({manualContentHtml:html,sessionId:"manual"})',{'source':capture,'html':selected['html']})
        candidate=result['candidates'][0]
        assert '用户指定' in candidate['contentText'] and 'Navigation' not in candidate['contentText'],candidate
        page.evaluate('()=>{window.picked=pickPageContent();}')
        page.keyboard.press('Escape')
        assert page.evaluate('()=>window.picked')=={'cancelled':True}
        # Use the real extension message, preview and save, with an isolated empty library.
        run.seed_storage(setup, {'entries':[], 'uiPreferences':{'theme':'dark','motion':'reduced'}, 'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-19T00:00:00Z'}})
        setup.reload(wait_until="networkidle")
        page.bring_to_front()
        setup.evaluate("()=>document.querySelector('#start-selection').click()")
        expect(page.locator('#promptdirector-content-picker')).to_be_attached()
        page.locator('#comments p').first.click()
        expect(setup.locator('.page-capture-item.confirmed')).to_have_count(1)
        expect(setup.locator('.page-capture-article')).to_contain_text('用户指定')
        expect(setup.locator('#add-selection')).to_be_visible()
        expect(setup.locator('#add-selection')).to_be_enabled()
        page.bring_to_front()
        setup.evaluate("()=>document.querySelector('#add-selection').click()")
        expect(page.locator('#promptdirector-content-picker')).to_be_attached()
        page.locator('#comments p').nth(1).click()
        expect(setup.locator('.page-capture-article')).to_contain_text('另一条评论')
        setup.locator('.page-capture-preview-details').evaluate('node=>node.open=true')
        setup.locator('.page-capture-text-row').filter(has_text='另一条评论').get_by_role('button',name='移除',exact=True).click()
        expect(setup.locator('.page-capture-article')).not_to_contain_text('另一条评论')
        setup.locator('#page-capture-undo-region').click()
        expect(setup.locator('.page-capture-article')).to_contain_text('另一条评论')
        setup.locator('#page-capture-undo-region').click()
        expect(setup.locator('.page-capture-article')).not_to_contain_text('另一条评论')
        for theme in ['light','dark']:
            setup.evaluate('(value)=>document.documentElement.dataset.theme=value',theme)
            for width in [390,1280]:
                setup.set_viewport_size({'width':width,'height':844})
                setup.screenshot(path=f'/tmp/pd-picker-{theme}-{width}.png',full_page=True,animations='disabled')
        setup.locator('#page-capture-save').click()
        expect(setup.locator('#page-capture')).to_be_hidden(timeout=15000)
        entries=setup.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        assert len(entries)==1 and '用户指定' in entries[0]['text'] and '另一条' not in entries[0]['text'],entries
        print('PASS: shadow comments selected; extraction exact; immediate preview; append/undo; real save readback; Escape cancellation')

if __name__=='__main__':main()
