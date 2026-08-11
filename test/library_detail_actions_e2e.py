from __future__ import annotations

import tempfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def main() -> None:
    entry = base_entry(
        "detail-actions-case",
        "详情操作层级验收案例",
        "保留主体关系、材质层次和光线方向的完整提示词。",
        "content:prompt:image",
        8,
    )
    entry["metadataLabels"] = ["作者：验收作者", "事项：详情动作归位"]
    entry["mediaAssets"] = [{
        "id": "detail-actions-image",
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
        "capturedAt": "2026-08-08T00:00:00.000Z",
        "reviewStatus": "verified",
    }]
    entry["primaryMediaId"] = "detail-actions-image"
    screenshots = Path(tempfile.gettempdir())

    with extension_session("prompt-director-detail-actions-", viewport={"width": 1440, "height": 900}) as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entry, png}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              await chrome.storage.local.clear();
              await chrome.storage.local.set({
                schemaVersion: 25,
                entries: [entry],
                uiPreferences: {locale: 'zh-CN', theme: 'dark', motion: 'reduced'}
              });
              await saveMediaBlob(entry.primaryMediaId, new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
            }""",
            {"entry": entry, "png": PNG_BASE64},
        )

        library = session.open_page("library.html", wait_until="networkidle")
        library.locator(".case-card").click()
        expect(library.locator(".detail-header-section .entry-editor-inline > summary")).to_be_visible()
        expect(library.locator(".prompt-section-heading", has_text="提示词")).to_be_visible()
        expect(library.locator(".detail-core-actions > button")).to_have_count(2)
        expect(library.get_by_role("button", name="复制提示词")).to_be_enabled()
        expect(library.get_by_role("button", name="以此创作")).to_be_enabled()

        core_geometry = library.locator(".detail-core-actions > button").evaluate_all(
            "buttons => buttons.map(button => ({width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height}))"
        )
        assert abs(core_geometry[0]["width"] - core_geometry[1]["width"]) < 1, core_geometry
        assert core_geometry[0]["height"] == core_geometry[1]["height"] == 36, core_geometry

        edit_geometry = library.evaluate(
            """() => {
              const title = document.querySelector('.detail-title').getBoundingClientRect();
              const edit = document.querySelector('.entry-editor-inline > summary').getBoundingClientRect();
              return {titleTop: title.top, editTop: edit.top, delta: Math.abs(title.top - edit.top)};
            }"""
        )
        assert edit_geometry["delta"] < 8, edit_geometry
        library.locator(".entry-editor-inline > summary").click()
        expect(library.locator(".entry-editor-inline .entry-editor-body")).to_be_visible()
        library.locator(".entry-editor-inline > summary").click()

        library.get_by_role("button", name="编辑", exact=True).click()
        expect(library.get_by_role("textbox", name="编辑提示词")).to_be_visible()
        library.get_by_role("button", name="取消", exact=True).click()

        analysis = library.locator(".detail-analysis-menu")
        analysis.locator(":scope > summary").click()
        expect(analysis.locator(".detail-analysis-actions > button")).to_have_count(2)
        expect(analysis.get_by_role("button", name="分析主图")).to_be_visible()
        expect(analysis.get_by_role("button", name="分析检索标签")).to_be_visible()

        source = library.get_by_role("link", name="打开来源")
        expect(source).to_have_attribute("href", entry["url"])
        expect(source).to_have_attribute("target", "_blank")
        expect(source).to_have_attribute("rel", "noopener noreferrer")
        library.screenshot(path=str(screenshots / "promptdirector-step3-detail-desktop.png"), full_page=True)

        library.set_viewport_size({"width": 390, "height": 844})
        library.locator(".prompt-section").scroll_into_view_if_needed()
        mobile = library.evaluate(
            """() => {
              const actions = document.querySelector('.detail-core-actions').getBoundingClientRect();
              return {
                actionsLeft: actions.left,
                actionsRight: actions.right,
                viewport: innerWidth,
                documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                detailOverflow: document.querySelector('#detail-content').scrollWidth > document.querySelector('#detail-content').clientWidth
              };
            }"""
        )
        assert mobile["actionsLeft"] >= -1 and mobile["actionsRight"] <= mobile["viewport"] + 1, mobile
        assert mobile["documentOverflow"] is False and mobile["detailOverflow"] is False, mobile
        expect(library.get_by_role("button", name="复制提示词")).to_be_visible()
        expect(library.get_by_role("button", name="以此创作")).to_be_visible()
        library.screenshot(path=str(screenshots / "promptdirector-step3-detail-mobile.png"), full_page=True)

        print({
            "core_actions": core_geometry,
            "title_edit_alignment": edit_geometry,
            "analysis_choices": 2,
            "source_href": entry["url"],
            "mobile": mobile,
            "screenshots": [
                str(screenshots / "promptdirector-step3-detail-desktop.png"),
                str(screenshots / "promptdirector-step3-detail-mobile.png"),
            ],
        })


if __name__ == "__main__":
    main()
