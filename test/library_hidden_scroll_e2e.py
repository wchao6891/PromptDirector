"""Hidden scrollbar tracks must preserve pointer and keyboard reading of long content."""
from pathlib import Path
import tempfile
from e2e_support import extension_session,base_entry
from playwright.sync_api import expect
with extension_session('pd-hidden-scroll-',viewport={'width':1440,'height':900}) as s:
    setup=s.open_page('collector.html')
    entry=base_entry('scroll-case','长提示词案例','\n'.join(f'第{i}行提示词，完整保留内容。' for i in range(220)),'content:prompt:image')
    s.seed_storage(setup,{'entries':[entry],'organizerState':{'version':7,'collections':[dict(id=f'p{i}',name=f'项目 {i}',entryIds=[],order=i) for i in range(70)]},'uiPreferences':{'locale':'zh-CN','motion':'reduced'}})
    page=s.open_page('library.html',wait_until='networkidle')
    body=page.locator('#sidebar-projects-body')
    assert body.evaluate('e=>getComputedStyle(e).scrollbarWidth')=='none'
    body.hover(); page.mouse.wheel(0,550)
    page.wait_for_function("()=>document.querySelector('#sidebar-projects-body').scrollTop>0")
    page.locator('.case-card').click()
    expect(page.locator('#detail-drawer')).to_have_attribute('aria-hidden','false')
    page.get_by_role('button',name='展开全文',exact=True).first.click()
    page.evaluate("""()=>{const region=[...document.querySelectorAll('#detail-drawer, #detail-drawer *')].find(e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight&&['auto','scroll'].includes(getComputedStyle(e).overflowY));if(!region)throw Error('No overflowing detail region');region.dataset.scrollProbe='true'}""")
    prompt=page.locator('[data-scroll-probe]')
    assert prompt.evaluate('e=>getComputedStyle(e).scrollbarWidth')=='none'
    prompt.hover();page.mouse.wheel(0,500)
    page.wait_for_function("()=>document.querySelector('[data-scroll-probe]').scrollTop>0")
    # Native keyboard scrolling remains available when the region is focused.
    prompt.evaluate('e=>e.focus()')
    before=prompt.evaluate('e=>e.scrollTop')
    page.keyboard.press('PageDown')
    page.wait_for_function('(before)=>document.querySelector("[data-scroll-probe]").scrollTop>before',arg=before)
    assert page.locator('#detail-drawer').evaluate("e=>[e,...e.querySelectorAll('*')].every(n=>getComputedStyle(n).scrollbarWidth==='none')")
    page.screenshot(path=str(Path(tempfile.gettempdir()) / 'promptdirector-hidden-scroll.png'))
    assert not s.page_errors,s.page_errors
    print('PASS: sidebar and nested details hide scrollbar tracks; wheel and PageDown still scroll long content; no page errors')
