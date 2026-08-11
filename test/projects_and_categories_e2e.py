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
                    "collections": [{
                        "id": project_id,
                        "name": "项目与分类验收",
                        "order": 0,
                        "entryIds": [entry["id"], second_entry["id"]],
                    }],
                },
            },
        )
        library = session.open_page("library.html", wait_until="networkidle")
        library.locator("#search-input").fill("project-case")
        expect(library.locator(".case-card")).to_have_count(2)
        library.locator("#select-cases").click()
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

        expect(library.locator("#collection-filters")).to_contain_text("项目与分类验收")
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
