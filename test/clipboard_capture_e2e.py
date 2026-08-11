from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import extension_session


def main() -> None:
    with extension_session(
        "prompt-director-clipboard-consume-",
        viewport={"width": 390, "height": 844},
    ) as session:
        session.context.add_init_script(
            """window.__promptDirectorClipboardText = '第一段剪贴板文字';
            window.__promptDirectorClipboardReads = 0;
            if (globalThis.chrome?.permissions) {
              const originalContains = chrome.permissions.contains.bind(chrome.permissions);
              const originalRequest = chrome.permissions.request.bind(chrome.permissions);
              Object.defineProperty(chrome.permissions, 'contains', {
                configurable: true,
                value: async request => request?.permissions?.includes('clipboardRead') || request?.origins?.includes('https://example.com/*')
                  ? true
                  : originalContains(request)
              });
              Object.defineProperty(chrome.permissions, 'request', {
                configurable: true,
                value: async request => request?.permissions?.includes('clipboardRead') || request?.origins?.includes('https://example.com/*')
                  ? true
                  : originalRequest(request)
              });
            }
            if (globalThis.chrome?.tabs) {
              const originalQuery = chrome.tabs.query.bind(chrome.tabs);
              Object.defineProperty(chrome.tabs, 'query', {
                configurable: true,
                value: async query => query?.active
                  ? [{id: 999, url: 'https://example.com/article', title: '示例网页'}]
                  : originalQuery(query)
              });
            }
            if (globalThis.chrome?.runtime) {
              const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
              Object.defineProperty(chrome.runtime, 'sendMessage', {
                configurable: true,
                value: async message => message?.type === 'ADD_ACTIVE_SELECTION_TO_DRAFT'
                  ? {ok: true, added: false, reason: 'empty-selection', draft: {fragments: [], visuals: []}}
                  : originalSendMessage(message)
              });
            }
            Object.defineProperty(navigator, 'clipboard', {
              configurable: true,
              value: {readText: async () => {
                window.__promptDirectorClipboardReads += 1;
                return window.__promptDirectorClipboardText;
              }}
            });"""
        )
        collector = session.open_page("collector.html")
        expect(collector.locator("#start-state")).to_be_visible()
        assert collector.evaluate("window.__promptDirectorClipboardReads") == 0

        collector.locator("#start-selection").click()
        expect(collector.locator("#preview-state")).to_be_visible()
        expect(collector.locator("#quick-preview")).to_contain_text("第一段剪贴板文字")
        assert collector.evaluate("window.__promptDirectorClipboardReads") == 1

        collector.locator("#save-draft").click()
        expect(collector.locator("#start-state")).to_be_visible()

        collector.evaluate("window.dispatchEvent(new Event('focus'))")
        collector.wait_for_timeout(250)
        expect(collector.locator("#preview-state")).to_be_hidden()
        assert collector.evaluate("window.__promptDirectorClipboardReads") == 1

        collector.locator("#start-selection").click()
        expect(collector.locator("#preview-state")).to_be_visible()
        expect(collector.locator("#quick-preview")).to_contain_text("第一段剪贴板文字")
        assert collector.evaluate("window.__promptDirectorClipboardReads") == 2

        print({
            "automatic_clipboard_reads": 0,
            "explicit_clipboard_reads": 2,
            "saved_clipboard_can_be_extracted_again": True,
            "mobile_sidebar": True,
        })


if __name__ == "__main__":
    main()
