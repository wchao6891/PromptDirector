from __future__ import annotations

import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session


def row(page, project_id):
    return page.locator(f'.project-row[data-collection-id="{project_id}"]')


def move_dialog(page, source, query, label, position='inside'):
    row(page, source).locator('summary').click()
    row(page, source).get_by_role('button', name='移动到…', exact=True).click()
    dialog = page.locator('#promptdirector-app-dialog')
    dialog.locator('[name="destination"]').fill(query)
    dialog.get_by_role('option', name=label, exact=True).click()
    if dialog.locator('[name="position"]').is_enabled():
        dialog.locator('[name="position"]').select_option(position)
    return dialog


def state(page):
    return page.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).organizerState.collections")


def drag_to(page, source, target, position='inside'):
    source_box = row(page, source).locator('.project-filter').bounding_box()
    page.mouse.move(source_box['x'] + source_box['width'] / 2, source_box['y'] + source_box['height'] / 2)
    page.mouse.down()
    page.mouse.move(source_box['x'] + source_box['width'] / 2, source_box['y'] + source_box['height'] / 2 + 8)
    target_box = row(page, target).bounding_box()
    y = target_box['y'] + (3 if position == 'before' else target_box['height'] - 3 if position == 'after' else target_box['height'] / 2)
    page.mouse.move(target_box['x'] + target_box['width'] / 2, y, steps=6)


