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
    no_source_entry = base_entry(
        "detail-no-source",
        "无来源详情验收案例",
        "用于确认没有来源信息时仍能删除案例。",
        "content:prompt:text",
        7,
    )
    no_source_entry["url"] = ""
    no_source_entry["metadataLabels"] = []
    projects = [{
        "id": f"collection:detail-{index}",
        "name": f"详情项目 {index:02d} " + ("完整项目名称需要换行显示" if index == 20 else ""),
        "order": index,
        "entryIds": [entry["id"]],
        "visibility": "library",
    } for index in range(21)]
    screenshots = Path(tempfile.gettempdir())

    with extension_session("prompt-director-detail-actions-", viewport={"width": 1440, "height": 900}) as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entry, noSourceEntry, projects, png}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              await chrome.storage.local.clear();
              await chrome.storage.local.set({
                schemaVersion: 25,
                entries: [entry, noSourceEntry],
                organizerState: {version: 5, collections: projects},
                uiPreferences: {locale: 'zh-CN', theme: 'dark', motion: 'reduced'}
              });
              await saveMediaBlob(entry.primaryMediaId, new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
            }""",
            {"entry": entry, "noSourceEntry": no_source_entry, "projects": projects, "png": PNG_BASE64},
        )

        library = session.open_page("library.html", wait_until="networkidle")
        library.locator(f'.case-card[data-entry-id="{entry["id"]}"]').click()
        expect(library.locator(".detail-header-section .entry-editor-inline > summary")).to_be_visible()
        expect(library.locator(".prompt-section-heading", has_text="提示词")).to_be_visible()
        expect(library.locator(".detail-core-actions > button")).to_have_count(2)
        expect(library.get_by_role("button", name="复制提示词")).to_be_enabled()
        expect(library.get_by_role("button", name="以此创作")).to_be_enabled()
        expect(library.get_by_role("button", name="编辑共享提示词", exact=True)).to_have_count(0)
        project_menu = library.locator(".detail-project-menu")
        expect(project_menu.locator(":scope > summary")).to_have_text("已加入 21 个项目")
        closed_height = project_menu.locator(":scope > summary").evaluate("node => node.getBoundingClientRect().height")
        assert closed_height <= 40, closed_height
        project_menu.locator(":scope > summary").click()
        expect(project_menu.locator(".detail-project-option")).to_have_count(21)
        checkbox_widths = project_menu.locator('.detail-project-option input[type="checkbox"]').evaluate_all(
            "nodes => nodes.map(node => node.getBoundingClientRect().width)"
        )
        assert checkbox_widths and max(checkbox_widths) <= 18, checkbox_widths
        long_project = project_menu.locator(".detail-project-option").nth(20)
        expect(long_project).to_contain_text("完整项目名称需要换行显示")
        long_project.locator("input").click()
        expect(project_menu.locator(":scope > summary")).to_have_text("已加入 20 个项目")
        project_menu.locator('input[aria-label="新项目名称"]').fill("详情新建项目")
        project_menu.get_by_role("button", name="新建并加入", exact=True).click()
        expect(library.locator(".detail-project-menu > summary")).to_have_text("已加入 21 个项目")
        expect(library.locator(".detail-quick-organization")).not_to_contain_text("快捷整理")
        detail_order = library.evaluate(
            """() => {
              const prompt = document.querySelector('.prompt-section');
              const organizer = document.querySelector('.detail-quick-organization');
              return Boolean(prompt && organizer && (prompt.compareDocumentPosition(organizer) & Node.DOCUMENT_POSITION_FOLLOWING));
            }"""
        )
        assert detail_order is True
        tag_input = library.locator(".detail-quick-organization .tag-editor input")
        tag_input.fill("客户喜欢，待复刻")
        library.locator(".detail-quick-organization .tag-editor").get_by_role("button", name="添加", exact=True).click()
        expect(library.locator(".detail-quick-organization .tag-editor-chip")).to_have_count(2)
        expect(library.locator(".detail-quick-organization .tag-editor-chip")).to_contain_text(["客户喜欢", "待复刻"])
        expect(library.locator(".detail-quick-organization")).not_to_contain_text("可选")
        expect(library.locator(".detail-quick-organization")).not_to_contain_text("不用预先创建")
        expect(library.locator(".detail-quick-organization")).not_to_contain_text("任意输入")
        expect(library.locator(".detail-quick-organization .detail-delete-action")).to_have_count(0)
        expect(library.locator(".metadata-section .detail-delete-action")).to_contain_text("移入回收站")
        expect(library.locator(".metadata-actions > *")).to_have_count(2)
        expect(library.locator(".detail-content > .detail-footer-actions")).to_have_count(0)

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
        expect(library.locator(".entry-editor-inline h4", has_text="案例标题")).to_have_count(1)
        expect(library.locator(".entry-editor-inline .entry-edit-row")).to_be_visible()
        expect(library.locator(".entry-editor-inline .entry-edit-row").get_by_role("button", name="保存", exact=True)).to_be_visible()
        title_row = library.locator(".entry-editor-inline .entry-edit-row").evaluate(
            """node => ({display: getComputedStyle(node).display, columns: node.children.length})"""
        )
        assert title_row == {"display": "grid", "columns": 2}, title_row
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
        expect(library.locator(".metadata-actions .detail-delete-action")).to_be_visible()
        library.screenshot(path=str(screenshots / "promptdirector-step3-detail-desktop.png"), full_page=True)

        library.set_viewport_size({"width": 390, "height": 844})
        mobile_project_menu = library.locator(".detail-project-menu")
        mobile_project_popover = library.locator(".detail-project-popover")
        for _ in range(5):
            if mobile_project_menu.get_attribute("open") is not None and mobile_project_popover.is_visible():
                break
            mobile_project_menu.locator(":scope > summary").click()
            library.wait_for_timeout(150)
        expect(mobile_project_menu).to_have_attribute("open", "")
        expect(mobile_project_popover).to_be_visible()
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

        library.locator("#detail-close").click()
        library.locator(f'.case-card[data-entry-id="{no_source_entry["id"]}"]').click()
        expect(library.locator(".metadata-section")).to_have_count(0)
        expect(library.locator(".detail-body > .detail-footer-actions .detail-delete-action")).to_contain_text("移入回收站")
        expect(library.locator(".detail-body > .detail-footer-actions")).to_be_visible()

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
