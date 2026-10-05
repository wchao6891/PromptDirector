"""Layout settings stay in one dialog and never reset creative data or key bindings."""
import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session, wait_for_async_condition


def main():
    out = Path(os.environ['PD_E2E_ARTIFACT_DIR']) if os.environ.get('PD_E2E_ARTIFACT_DIR') else None
    if out: out.mkdir(parents=True, exist_ok=True)
    with extension_session('pd-layout-settings-', viewport={'width': 1440, 'height': 900}) as run:
        setup = run.open_page('collector.html')
        run.seed_storage(setup, {'entries': [{'id': 'source', 'title': 'Keep my case', 'text': 'Original stays',
            'customLabels': ['My label'], 'timeNotes': [{'id': 'note', 'text': 'My feedback', 'startSeconds': 1}]}],
            'uiPreferences': {'locale': 'zh-CN', 'theme': 'dark', 'motion': 'reduced',
                'floatingPanelPositions': {'tagEditor': {'left': .3, 'top': .2}}}})
        original = setup.evaluate("async()=> (await chrome.storage.local.get('entries')).entries")
        p = run.open_page('library.html')
        p.locator('#open-settings').click()
        p.locator('[data-settings-tab=layout]').click()
        panel = p.locator('#settings-layout-panel')
        expect(panel).to_be_visible()
        expect(panel.locator('[name=galleryView]')).to_have_value('waterfall')
        assert p.evaluate("async()=> (await chrome.runtime.sendMessage({type:'UPDATE_KEYBOARD_SHORTCUTS',shortcuts:{addFeedback:'N'}})).ok")
        panel.locator('[name=galleryView]').select_option('list')
        panel.locator('[name=detailMode]').select_option('sidebar')
        panel.locator('[name=sidebarWidth]').fill('320')
        panel.locator('[name=detailSidebarWidth]').fill('900')
        panel.locator('[name=detailPanelRatio]').fill('40')
        panel.locator('[name=sidebarCollapsed]').check()
        panel.get_by_role('button', name='保存当前布局', exact=True).click()
        expect(p.locator('#layout-feedback')).to_have_text('已保存')
        preferences = p.evaluate("async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences")
        assert preferences['shortcuts']['addFeedback'] == 'N'
        assert preferences['detailPanelRatio'] == .4 and preferences['detailSidebarWidth'] == 900
        assert preferences['floatingPanelPositions']['tagEditor'] == {'left': .3, 'top': .2}
        expect(p.locator('.gallery-shell')).to_have_attribute('data-view', 'list')
        # Verify the edited layout, not only a reset-to-default layout, across refresh.
        p.reload(); p.locator('#open-settings').click(); p.locator('[data-settings-tab=layout]').click()
        expect(panel.locator('[name=sidebarWidth]')).to_have_value('320')
        expect(panel.locator('[name=detailPanelRatio]')).to_have_value('40')
        # Named configurations capture live positions and do not round untouched splits.
        panel.locator('#layout-create').click()
        dialog = p.locator('#promptdirector-app-dialog')
        dialog.get_by_role('textbox', name='配置名称', exact=True).fill('审片布局')
        dialog.get_by_role('button', name='保存', exact=True).click()
        expect(panel.locator('#layout-config option:checked')).to_have_text('审片布局')
        first_id = panel.locator('#layout-config').input_value()
        setup.evaluate("async()=>{await chrome.runtime.sendMessage({type:'UPDATE_FLOATING_PANEL_POSITION',key:'tagEditor',position:{left:.4,top:.25}});await chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:{detailPanelRatio:.41313}})}")
        panel.locator('[name=sidebarWidth]').fill('410')
        panel.get_by_role('button', name='保存当前布局', exact=True).click()
        wait_for_async_condition(p, "async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences.sidebarWidth===410")
        saved = p.evaluate("async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences")
        assert saved['detailPanelRatio'] == .41313, 'Saving current layout rounded an untouched manual split'
        assert saved['layoutPresets'][1]['values']['floatingPanelPositions']['tagEditor'] == {'left':.4,'top':.25}
        panel.locator('[name=sidebarWidth]').fill('280')
        panel.locator('[name=detailPanelRatio]').fill('55')
        panel.locator('#layout-create').click()
        dialog.get_by_role('textbox', name='配置名称', exact=True).fill('资料布局')
        dialog.get_by_role('button', name='保存', exact=True).click()
        expect(panel.locator('#layout-config option:checked')).to_have_text('资料布局')
        second_id = panel.locator('#layout-config').input_value()
        panel.locator('#layout-config').select_option(first_id)
        expect(panel.locator('[name=sidebarWidth]')).to_have_value('410')
        expect(panel.locator('[name=detailPanelRatio]')).to_have_value('41')
        p.reload(); p.locator('#open-settings').click(); p.locator('[data-settings-tab=layout]').click()
        expect(panel.locator('#layout-config')).to_have_value(first_id)
        expect(panel.locator('[name=sidebarWidth]')).to_have_value('410')
        panel.locator('#layout-rename').click()
        dialog.get_by_role('textbox', name='配置名称', exact=True).fill('片段审阅')
        dialog.get_by_role('button', name='保存', exact=True).click()
        expect(panel.locator('#layout-config option:checked')).to_have_text('片段审阅')
        panel.locator('#layout-config').select_option('default')
        expect(panel.locator('[name=sidebarWidth]')).to_have_value('320')
        restored = p.evaluate("async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences")
        assert restored['floatingPanelPositions']['tagEditor'] == {'left':.3,'top':.2}
        panel.locator('#layout-config').select_option(first_id)
        expect(panel.locator('[name=sidebarWidth]')).to_have_value('410')
        restored = p.evaluate("async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences")
        assert restored['floatingPanelPositions']['tagEditor'] == {'left':.4,'top':.25}
        if out: p.screenshot(path=str(out/'layout-configurations.png'))
        panel.locator('#layout-delete').click()
        dialog.get_by_role('button', name='删除', exact=True).click()
        expect(panel.locator('#layout-config option')).to_have_count(2)
        assert second_id in panel.locator('#layout-config option').evaluate_all('opts=>opts.map(o=>o.value)')
        panel.locator('#layout-return').click()
        expect(p.locator('#settings-general-panel')).to_be_visible()
        p.locator('[data-settings-tab=layout]').click()
        expect(panel.locator('[name=sidebarWidth]')).to_have_value('410')
        if out: p.screenshot(path=str(out/'layout-dark-wide.png'))
        panel.locator('#layout-reset').click()
        wait_for_async_condition(p, "async()=>{const v=(await chrome.storage.local.get('uiPreferences')).uiPreferences;return v.galleryView==='waterfall'&&Object.keys(v.floatingPanelPositions).length===0}")
        preferences = p.evaluate("async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences")
        assert preferences['shortcuts']['addFeedback'] == 'N'
        assert len(preferences['layoutPresets']) == 2, 'Reset erased saved user configurations'
        assert preferences['theme'] == 'dark' and preferences['locale'] == 'zh-CN'
        assert p.evaluate("async()=> (await chrome.storage.local.get('entries')).entries") == original
        p.reload(); p.locator('#open-settings').click(); p.locator('[data-settings-tab=layout]').click()
        expect(panel.locator('[name=detailPanelRatio]')).to_have_value('')
        p.locator('[data-settings-tab=shortcuts]').click()
        expect(p.locator('#settings-shortcuts-panel .shortcut-hint, #shortcut-groups h2')).to_have_count(0)
        for theme, width in [('dark', 390), ('light', 1440), ('light', 390)]:
            setup.evaluate("async theme=>{const v=(await chrome.storage.local.get('uiPreferences')).uiPreferences;await chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:{...v,theme}})}", theme)
            p.close(); p = run.open_page('library.html'); panel = p.locator('#settings-layout-panel')
            p.set_viewport_size({'width': width, 'height': 844})
            p.locator('#open-settings').click(); p.locator('[data-settings-tab=layout]').click()
            expect(panel).to_be_visible()
            if out: p.screenshot(path=str(out/f'layout-{theme}-{width}.png'))
            assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'), panel.evaluate("e=>({width:e.clientWidth,scroll:e.scrollWidth,children:[...e.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>e.getBoundingClientRect().right).map(n=>({tag:n.tagName,class:n.className,name:n.name,width:n.getBoundingClientRect().width}))})")
        print('PASS: current/default and two named layouts save / apply / rename / delete / return / reset / reload; shortcuts, source and feedback retained; light/dark wide/narrow')


if __name__ == '__main__': main()
