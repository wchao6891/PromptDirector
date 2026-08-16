from __future__ import annotations

import re

from playwright.sync_api import expect

from e2e_support import extension_session


def main() -> None:
    with extension_session(
        "prompt-director-clipboard-consume-",
        viewport={"width": 390, "height": 844},
    ) as session:
        session.context.add_init_script(
            """window.__promptDirectorClipboardMode = 'image';
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
                  ? [{id: 999, url: 'chrome://extensions/', title: '扩展程序'}]
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
              value: {read: async () => {
                window.__promptDirectorClipboardReads += 1;
                if (window.__promptDirectorClipboardMode === 'image') {
                  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), value => value.charCodeAt(0));
                  const image = new Blob([bytes], {type: 'image/png'});
                  return [{types: ['image/png'], getType: async () => image}];
                }
                return [{
                  types: ['text/plain'],
                  getType: async () => new Blob(['第一段剪贴板文字'], {type: 'text/plain'})
                }];
              }}
            });"""
        )
        collector = session.open_page("collector.html")
        expect(collector.locator("#start-state")).to_be_visible()
        assert collector.evaluate("window.__promptDirectorClipboardReads") == 0

        collector.locator("#start-selection").click()
        expect(collector.locator("#preview-state")).to_be_visible()
        expect(collector.locator("#content-summary")).to_have_text("1 张图片")
        expect(collector.locator("#quick-preview .quick-visuals img")).to_have_count(1)
        expect(collector.locator("#quick-preview .quick-visuals img")).to_have_attribute("src", re.compile(r"^blob:"))
        assert collector.evaluate("window.__promptDirectorClipboardReads") == 1

        collector.get_by_role("button", name="删除第 1 张图片").click()
        expect(collector.locator("#start-state")).to_be_visible()
        cleared_image_draft = collector.evaluate("() => chrome.runtime.sendMessage({type: 'GET_CAPTURE_WORKSPACE'}).then(result => result.draft)")
        assert cleared_image_draft["visuals"] == [], cleared_image_draft

        collector.locator("#start-selection").click()
        expect(collector.locator("#preview-state")).to_be_visible()
        expect(collector.locator("#content-summary")).to_have_text("1 张图片")
        assert collector.evaluate("window.__promptDirectorClipboardReads") == 2

        collector.locator("#save-draft").click()
        expect(collector.locator("#start-state")).to_be_visible()
        saved = collector.evaluate("() => chrome.runtime.sendMessage({type: 'GET_STATE'}).then(result => result.entries)")
        assert len(saved) == 1 and len(saved[0]["mediaAssets"]) == 1, saved

        collector.evaluate("window.dispatchEvent(new Event('focus'))")
        collector.wait_for_timeout(250)
        expect(collector.locator("#preview-state")).to_be_hidden()
        assert collector.evaluate("window.__promptDirectorClipboardReads") == 2

        collector.evaluate("window.__promptDirectorClipboardMode = 'text'")
        collector.locator("#start-selection").click()
        expect(collector.locator("#preview-state")).to_be_visible()
        expect(collector.locator("#quick-preview")).to_contain_text("第一段剪贴板文字")
        assert collector.evaluate("window.__promptDirectorClipboardReads") == 3

        collector.get_by_role("button", name="删除第 1 段文字").click()
        expect(collector.locator("#start-state")).to_be_visible()
        cleared_text_draft = collector.evaluate("() => chrome.runtime.sendMessage({type: 'GET_CAPTURE_WORKSPACE'}).then(result => result.draft)")
        assert cleared_text_draft["fragments"] == [], cleared_text_draft

        print({
            "automatic_clipboard_reads": 0,
            "explicit_clipboard_reads": 3,
            "copied_image_imported": True,
            "saved_clipboard_can_be_extracted_again": True,
            "single_item_removal": True,
            "mobile_sidebar": True,
        })


if __name__ == "__main__":
    main()
