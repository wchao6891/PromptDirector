from __future__ import annotations

import re

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


def main() -> None:
    entry = base_entry("project-case", "项目图片案例", "克制构图与柔和轮廓光。", "content:prompt:image")
    second_entry = base_entry("project-case-two", "项目图片案例二", "留白构图与低饱和环境光。", "content:prompt:image", 1)
    project_id = "collection:e2e-project"
    with extension_session("prompt-director-projects-") as session:
        setup = session.open_page("collector.html")
        session.seed_storage(
            setup,
            {
                "schemaVersion": 24,
                "entries": [entry, second_entry],
                "organizerState": {
                    "version": 4,
                    "collections": [
                        {
                            "id": project_id,
                            "name": "项目与分类验收的完整长项目名称",
                            "order": 0,
                            "entryIds": [entry["id"], second_entry["id"]],
                        },
                        {
                            "id": "collection:e2e-extra",
                            "name": "辅助项目",
                            "order": 1,
                            "entryIds": [],
                        },
                    ],
                },
            },
        )
        library = session.open_page("library.html", wait_until="networkidle")
        expect(library.locator(".project-row.project-ordering")).to_have_count(0)
        long_name = library.locator(".project-filter-name", has_text="完整长项目名称")
        expect(long_name).to_be_visible()
        assert long_name.evaluate("node => getComputedStyle(node).whiteSpace") == "normal"
        library.locator("#manage-project-order").click()
        expect(library.locator("#manage-project-order")).to_have_attribute("aria-label", "完成项目排序")
        expect(library.locator(".project-row.project-ordering")).to_have_count(2)
        assert library.locator(".project-row.project-ordering").first.evaluate("node => getComputedStyle(node).userSelect") == "none"
        expect(library.locator(".project-row > .project-menu:visible")).to_have_count(0)
        expect(library.locator(".project-row.project-ordering .project-filter").first).to_have_attribute("tabindex", "-1")
        source_box = library.locator(".project-row", has_text="辅助项目").bounding_box()
        target_box = library.locator(".project-row", has_text="项目与分类验收").bounding_box()
        assert source_box and target_box
        library.mouse.move(source_box["x"] + source_box["width"] / 2, source_box["y"] + source_box["height"] / 2)
        library.mouse.down()
        library.mouse.move(target_box["x"] + target_box["width"] / 2, target_box["y"] + 3, steps=8)
        library.mouse.up()
        assert library.evaluate("window.getSelection()?.toString() || ''") == ""
        expect(library.locator(".project-filter-name").first).to_have_text("辅助项目")
        library.locator(".project-row", has_text="辅助项目").focus()
        library.locator(".project-row", has_text="辅助项目").press("ArrowDown")
        expect(library.locator("#project-order-status")).to_contain_text("辅助项目")
        expect(library.locator(".project-filter-name").first).to_contain_text("项目与分类验收")

        touch_source = library.locator(".project-row", has_text="辅助项目").bounding_box()
        touch_target = library.locator(".project-row", has_text="项目与分类验收").bounding_box()
        assert touch_source and touch_target
        touch_x = touch_source["x"] + touch_source["width"] / 2
        touch_row = library.locator(".project-row", has_text="辅助项目")
        touch_row.dispatch_event("pointerdown", {"pointerId": 71, "pointerType": "touch", "button": 0, "clientX": touch_x, "clientY": touch_source["y"] + touch_source["height"] / 2})
        touch_row.dispatch_event("pointermove", {"pointerId": 71, "pointerType": "touch", "button": -1, "clientX": touch_x, "clientY": touch_source["y"] - 8})
        touch_row.dispatch_event("pointermove", {"pointerId": 71, "pointerType": "touch", "button": -1, "clientX": touch_x, "clientY": touch_target["y"] + 3})
        touch_row.dispatch_event("pointerup", {"pointerId": 71, "pointerType": "touch", "button": 0, "clientX": touch_x, "clientY": touch_target["y"] + 3})
        expect(library.locator(".project-filter-name").first).to_have_text("辅助项目")

        library.evaluate("""() => {
          window.__originalProjectSendMessage = chrome.runtime.sendMessage;
          chrome.runtime.sendMessage = (message, ...rest) => message?.type === 'REORDER_COLLECTIONS'
            ? Promise.resolve({ok: false, message: '模拟项目排序保存失败'})
            : window.__originalProjectSendMessage.call(chrome.runtime, message, ...rest);
        }""")
        failed_source = library.locator(".project-row", has_text="辅助项目").bounding_box()
        failed_target = library.locator(".project-row", has_text="项目与分类验收").bounding_box()
        assert failed_source and failed_target
        failed_x = failed_source["x"] + failed_source["width"] / 2
        failed_row = library.locator(".project-row", has_text="辅助项目")
        failed_row.dispatch_event("pointerdown", {"pointerId": 72, "pointerType": "mouse", "button": 0, "clientX": failed_x, "clientY": failed_source["y"] + failed_source["height"] / 2})
        failed_row.dispatch_event("pointermove", {"pointerId": 72, "pointerType": "mouse", "button": -1, "clientX": failed_x, "clientY": failed_target["y"] + failed_target["height"] - 2})
        failed_row.dispatch_event("pointerup", {"pointerId": 72, "pointerType": "mouse", "button": 0, "clientX": failed_x, "clientY": failed_target["y"] + failed_target["height"] - 2})
        expect(library.locator("#feedback")).to_contain_text("模拟项目排序保存失败")
        expect(library.locator(".project-filter-name").first).to_have_text("辅助项目")
        library.evaluate("""() => { chrome.runtime.sendMessage = window.__originalProjectSendMessage; }""")
        library.locator("#manage-project-order").click()
        expect(library.locator(".project-row.project-ordering")).to_have_count(0)
        expect(library.locator(".project-row > .project-menu:visible")).to_have_count(2)

        library.locator(".project-filter", has_text="项目与分类验收").click()
        expect(library.locator("#manage-case-order")).to_be_visible()
        library.locator("#gallery-sort").select_option("project-manual")
        expect(library.locator(".case-reorder-controls:visible")).to_have_count(0)
        library.locator("#manage-case-order").click()
        expect(library.locator("#manage-case-order")).to_have_attribute("aria-label", "完成案例排序")
        expect(library.locator(".case-reorder-controls:visible")).to_have_count(2)
        library.locator(f".case-card[data-entry-id='{second_entry['id']}'] .case-move-up").click()
        library.locator("#manage-case-order").click()
        expect(library.locator(".case-reorder-controls:visible")).to_have_count(0)
        order = library.evaluate(
            "async (id) => (await chrome.storage.local.get('organizerState')).organizerState.collections.find(item => item.id === id).entryIds",
            project_id,
        )
        assert order == [second_entry["id"], entry["id"]], order

        library.locator("#search-input").fill("project-case")
        expect(library.locator(".case-card")).to_have_count(2)
        library.locator("#select-cases").click()
        expect(library.locator("#manage-project-order")).to_be_visible()
        expect(library.locator("#manage-project-order")).to_be_disabled()
        expect(library.locator("#manage-project-order")).to_have_attribute("title", "结束案例选择后可排序项目")
        library.locator(".case-card").nth(0).click()
        library.locator(".case-card").nth(1).click()
        library.locator("#selection-combine").click()
        combine_dialog = library.locator("#promptdirector-app-dialog")
        expect(combine_dialog).to_be_visible()
        combine_dialog.locator("input").fill("组合案例验收")
        combine_dialog.get_by_role("button", name="创建组合", exact=True).click()
        expect(library.locator("#feedback")).to_contain_text("案例已组合")
        compound_id = library.evaluate("async () => (await chrome.storage.local.get('compoundCases')).compoundCases[0].id")
        expect(library.locator(".case-card")).to_have_count(1)
        library.locator(f".case-card[data-entry-id='{compound_id}']").click()
        expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", compound_id)
        expect(library.locator(".compound-case-actions")).to_be_visible()
        library.locator(".compound-case-actions").get_by_role("button", name="拆分为独立案例", exact=True).click()
        split_dialog = library.locator("#promptdirector-app-dialog")
        expect(split_dialog).to_be_visible()
        split_dialog.get_by_role("button", name="拆分", exact=True).click()
        expect(library.locator("#feedback")).to_contain_text("已拆分为 2 个独立案例")
        expect(library.locator(".case-card")).to_have_count(2)

        library.locator("#manage-facets").click()
        library.locator("#add-content-type").click()
        library.locator("#content-type-name").fill("分镜参考")
        library.locator("#content-type-role").select_option("reference")
        library.get_by_role("button", name="创建一级分类", exact=True).click()
        expect(library.locator("#manager-feedback")).to_contain_text("内容类型已创建")
        custom_content_id = library.evaluate(
            "async () => (await chrome.storage.local.get('taxonomy')).taxonomy.nodes.find(item => item.name === '分镜参考').id"
        )
        card = library.locator(f".content-type-card[data-content-type-id='{custom_content_id}']")
        card.get_by_role("button", name="编辑", exact=True).click()
        library.locator("#content-type-name").fill("分镜工作资料")
        library.locator("#content-type-role").select_option("tutorial")
        library.get_by_role("button", name="保存修改", exact=True).click()
        expect(library.locator("#manager-feedback")).to_contain_text("内容类型已更新")
        classified = library.evaluate(
            """async (contentId) => chrome.runtime.sendMessage({
              type: 'CONFIRM_CLASSIFICATION', entryId: 'project-case', pathIds: [contentId], rememberSource: false
            })""",
            custom_content_id,
        )
        assert classified["ok"] is True
        library.locator("#manager-close").click()
        library.reload(wait_until="networkidle")
        library.locator("#manage-facets").click()
        card = library.locator(f".content-type-card[data-content-type-id='{custom_content_id}']")
        card.get_by_role("button", name="编辑", exact=True).click()
        library.locator("#delete-content-type").click()
        expect(library.locator("#content-type-replacement-field")).to_be_visible()
        library.locator("#content-type-replacement").select_option("content:prompt:image")
        library.locator("#confirm-delete-content-type").click()
        expect(library.locator("#manager-feedback")).to_contain_text("1 条案例已转移")
        transferred = library.evaluate(
            """async (contentId) => {
              const state = await chrome.storage.local.get(['entries', 'taxonomy']);
              return {
                pathIds: state.entries.find(item => item.id === 'project-case').classification.pathIds,
                deleted: !state.taxonomy.nodes.some(item => item.id === contentId)
              };
            }""",
            custom_content_id,
        )
        assert transferred == {"pathIds": ["content:prompt:image"], "deleted": True}
        library.locator("#manager-close").click()

        expect(library.locator("#collection-filters")).to_contain_text("项目与分类验收的完整长项目名称")
        page_count = len(session.context.pages)
        library.locator("#open-skills").click()
        expect(library).to_have_url(re.compile(r"skills\.html"))
        assert len(session.context.pages) == page_count
        skills_page = library
        expect(skills_page.locator("#skill-workspace")).to_be_hidden()
        expect(skills_page.locator("#skill-create")).to_be_visible()
        assert "skills.html" in skills_page.url
        print({"skill_center": "independent", "compound_split": True, "content_type_transfer": True})


if __name__ == "__main__":
    main()
