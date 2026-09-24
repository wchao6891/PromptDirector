"""Approved single-row chrome and vertical panels preserve existing library actions."""
from pathlib import Path
import tempfile
from playwright.sync_api import expect
from e2e_support import extension_session, base_entry, wait_for_async_condition

OUT = Path(tempfile.gettempdir()) / 'promptdirector-modular-layout'
OUT.mkdir(exist_ok=True)

def main():
    with extension_session('pd-modular-', viewport={'width':1440,'height':900}) as session:
        setup = session.open_page('collector.html')
        entries = [base_entry(f'case-{i}', f'视觉创作案例 {i+1}', f'创意提示词 {i}', 'content:prompt:image', i) for i in range(12)]
        projects = [dict(id='root',name='Higgs精选',entryIds=[e['id'] for e in entries],order=0),dict(id='child',name='非常长的项目名称LongProjectWithoutSpaces',parentId='root',entryIds=[],order=0)]
        projects += [dict(id=f'p-{i}', name=f'项目 {i+1}',entryIds=[],order=i+1) for i in range(25)]
        session.seed_storage(setup, {'entries':entries,'organizerState':{'version':7,'collections':projects},'uiPreferences':{'locale':'zh-CN','theme':'dark','motion':'reduced'}})
        page = session.open_page('library.html',wait_until='networkidle')
        expect(page.locator("body[data-library-state='ready']")).to_be_visible()
        assert not session.page_errors, session.page_errors
        page.locator('.project-row[data-collection-id="root"] .project-filter').click()
        expect(page.locator('#case-list .case-card')).to_have_count(12)
        expect(page.locator('#sidebar-types-body')).to_be_hidden()
        expect(page.locator('#sidebar-tags-body')).to_be_hidden()
        assert page.locator('#gallery-heading').evaluate("e=>e.parentElement.matches('.topbar')")
        assert page.locator('.topbar').bounding_box()['height']==56
        page.screenshot(path=str(OUT/'desktop-expanded.png'))
        # All module disclosures share one right column, independent of action count.
        arrows=page.locator('.module-chevron').evaluate_all('els=>els.map(e=>({right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}))')
        assert len({r['right'] for r in arrows})==1, arrows
        labels=page.locator('.module-label').evaluate_all('els=>els.map(e=>e.getBoundingClientRect().left)')
        assert len(set(labels))==1, labels
        assert all(r['width']==12 for r in arrows), arrows
        controls=page.locator('#create-collection,#collapse-projects,#manage-facets').evaluate_all('els=>els.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,border:getComputedStyle(e).borderTopWidth}))')
        assert all(r=={'w':28,'h':28,'border':'0px'} for r in controls), controls
        page.locator('[data-sidebar-module="projects"] .module-chevron').click()
        expect(page.locator('#sidebar-projects-body')).to_be_hidden()
        page.locator('#filter-sidebar').screenshot(path=str(OUT/'module-headers.png'))
        page.locator('[data-sidebar-module="projects"] .module-chevron').click()
        expect(page.locator('#sidebar-projects-body')).to_be_visible()
        # Module switching cannot resize the canvas; project viewport scrolls separately.
        before = page.locator('.gallery-shell').bounding_box()
        page.locator('[data-sidebar-module="types"] .sidebar-module-toggle').click()
        expect(page.locator('#sidebar-types-body')).to_be_visible()
        assert page.locator('.gallery-shell').bounding_box()==before
        page.locator('#content-filters [data-content-filter-id="content:prompt:image"]').click()
        page.locator('[data-sidebar-module="types"] .sidebar-module-toggle').click()
        expect(page.locator('[data-sidebar-module="types"] .module-active-count')).to_have_text('1')
        page.locator('[data-sidebar-module="types"] .sidebar-module-toggle').click()
        page.locator('#content-filters [data-content-filter-id="content:prompt:image"]').click()
        page.locator('[data-sidebar-module="types"] .sidebar-module-toggle').click()
        # Collapse means a useful rail, not a hidden sidebar.
        page.locator('#toggle-filters').click()
        expect(page.locator('.workspace')).to_have_class('workspace filters-collapsed')
        page.wait_for_function("() => document.querySelector('#filter-sidebar').getBoundingClientRect().width===48")
        expect(page.locator('#open-trash')).to_be_visible()
        page.screenshot(path=str(OUT/'desktop-rail.png'))
        page.locator('[data-sidebar-module="tags"] .sidebar-module-toggle').click()
        expect(page.locator('#sidebar-tags-body')).to_be_visible()
        expect(page.locator('#sidebar-projects-body')).to_be_hidden()
        page.locator('[data-sidebar-module="projects"] .sidebar-module-toggle').click()
        page.locator('[data-sidebar-module="tags"] .sidebar-module-toggle').click()
        # Keyboard reorder is equivalent to pointer reorder, persists and preserves data.
        grip=page.locator('[data-sidebar-module="types"] .module-grip')
        grip.focus(); page.keyboard.press('ArrowUp')
        wait_for_async_condition(page,"async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences.sidebarLayout.order[0]==='types'")
        page.locator('[data-sidebar-module="tags"] .module-grip').drag_to(page.locator('[data-sidebar-module="projects"] .filter-heading'))
        wait_for_async_condition(page,"async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences.sidebarLayout.order.join(',')==='types,tags,projects'")
        page.reload(wait_until='networkidle')
        assert page.locator('#sidebar-modules > section').first.get_attribute('data-sidebar-module')=='types'
        page.locator('.sidebar-layout-menu summary').click()
        page.locator('.sidebar-layout-menu button').filter(has_text='全部展开').click()
        for key in ['projects','types','tags']: expect(page.locator(f'#sidebar-{key}-body')).to_be_visible()
        page.locator('.sidebar-layout-menu summary').click()
        page.locator('.sidebar-layout-menu button').filter(has_text='恢复默认布局').click()
        expect(page.locator('#sidebar-types-body')).to_be_hidden()
        # No movement of the canvas when switching management or descendant scope.
        if page.locator('.project-row[data-collection-id="root"] .project-filter').get_attribute('aria-pressed')!='true':
            page.locator('.project-row[data-collection-id="root"] .project-filter').click()
        for width in [1440,900,390]:
            page.set_viewport_size({'width':width,'height':900})
            for view in ['waterfall','list']:
                if width<=1100: page.locator('#toolbar-more > summary').click()
                page.locator(f'[data-gallery-view="{view}"]').click()
                page.screenshot(path=str(OUT/f'{width}-{view}-scope.png'))
                page.locator('#include-subprojects').check()
                page.locator('#include-subprojects').uncheck()
                if width<=1100: page.locator('#toolbar-more > summary').click()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), width
                before=page.locator('#case-list').bounding_box()
                if width<=1100: page.locator('#toolbar-more > summary').click()
                page.locator('#select-cases').click()
                expect(page.locator('#share-cancel')).to_be_visible()
                expect(page.locator('#search-input')).to_be_visible()
                page.locator('#search-input').fill('视觉')
                expect(page.locator('#case-list .case-card')).to_have_count(12)
                page.locator('#search-input').fill('')
                after=page.locator('#case-list').bounding_box()
                assert before['x']==after['x'] and before['y']==after['y'] and before['width']==after['width'],(width,before,after)
                page.locator('#case-list .case-card').first.click()
                page.screenshot(path=str(OUT/f'{width}-{view}-management.png'))
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
                page.locator('#share-cancel').click()
                page.screenshot(path=str(OUT/f'{width}-{view}.png'))
        # Existing global actions remain reachable from the compact toolbar.
        page.locator('#toolbar-more > summary').click()
        expect(page.locator('#start-compose')).to_be_visible()
        page.locator('#add-menu summary').click()
        expect(page.locator('#add-media')).to_be_visible()
        page.keyboard.press('Escape')
        page.set_viewport_size({'width':1440,'height':900})
        if not page.locator('#sidebar-projects-body').is_visible():
            page.locator('[data-sidebar-module="projects"] .sidebar-module-toggle').click()
        page.locator('.project-row[data-collection-id="p-0"] .project-filter').click()
        page.locator('#empty-filter button').click()
        expect(page.locator('#project-selection-actions')).to_be_visible()
        for width in [1440,390]:
            page.set_viewport_size({'width':width,'height':900})
            page.locator('#search-input').fill('视觉')
            expect(page.locator('#case-list .case-card')).to_have_count(12)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.locator('#project-selection-cancel').click()
        page.locator('#search-input').fill('')
        page.set_viewport_size({'width':1440,'height':900})
        await_theme = """async()=>{const p=(await chrome.storage.local.get('uiPreferences')).uiPreferences;await chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:{...p,locale:'en',theme:'light'}})}"""
        page.evaluate(await_theme)
        page.wait_for_load_state('networkidle')
        expect(page.locator('html')).to_have_attribute('lang','en')
        page.screenshot(path=str(OUT/'english-light.png'))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not session.page_errors,session.page_errors
        print('PASS: one-row toolbar, vertical dock/rail, independent scrolling, filters, persisted order/reset, two views/management/scope at 1440/900/390, compact actions, English/light')

if __name__=='__main__': main()
