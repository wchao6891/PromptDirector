from __future__ import annotations

import time

from playwright.sync_api import expect

from e2e_support import EXTENSION_DIR, extension_session


def main() -> None:
    with extension_session("prompt-director-picker-") as session:
        page = session.open_page("library.html", wait_until="networkidle")
        page.add_style_tag(path=str(EXTENSION_DIR / "capture-region.css"))
        page.evaluate(
            """() => {
              const underlay = document.createElement('a');
              underlay.id = 'picker-underlay'; underlay.href = '#unexpected';
              Object.assign(underlay.style, {position: 'fixed', inset: '0', zIndex: '100'});
              const floating = document.createElement('button');
              floating.id = 'picker-floating'; floating.textContent = 'F';
              Object.assign(floating.style, {position: 'fixed', left: '220px', top: '260px', width: '48px', height: '48px', zIndex: '1000'});
              document.documentElement.append(underlay, floating);
              window.__regionResult = undefined;
              import(chrome.runtime.getURL('capture-region.js'))
                .then(({selectCaptureRegion}) => selectCaptureRegion())
                .then((result) => { window.__regionResult = result; });
            }"""
        )
        page.locator("#__prompt_case_capture_overlay__").wait_for()
        overlay = page.locator("#__prompt_case_capture_overlay__")
        overlay.dispatch_event("mousedown", {"button": 0, "clientX": 120, "clientY": 210})
        overlay.dispatch_event("mousemove", {"button": 0, "clientX": 420, "clientY": 490})
        overlay.dispatch_event("mouseup", {"button": 0, "clientX": 420, "clientY": 490})
        page.locator("#__prompt_case_capture_overlay__").wait_for(state="detached")
        wait_for_window_value(page, "__regionResult")
        region = page.evaluate("window.__regionResult")
        assert region["rect"]["width"] == 300
        assert region["rect"]["height"] == 280
        assert not page.url.endswith("#unexpected")
        assert page.locator("#picker-floating").evaluate("element => getComputedStyle(element).visibility") == "hidden"
        page.evaluate(
            """async (token) => {
              const {restorePageAfterCapture} = await import(chrome.runtime.getURL('capture-region.js'));
              restorePageAfterCapture(token);
              document.querySelectorAll('#picker-underlay, #picker-floating').forEach((element) => element.remove());
              document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
              for (const element of document.querySelectorAll('img, video, canvas')) element.style.visibility = 'hidden';
              for (const [id, left] of [['picker-a', 50], ['picker-b', 260]]) {
                const canvas = document.createElement('canvas');
                canvas.id = id; canvas.width = 180; canvas.height = 120;
                Object.assign(canvas.style, {
                  position: 'fixed', left: `${left}px`, top: '100px', width: '180px', height: '120px',
                  visibility: 'visible', zIndex: '2147480000'
                });
                canvas.getContext('2d').fillRect(0, 0, 180, 120);
                document.documentElement.append(canvas);
              }
              window.__visualFixture = [...document.querySelectorAll('#picker-a, #picker-b')].map((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                  id: element.id,
                  rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
                  display: style.display,
                  visibility: style.visibility,
                  opacity: style.opacity,
                  hitStack: document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
                    .slice(0, 5).map((item) => item.id || item.className || item.tagName)
                };
              });
              window.__visualResult = undefined;
              const {selectPageVisuals} = await import(chrome.runtime.getURL('capture-region.js'));
              selectPageVisuals({minimumSize: 64, maximumSelections: 12}).then((result) => { window.__visualResult = result; });
            }""",
            region["captureToken"],
        )
        page.wait_for_function(
            """() => document.getElementById('__prompt_case_visual_picker__')
              || window.__visualResult !== undefined"""
        )
        picker_state = page.evaluate(
            """() => ({
              hasPicker: Boolean(document.getElementById('__prompt_case_visual_picker__')),
              result: window.__visualResult,
              fixture: window.__visualFixture
            })"""
        )
        assert picker_state["hasPicker"], picker_state
        expect(page.locator(".prompt-case-visual-candidate")).to_have_count(2)
        page.locator(".prompt-case-visual-candidate").nth(0).click()
        page.locator(".prompt-case-visual-candidate").nth(1).click()
        expect(page.locator(".prompt-case-visual-picker-count")).to_have_text("已选 2 张")
        page.get_by_role("button", name="加入素材").click()
        wait_for_window_value(page, "__visualResult")
        assert len(page.evaluate("window.__visualResult.selections")) == 2
        print({"region": [300, 280], "smart_selections": 2})


def wait_for_window_value(page, name: str) -> None:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if page.evaluate("name => window[name] !== undefined", name):
            return
        page.wait_for_timeout(50)
    raise AssertionError(f"等待 window.{name} 超时")


if __name__ == "__main__":
    main()
