from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import extension_session


def main() -> None:
    with extension_session("prompt-director-material-management-", viewport={"width": 1180, "height": 820}) as session:
        collector = session.open_page("collector.html")
        collector.evaluate(
            """async () => chrome.runtime.sendMessage({
              type: 'UPDATE_CAPTURE_DRAFT',
              draft: {
                title: '素材整理验收',
                fragments: [{id: 'material-text', text: '验证采集侧栏的多标签编辑。'}],
                visuals: []
              }
            })"""
        )
        collector.reload(wait_until="networkidle")
        collector.locator("#organize-toggle").click()
        expect(collector.locator("#capture-metadata")).to_be_visible()
        expect(collector.locator("#capture-metadata")).to_contain_text("添加标签")
        expect(collector.locator("#capture-metadata")).not_to_contain_text("自由标签")

        tag_input = collector.locator("#custom-labels .tag-editor input")
        tag_input.fill("外部采集，连续标签")
        collector.locator("#custom-labels .tag-editor").get_by_role("button", name="添加", exact=True).click()
        expect(collector.locator("#custom-labels .tag-editor-chip")).to_have_count(2)
        saved_labels = collector.evaluate("async () => (await chrome.storage.local.get('captureDraft')).captureDraft.customLabels")
        assert saved_labels == ["外部采集", "连续标签"], saved_labels

        select_style = collector.locator("#content-type").evaluate(
            """node => ({
              appearance: getComputedStyle(node).appearance,
              supported: CSS.supports('appearance: base-select'),
              background: getComputedStyle(node).backgroundColor
            })"""
        )
        assert select_style["supported"] is True, select_style
        assert select_style["appearance"] == "base-select", select_style
        assert select_style["background"] not in {"rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"}, select_style

        print({"collector_tags": saved_labels, "select_style": select_style})


if __name__ == "__main__":
    main()
