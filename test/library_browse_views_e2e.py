"""Two views preserve cases, navigation and selection without widening the sidebar."""
from pathlib import Path
import tempfile
from playwright.sync_api import expect
from e2e_support import extension_session, base_entry


def main():
    output = Path(tempfile.gettempdir()) / 'pd-browse18-evidence'
    output.mkdir(exist_ok=True)
    long_name = '非常长的项目名称LongProjectNameWithoutSpaces' * 4
    entries = [base_entry('browse-a', '根项目直属案例', 'root prompt', 'content:prompt:image', 0),
               base_entry('browse-b', '子项目案例', 'child prompt', 'content:prompt:image', 1),
               base_entry('browse-c', '孙项目案例', 'grandchild prompt', 'content:prompt:image', 2)]
    projects = [dict(id='root', name=long_name, parentId=None, entryIds=['browse-a'], order=0, visibility='library'),
                dict(id='child', name=long_name, parentId='root', entryIds=['browse-b','browse-a'], order=0, visibility='library'),
                dict(id='grand', name='孙项目', parentId='child', entryIds=['browse-c'], order=0, visibility='library')]
    projects += [dict(id=f'sibling-{i}', name=f'普通项目 {i}', parentId=None, entryIds=[], order=i+1, visibility='library') for i in range(6)]
    with extension_session('pd-browse18-', viewport={'width':1440,'height':900}) as session:
        setup = session.open_page('collector.html')
        session.seed_storage(setup, {'entries': entries, 'organizerState': {'version':1, 'collections':projects}, 'uiPreferences': {'locale':'zh-CN','theme':'dark','motion':'reduced'}})
        page = session.open_page('library.html', wait_until='networkidle')
        page.locator('.project-row[data-collection-id="root"] .project-filter').click()
        expect(page.locator('#case-list .case-card')).to_have_count(1)
        page.locator('#include-subprojects').uncheck()
        expect(page.locator('#case-list .case-card')).to_have_count(1)
        toolbar_geometry = """() => [...document.querySelectorAll('#browse-scope, [data-gallery-view], #gallery-sort, #manage-case-order, #select-cases')].map(el => {
          const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
        })"""
        before_scope = page.evaluate(toolbar_geometry)
        page.locator('#manage-case-order').click()
        expect(page.locator('#select-cases')).to_be_visible()
        expect(page.locator('#select-cases')).to_be_disabled()
        assert page.evaluate(toolbar_geometry) == before_scope
        page.locator('#manage-case-order').click()
        page.locator('#gallery-sort').select_option('added-desc')
        expect(page.locator('#select-cases')).to_be_enabled()
        assert page.evaluate(toolbar_geometry) == before_scope
        page.locator('#include-subprojects').check()
        expect(page.locator('#case-list .case-card')).to_have_count(4)
        expect(page.locator('#manage-case-order')).to_be_visible()
        expect(page.locator('#manage-case-order')).to_be_disabled()
        assert page.evaluate(toolbar_geometry) == before_scope
        page.locator('#browse-scope span').dblclick()
        assert page.evaluate('getSelection().toString()') == ''
        assert page.locator('#search-input').evaluate('el => getComputedStyle(el).userSelect') == 'text'
        assert page.locator('.case-row-title').first.evaluate('el => getComputedStyle(el).userSelect') == 'none'
        page.locator('#include-subprojects').check()
        assert page.evaluate(toolbar_geometry) == before_scope
        for button in page.locator('[data-gallery-view]').all():
            assert not button.inner_text().strip()
            assert button.get_attribute('aria-label')

        for mode in ['list','waterfall','list']:
            page.locator(f'[data-gallery-view="{mode}"]').click()
            expect(page.locator(f'[data-gallery-view="{mode}"]')).to_have_attribute('aria-pressed','true')
            expect(page.locator('#case-list .case-card')).to_have_count(4)
            expect(page.locator('#project-section')).to_be_visible()
            page.locator('#search-input').fill('grandchild')
            expect(page.locator('#case-list .case-card')).to_have_count(1)
            page.locator('#search-input').fill('no-result-for-this-query')
            expect(page.locator('#case-list .case-card')).to_have_count(0)
            expect(page.locator('#empty-state')).to_be_visible()
            page.locator('#search-input').fill('')
            expect(page.locator('#case-list .case-card')).to_have_count(4)
            page.screenshot(path=str(output / f'desktop-{mode}.png'))
            if mode == 'list': page.locator('#gallery-view-controls').screenshot(path=str(output / 'view-controls.png'))
        page.locator('#include-subprojects').uncheck()
        page.locator('.project-folder-card[data-collection-id="child"]').click()
        expect(page.locator('#case-list .case-card')).to_have_count(2)
        page.locator('.project-folder-card[data-collection-id="grand"]').click()
        expect(page.locator('#case-list .case-card')).to_have_count(1)
        page.locator('#browse-breadcrumb [data-project-id="root"]').click()
        expect(page.locator('#case-list .case-card')).to_have_count(1)
        expect(page.locator('#project-folder-list .project-menu')).to_have_count(0)
        folder = page.locator('.project-folder-card').first
        before_folder = folder.bounding_box()
        folder.hover()
        assert folder.bounding_box() == before_folder
        expect(folder).to_have_class(__import__('re').compile('.*button-secondary.*'))
        page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        folder_colors = folder.evaluate("""el => {
          const probe=document.createElement('span');probe.style.backgroundColor='var(--hover)';el.append(probe);
          const expected=getComputedStyle(probe).backgroundColor;probe.remove();
          return {expected,actual:getComputedStyle(el).backgroundColor};
        }""")
        assert folder_colors['actual'] == folder_colors['expected'], folder_colors
        folder.focus()
        assert folder.bounding_box() == before_folder
        page.screenshot(path=str(output / 'folder-focus.png'))
        page.locator('.project-row[data-collection-id="child"] .project-menu summary').click()
        expect(page.locator('.project-row[data-collection-id="child"] .project-menu[open]')).to_contain_text('重命名')
        page.locator('.project-row[data-collection-id="child"] .project-menu summary').click()
        page.locator('#include-subprojects').check()
        page.locator('[data-gallery-view="list"]').click()
        sidebar = page.locator('#filter-sidebar').bounding_box()
        project_geometry = """() => [...document.querySelectorAll('.project-row')].map(row => {
          const r = row.getBoundingClientRect(), label = row.querySelector('.project-filter').getBoundingClientRect();
          return {id: row.dataset.collectionId, x:r.x, y:r.y, width:r.width, height:r.height, nameWidth:label.width};
        })"""
        before_rows = page.evaluate(project_geometry)
        page.locator('#select-cases').click()
        page.locator('#case-list .case-card').first.click()
        expect(page.locator('#case-list .selected-for-share')).to_have_count(1)
        assert page.locator('#filter-sidebar').bounding_box()['width'] == sidebar['width']
        after_rows = page.evaluate(project_geometry)
        assert before_rows == after_rows, {'before':before_rows, 'after':after_rows}
        icon_sizes = page.evaluate("""() => ['[data-gallery-view="waterfall"] .ui-icon', '[data-gallery-view="list"] .ui-icon', '#select-cases .ui-icon'].map(selector => {
          const css=getComputedStyle(document.querySelector(selector)); return [css.width,css.height,css.strokeWidth];
        })""")
        assert icon_sizes[0] == icon_sizes[1] == icon_sizes[2], icon_sizes
        page.screenshot(path=str(output / 'desktop-management.png'))
        page.locator('#share-cancel').click()
        page.locator('#case-list .case-card').first.click()
        expect(page.locator('#detail-drawer')).to_have_attribute('aria-hidden','false')
        assert page.locator('#detail-content').evaluate('el => getComputedStyle(el).userSelect') != 'none'
        page.keyboard.press('Escape')
        page.locator('#include-subprojects').uncheck()
        browse_geometry = """() => ['.gallery-heading','#project-folder-list','#case-list','#case-list .case-card'].map(selector => {
          const r=document.querySelector(selector).getBoundingClientRect(); return {selector,x:r.x,y:r.y,width:r.width,height:r.height};
        })"""
        for width in [1440,900,390]:
            page.set_viewport_size({'width':width,'height':844})
            for mode in ['waterfall','list']:
                if width <= 1100: page.locator('#toolbar-more > summary').click()
                page.locator(f'[data-gallery-view="{mode}"]').click()
                page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (width,mode)
                for name in page.locator('.project-folder-name').all():
                    assert name.evaluate('el => el.scrollWidth <= el.clientWidth + 1')
                page.screenshot(path=str(output / f'{width}-{mode}.png'))
                assert page.locator('.gallery-heading').bounding_box()['height'] <= 53
                scope_box = page.locator('#browse-scope').bounding_box()
                controls_box = page.locator('#gallery-view-controls').bounding_box()
                if width > 1100:
                    assert abs(scope_box['y'] + scope_box['height']/2 - controls_box['y'] - controls_box['height']/2) <= 1
                else:
                    assert scope_box['x'] >= 0 and scope_box['x'] + scope_box['width'] <= width
                    assert controls_box['y'] <= scope_box['y'] < controls_box['y'] + controls_box['height']
                before_browse = page.evaluate(browse_geometry)
                page.locator('#select-cases').click()
                assert page.evaluate(browse_geometry) == before_browse, ('enter management',width,mode,before_browse,page.evaluate(browse_geometry))
                page.locator('#case-list .case-card').first.click()
                assert page.evaluate(browse_geometry) == before_browse, ('select case',width,mode,before_browse,page.evaluate(browse_geometry))
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), ('selection',width,mode)
                page.screenshot(path=str(output / f'{width}-{mode}-management.png'))
                page.locator('#share-cancel').click()
                assert page.evaluate(browse_geometry) == before_browse, ('exit management',width,mode)
        page.reload(wait_until='networkidle')
        expect(page.locator('[data-gallery-view="list"]')).to_have_attribute('aria-pressed','true')
        # Theme/locale switches preserve browse preferences.
        page.evaluate("async () => { const {updateUiPreferences} = await import(chrome.runtime.getURL('i18n.js')); const {uiPreferences} = await chrome.storage.local.get('uiPreferences'); await updateUiPreferences({...uiPreferences, locale:'en',theme:'light'}); }")
        page.wait_for_load_state('networkidle')
        expect(page.locator('[data-gallery-view="list"]')).to_have_attribute('aria-pressed','true')
        expect(page.locator('[data-gallery-view="list"]')).to_have_attribute('title','List')
        page.screenshot(path=str(output / '390-light-en-list.png'))
        english_before = page.evaluate(browse_geometry)
        page.locator('#toolbar-more > summary').click()
        page.locator('#select-cases').click()
        page.locator('#case-list .case-card').first.click()
        assert page.evaluate(browse_geometry) == english_before
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        page.locator('#selection-project-menu summary').click()
        expect(page.locator('#selection-project-target')).to_be_visible()
        menu_box = page.locator('#selection-project-menu .selection-menu-panel').bounding_box()
        assert menu_box['x'] >= 0 and menu_box['x'] + menu_box['width'] <= 390
        page.screenshot(path=str(output / '390-light-en-management.png'))
        page.locator('#selection-project-menu summary').click()
        page.locator('#share-cancel').click()
        assert page.evaluate(browse_geometry) == english_before
        assert not session.page_errors, session.page_errors
        page.close()
        session.seed_storage(setup, {'entries':entries,'organizerState':{'version':1,'collections':[
            dict(id='sample-root',name='Higgs开源精选',parentId=None,entryIds=[],order=0,visibility='library'),
            dict(id='sample-video',name='Higgs视频',parentId='sample-root',entryIds=['browse-a','browse-b'],order=0,visibility='library'),
            dict(id='sample-curated',name='Higgsfield 精选案例',parentId='sample-root',entryIds=['browse-c'],order=1,visibility='library')
        ]},'uiPreferences':{'locale':'zh-CN','theme':'dark','motion':'reduced','galleryView':'waterfall'}})
        preview = session.open_page('library.html',wait_until='networkidle')
        preview.set_viewport_size({'width':1440,'height':800})
        preview.locator('.project-row[data-collection-id="sample-root"] .project-filter').click()
        for content_id, icon in [('content:audio','audio-lines'),('content:source-file','file-box'),('content:reference','file-text')]:
            use = preview.locator(f'[data-content-filter-id="{content_id}"] .ui-icon use')
            expect(use).to_have_attribute('href', __import__('re').compile(f'.*#icon-{icon}$'))
        for selector in ['#browse-breadcrumb button', '.project-disclosure:not(.is-placeholder)', '#create-collection']:
            control = preview.locator(selector).first
            control.hover()
            expected = control.evaluate("""el => {
              const probe=document.createElement('span');probe.style.backgroundColor='var(--hover)';el.append(probe);
              const value=getComputedStyle(probe).backgroundColor;probe.remove();return value;
            }""")
            expect(control).to_have_css('background-color', expected)
        folder_icon = preview.locator('.project-folder-card > .ui-icon').first
        accent = folder_icon.evaluate("""el => {
          const probe=document.createElement('span');probe.style.color='var(--accent-ink)';el.parentElement.append(probe);
          const value=getComputedStyle(probe).color;probe.remove();return value;
        }""")
        expect(folder_icon).to_have_css('color',accent)
        preview.locator('[data-sidebar-module="types"] .sidebar-module-toggle').click()
        preview.locator('#content-filters').screenshot(path=str(output / 'content-icons.png'))
        preview.locator('.project-folder-card').last.hover()
        preview.locator('#project-folder-list').screenshot(path=str(output / 'folder-cards.png'))
        preview.locator('.project-folder-card').last.click()
        expect(preview.locator('#case-list .case-card')).to_have_count(1)

    print({'views':2,'nested_scope':True,'management':True,'responsive':True,'persisted':True,'screenshots':str(output)})

if __name__ == '__main__':
    main()