def main():
    # Synthetic long library exercises distances; never touches the installed profile.
    projects = [dict(id=f'p{i}', name=f'项目 {i:03}', parentId=None, order=i, entryIds=[]) for i in range(100)]
    projects += [dict(id='child', name='子项目', parentId='p0', order=0, entryIds=['case']),
                 dict(id='grandchild', name='深层项目', parentId='child', order=0, entryIds=['case']),
                 dict(id='other-child', name='子项目', parentId='p1', order=0, entryIds=[])]
    with extension_session('prompt-director-project-tree-') as session:
        setup = session.open_page('collector.html')
        session.seed_storage(setup, {'schemaVersion':24, 'entries':[base_entry('case','案例','项目关系必须保留','content:prompt:image')], 'organizerState':{'version':4,'collections':projects}})
        page = session.open_page('library.html', wait_until='networkidle')
        expect(page.locator('body')).to_have_attribute('data-library-state','ready')
        expect(page.locator('#manage-project-order')).to_have_count(0)
        expect(page.locator('.project-row')).to_have_count(100)
        row(page,'p0').locator('.project-filter').click()
        expect(row(page,'p0').locator('.project-filter')).to_have_attribute('aria-pressed','true')
        row(page,'p0').locator('.project-filter').press('ArrowRight')
        expect(row(page,'child')).to_be_visible()
        page.reload(wait_until='networkidle')
        expect(row(page,'child')).to_be_visible()
        row(page,'child').locator('.project-filter').click()
        page.locator('#collapse-projects').click()
        expect(row(page,'child')).to_have_count(0)
        page.reload(wait_until='networkidle')
        expect(row(page,'child')).to_have_count(0)
        row(page,'p0').locator('.project-filter').click()
        page.locator('#project-search').fill('子项目')
        expect(page.locator('.project-row')).to_have_count(3)
        expect(row(page,'child').locator('.project-search-path')).to_contain_text('项目 000')
        expect(row(page,'other-child').locator('.project-search-path')).to_contain_text('项目 001')
        assert row(page,'child').locator('.project-filter').bounding_box()['width'] > 100
        page.locator('#project-search').fill('')
        expect(row(page,'child')).to_have_count(0)
        # A distant target is chosen by name, with no long drag or full expansion.
        page.locator('#project-search').fill('099')
        dialog = move_dialog(page,'p99','000','项目 000','before')
        dialog.get_by_role('button',name='移动',exact=True).click()
        expect(dialog).to_have_count(0)
        page.locator('#project-search').fill('')
        expect(page.locator('.project-filter-name').first).to_have_text('项目 099')
        page.locator('#project-move-undo').click()
        expect(page.locator('.project-filter-name').first).to_have_text('项目 000')
        # Menu at the bottom of the viewport must stay reachable.
        row(page,'p99').scroll_into_view_if_needed()
        row(page,'p99').locator('summary').click()
        panel = row(page,'p99').locator('.project-menu-panel')
        expect(panel.get_by_role('button',name='移动到…',exact=True)).to_be_in_viewport()
        assert panel.bounding_box()['y'] >= 0
        page.keyboard.press('Escape')
        # Move a whole subtree and undo without changing membership.
        page.locator('#project-search').fill('000')
        dialog = move_dialog(page,'p0','001','项目 001')
        dialog.get_by_role('button',name='移动',exact=True).click()
        expect(dialog).to_have_count(0)
        moved = {p['id']:p for p in state(page)}
        assert moved['p0']['parentId'] == 'p1'
        assert moved['child']['parentId'] == 'p0' and moved['child']['entryIds'] == ['case']
        assert moved['grandchild']['entryIds'] == ['case']
        page.locator('#project-move-undo').click()
        expect(page.locator('#project-order-status')).to_contain_text('已撤销')
        page.locator('#project-search').fill('')
        # Root moves are accessible through the same picker, with a visible root placement.
        page.locator('#project-search').fill('深层项目')
        dialog = move_dialog(page,'grandchild','项目根目录','项目根目录')
        expect(dialog.locator('[name="position"]')).to_be_disabled()
        dialog.get_by_role('button',name='移动',exact=True).click()
        expect(dialog).to_have_count(0)
        assert next(p for p in state(page) if p['id']=='grandchild')['parentId'] is None
        page.locator('#project-move-undo').click()
        expect(page.locator('#project-order-status')).to_contain_text('已撤销')
        page.locator('#project-search').fill('')
        # Direct pointer drag, without a manage-mode click.
        row(page,'p0').scroll_into_view_if_needed()
        drag_to(page,'p2','p1','before')
        page.mouse.up()
        expect(page.locator('.project-filter-name').nth(1)).to_have_text('项目 002')
        page.locator('#project-move-undo').click()
        expect(page.locator('.project-filter-name').nth(1)).to_have_text('项目 001')
        # Hover expansion is temporary and Escape restores the folded view.
        drag_to(page,'p2','p0')
        expect(row(page,'child')).to_be_visible(timeout=3000)
        page.keyboard.press('Escape')
        page.mouse.up()
        expect(row(page,'child')).to_have_count(0)
        # Leaving all targets must clear the last valid drop.
        baseline = state(page)
        drag_to(page,'p2','p0')
        page.mouse.move(750,450)
        page.mouse.up()
        assert state(page) == baseline
        # Edge scrolling continues while the pointer is stationary.
        drag_to(page,'p2','p3')
        sidebar = page.locator('#filter-sidebar')
        box = sidebar.bounding_box()
        before = sidebar.evaluate('node => node.scrollTop')
        page.mouse.move(box['x']+box['width']/2,box['y']+box['height']-8)
        page.wait_for_function('(before) => document.querySelector("#filter-sidebar").scrollTop > before + 120',arg=before)
        page.keyboard.press('Escape')
        page.mouse.up()
        # Failure is explicit and does not claim success or change data.
        page.locator('#project-search').fill('002')
        dialog = move_dialog(page,'p2','001','项目 001')
        page.evaluate("""() => {window.originalSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=(m,...args)=>m.type==='MOVE_COLLECTION'?Promise.resolve({ok:false,message:'模拟项目保存失败'}):window.originalSend.call(chrome.runtime,m,...args)}""")
        baseline = state(page)
        dialog.get_by_role('button',name='移动',exact=True).click()
        expect(dialog.locator('.app-dialog-status')).to_have_text('模拟项目保存失败')
        assert state(page) == baseline
        dialog.get_by_role('button',name='取消',exact=True).click()
        page.evaluate('() => {chrome.runtime.sendMessage=window.originalSend}')
        page.locator('#project-search').fill('')
        row(page,'p0').scroll_into_view_if_needed()
        # Keep toolbar reachable after a long scroll and menu usable in a narrow window.
        row(page,'p99').scroll_into_view_if_needed()
        expect(page.locator('#project-search')).to_be_in_viewport()
        page.set_viewport_size({'width':760,'height':740})
        if not row(page,'p99').is_visible():
            page.locator('#toggle-filters').click()
        row(page,'p99').scroll_into_view_if_needed()
        row(page,'p99').locator('summary').click()
        expect(row(page,'p99').get_by_role('button',name='移动到…',exact=True)).to_be_in_viewport()
        page.keyboard.press('Escape')
        page.set_viewport_size({'width':1280,'height':900})
        page.locator('#filter-sidebar').evaluate('node => node.scrollTop = 0')
        if os.environ.get('PROMPTDIRECTOR_PROJECT_TREE_EVIDENCE'):
            folder = Path(os.environ['PROMPTDIRECTOR_PROJECT_TREE_EVIDENCE'])
            folder.mkdir(parents=True,exist_ok=True)
            page.screenshot(path=str(folder/'project-tree.png'))
            dialog = move_dialog(page,'p2','000','项目 000')
            dialog.locator('[name="position"]').focus()
            expect(dialog.locator('.project-combobox-listbox')).to_be_hidden()
            page.screenshot(path=str(folder/'project-move.png'))
            dialog.get_by_role('button',name='取消',exact=True).click()
        print('Project tree: direct drag, folded reload/search, long move, menu placement, subtree retention, undo, hover/cancel, invalid drop, autoscroll and save failure passed.')

if __name__ == '__main__':
    main()
