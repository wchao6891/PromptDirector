"""Image review, custom feedback keys and remembered floating tools use the real extension."""
import os
import re
import sys
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session


def main(mode='all'):
    out = Path(os.environ['PD_E2E_ARTIFACT_DIR']) if os.environ.get('PD_E2E_ARTIFACT_DIR') else None
    if out:
        out.mkdir(parents=True, exist_ok=True)
    results = {'mode': mode}
    with extension_session('pd-floating-review-', viewport={'width': 1440, 'height': 900}) as run:
        setup = run.open_page('collector.html')
        entries = [{'id': key, 'title': key, 'text': '原词保持', 'contentRole': 'prompt_image',
                    'classification': {'pathIds': ['content:prompt:image'], 'status': 'confirmed'},
                    'mediaAssets': [{'id': 'image', 'kind': 'image', 'storageMode': 'managed',
                                     'mimeType': 'image/png', 'width': 400, 'height': 300}],
                    'primaryMediaId': 'image'} for key in ['one', 'two']]
        run.seed_storage(setup, {'entries': entries, 'uiPreferences': {'locale': 'zh-CN', 'motion': 'reduced'}})
        setup.evaluate("""async () => {
            const {saveMediaBlob} = await import('./media-store.js');
            const c = document.createElement('canvas'); c.width=400; c.height=300;
            const x = c.getContext('2d'); x.fillStyle='#526b75'; x.fillRect(0,0,400,300);
            await saveMediaBlob('image', await new Promise(r=>c.toBlob(r,'image/png')));
        }""")
        p = run.open_page('library.html')
        drawer = p.locator('#detail-drawer')
        reviewing = re.compile('.*is-reviewing.*')
        panel = p.locator('#detail-drawer .review-feedback-panel')

        def open_case(key):
            p.locator(f'.case-card[data-entry-id={key}]').click()
            expect(drawer).to_have_attribute('data-entry-id', key)
            expect(p.locator('.detail-image')).to_be_visible()

        def drag(handle, dx, dy):
            handle.hover()  # Wait for the visible tool to finish its opening layout.
            box = handle.bounding_box()
            x, y = box['x'] + box['width']/2, box['y'] + box['height']/2
            p.mouse.move(x, y); p.mouse.down(); p.mouse.move(x+dx, y+dy, steps=5); p.mouse.up()

        def same_position(locator, expected):
            p.wait_for_function("""([selector,x,y]) => {
                const r=document.querySelector(selector).getBoundingClientRect();
                return Math.abs(r.x-x)<3 && Math.abs(r.y-y)<3;
            }""", arg=[locator, expected['x'], expected['y']])

        def skin(locator):
            return locator.evaluate("e=>{const s=getComputedStyle(e);return [s.borderRadius,s.padding,s.backgroundColor,s.borderColor,s.boxShadow]}")

        open_case('one')
        if mode in ['all', 'toggle']:
            p.locator('.detail-image').click(); expect(drawer).to_have_class(reviewing)
            p.locator('.detail-image').click(); expect(drawer).not_to_have_class(reviewing, timeout=2000)
            expect(p.locator('.original-prompt-panel .prompt-read-body')).to_have_text('原词保持')
            results['secondImageClickExits'] = True
        if mode in ['all', 'shortcut']:
            p.keyboard.press('m'); expect(panel).to_be_visible(timeout=2000)
            panel.locator('textarea').fill('图片反馈'); p.keyboard.press('Enter')
            expect(panel.locator('form')).to_have_attribute('data-dirty', 'false')
            assert p.evaluate("async()=>{const s=await chrome.storage.local.get('entries');return s.entries.find(e=>e.id==='one').timeNotes.some(n=>n.text==='图片反馈')}")
            panel.get_by_role('button', name='收起备注', exact=True).click()
            results['imageShortcutAndSave'] = True
        if mode in ['all', 'positions']:
            p.locator('.detail-image').click(); expect(drawer).to_have_class(reviewing)
            p.keyboard.press('m'); expect(panel).to_be_visible()
            drag(panel.locator('.panel-drag-handle'), -160, 90)
            p.wait_for_function("""async()=>{const v=(await chrome.storage.local.get('uiPreferences')).uiPreferences.floatingPanelPositions?.reviewFeedback;
                const r=document.querySelector('#detail-drawer .review-feedback-panel').getBoundingClientRect();
                return v&&Math.abs(r.x-v.left*innerWidth)<3&&Math.abs(r.y-v.top*innerHeight)<3;}""")
            note_box = panel.bounding_box(); note_skin = skin(panel)
            if out:
                p.screenshot(path=str(out/'note-grip-drag.png'))
            panel.get_by_role('button', name='收起备注', exact=True).click()
            p.locator('#detail-close').click(); open_case('two')
            p.locator('.detail-image').click(); expect(drawer).to_have_class(reviewing)
            p.keyboard.press('m'); expect(panel).to_be_visible()
            same_position('#detail-drawer .review-feedback-panel', note_box)
            panel.get_by_role('button', name='收起备注', exact=True).click()
            p.locator('#detail-review-toggle').click(); expect(drawer).not_to_have_class(reviewing)
            org = p.locator('.detail-quick-organization')
            org.get_by_role('button', name='添加标签', exact=True).click()
            row = org.locator('.tag-editor-row'); expect(row).to_be_visible()
            assert skin(row) == note_skin, (skin(row), note_skin)
            drag(row.locator('.panel-drag-handle'), -220, 50)
            p.wait_for_function("""async()=>{
                const v=(await chrome.storage.local.get('uiPreferences')).uiPreferences.floatingPanelPositions?.tagEditor;
                const r=document.querySelector('.tag-editor-compact .tag-editor-row').getBoundingClientRect();
                return v&&Math.abs(r.x-v.left*innerWidth)<3&&Math.abs(r.y-v.top*innerHeight)<3;
            }""")
            assert row.evaluate("e=>getComputedStyle(e).transitionProperty") == 'none', 'Reduced-motion rules animated the saved drag position'
            tag_box = row.bounding_box()
            org.get_by_role('textbox', name='添加标签', exact=True).fill('我的标签')
            org.get_by_role('textbox', name='添加标签', exact=True).press('Enter')
            expect(org.locator('.tag-editor-chip')).to_contain_text('我的标签')
            if out:
                p.screenshot(path=str(out/'tag-grip-drag.png'))
            org.get_by_role('textbox', name='添加标签', exact=True).press('Escape')
            p.locator('#detail-close').click(); p.reload(); open_case('one')
            org = p.locator('.detail-quick-organization')
            org.get_by_role('button', name='添加标签', exact=True).click()
            same_position('.tag-editor-compact .tag-editor-row', tag_box)
            org.get_by_role('textbox', name='添加标签', exact=True).press('Escape')
            p.locator('.detail-image').click(); expect(drawer).to_have_class(reviewing)
            p.keyboard.press('m'); expect(panel).to_be_visible()
            same_position('#detail-drawer .review-feedback-panel', note_box)
            p.set_viewport_size({'width': 390, 'height': 700})
            p.wait_for_function("()=>{const r=document.querySelector('#detail-drawer .review-feedback-panel').getBoundingClientRect();return innerWidth===390&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}")
            p.set_viewport_size({'width': 1440, 'height': 900})
            same_position('#detail-drawer .review-feedback-panel', note_box)
            panel.get_by_role('button', name='收起备注', exact=True).click()
            p.locator('#detail-review-toggle').click(); expect(drawer).not_to_have_class(reviewing)
            preserved = p.evaluate("async()=>{const s=await chrome.storage.local.get('uiPreferences');return s.uiPreferences.floatingPanelPositions}")
            # Older whole-settings writes and custom keys must preserve the latest drag.
            assert p.evaluate("""async()=>{const s=await chrome.storage.local.get('uiPreferences');
                return (await chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:{...s.uiPreferences,floatingPanelPositions:{}}})).ok}""")
            assert p.evaluate("async()=> (await chrome.runtime.sendMessage({type:'UPDATE_KEYBOARD_SHORTCUTS',shortcuts:{addFeedback:'N'}})).ok")
            assert p.evaluate("async()=>(await chrome.storage.local.get('uiPreferences')).uiPreferences.floatingPanelPositions") == preserved
            p.locator('#detail-close').focus(); p.keyboard.press('m'); expect(panel).not_to_be_visible()
            p.keyboard.press('n'); expect(panel).to_be_visible()
            panel.locator('textarea').fill('自定义按键反馈'); p.keyboard.press('Enter')
            expect(panel.locator('form')).to_have_attribute('data-dirty', 'false')
            panel.get_by_role('button', name='收起备注', exact=True).click(); p.locator('#detail-close').click()
            p.locator('#temporary-review-file').set_input_files(str(Path(__file__).parent/'fixtures/review-workspace-smoke.mp4'))
            temporary = p.locator('#temporary-review-dialog'); expect(temporary).to_be_visible()
            p.keyboard.press('n'); temp_note = temporary.locator('.review-feedback-panel'); expect(temp_note).to_be_visible()
            same_position('#temporary-review-dialog .review-feedback-panel', note_box)
            assert skin(temp_note) == note_skin
            if out:
                p.screenshot(path=str(out/'temporary-note-remembered.png'))
            temp_note.get_by_role('button', name='收起备注', exact=True).click(); p.locator('#temporary-review-close').click()
            assert p.evaluate("async()=>(await chrome.storage.local.get('entries')).entries.every(e=>e.text==='原词保持')")
            results.update(sharedGripStyle=True, positionsSurviveCasesAndReload=True, narrowViewportSafe=True,
                           customKeyInImageDetail=True, staleSettingsKeepPositions=True, temporarySharesPosition=True)
        print(results)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'all')
