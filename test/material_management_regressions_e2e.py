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
        # Confirmed compact organization bar (tag-editor.js compact mode): the tag entry is a visible
        # "添加标签" plus button that expands the input in place, so the label is its accessible name,
        # not visible body text. The obsolete "自由标签" wording must stay absent in text and names.
        metadata = collector.locator("#capture-metadata")
        add_tag = metadata.get_by_role("button", name="添加标签", exact=True)
        expect(add_tag).to_be_visible()
        expect(metadata).not_to_contain_text("自由标签")
        expect(metadata.locator('[aria-label*="自由标签"], [title*="自由标签"], [placeholder*="自由标签"]')).to_have_count(0)

        tag_input = collector.locator("#custom-labels .tag-editor input")
        expect(tag_input).to_be_hidden()
        add_tag.click()
        expect(add_tag).to_have_attribute("aria-expanded", "true")
        expect(tag_input).to_be_visible()
        tag_input.fill("外部采集，连续标签")
        collector.locator("#custom-labels .tag-editor").get_by_role("button", name="保存标签", exact=True).click()
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
