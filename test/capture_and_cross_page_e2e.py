from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import extension_session


def main() -> None:
    with extension_session("prompt-director-capture-") as session:
        collector = session.open_page("collector.html")
        panel_behavior = collector.evaluate("async () => chrome.sidePanel.getPanelBehavior()")
        assert panel_behavior.get("openPanelOnActionClick") is False
        collector.evaluate(
            """async () => chrome.runtime.sendMessage({
              type: 'UPDATE_CAPTURE_DRAFT',
              draft: {
                title: '跨页采集验收',
                fragments: [
                  {id: 'part-one', text: '第一段：建立主体与空间关系。', sourceUrl: 'https://fixture.invalid/one', sourceTitle: '来源一'},
                  {id: 'part-two', text: '第二段：补充光线与色彩方法。', sourceUrl: 'https://fixture.invalid/two', sourceTitle: '来源二'}
                ],
                visuals: []
              }
            })"""
        )
        collector.reload()
        expect(collector.locator("#preview-state")).to_be_visible()
        expect(collector.locator("#content-summary")).to_have_text("2 段文字")
        collector.locator("#content-type").select_option("content:prompt:image")
        collector.locator("#save-draft").click()
        expect(collector.locator("#feedback")).to_contain_text("已保存为新案例")
        saved = collector.evaluate(
            """async () => {
              const entries = (await chrome.storage.local.get('entries')).entries;
              return entries.find((entry) => entry.title === '跨页采集验收');
            }"""
        )
        assert saved["text"] == "第一段：建立主体与空间关系。\n\n第二段：补充光线与色彩方法。"
        assert [item["url"] for item in saved["sourcePages"]] == [
            "https://fixture.invalid/one",
            "https://fixture.invalid/two",
        ]
        assert saved["classification"]["pathIds"] == ["content:prompt:image"]
        expect(collector.locator("#start-state")).to_be_visible()
        page_count = len(session.context.pages)
        collector_url = collector.url
        with session.context.expect_page() as opened:
            collector.locator("#open-library").click()
        library = opened.value
        library.wait_for_url(f"chrome-extension://{session.extension_id}/library.html")
        expect(library.locator("body")).to_have_attribute("data-library-state", "ready")
        assert len(session.context.pages) == page_count + 1
        assert collector.url == collector_url
        panel_options = library.evaluate(
            """async () => {
              const tab = await chrome.tabs.getCurrent();
              return chrome.sidePanel.getOptions({tabId: tab.id});
            }"""
        )
        assert panel_options["enabled"] is False
        internal_page_count = len(session.context.pages)
        library.locator("#open-curated").click()
        expect(library).to_have_url(f"chrome-extension://{session.extension_id}/curated.html")
        assert len(session.context.pages) == internal_page_count
        library.go_back(wait_until="domcontentloaded")
        expect(library.locator("body")).to_have_attribute("data-library-state", "ready")
        library.locator("#open-skills").click()
        expect(library).to_have_url(f"chrome-extension://{session.extension_id}/skills.html?source=library")
        assert len(session.context.pages) == internal_page_count
        library.go_back(wait_until="domcontentloaded")
        expect(library.locator("body")).to_have_attribute("data-library-state", "ready")
        library.locator("#start-compose").click()
        expect(library).to_have_url(f"chrome-extension://{session.extension_id}/composer.html")
        assert len(session.context.pages) == internal_page_count
        print({"capture": "passed", "toolbar_keeps_panel_open": True, "source_pages": len(saved["sourcePages"]), "library_full_tab": True, "internal_navigation": "same-tab"})


if __name__ == "__main__":
    main()
