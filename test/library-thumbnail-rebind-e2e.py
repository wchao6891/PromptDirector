from __future__ import annotations

import base64
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

from e2e_support import launch_context


EXTENSION_DIR = Path(__file__).resolve().parents[1]
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZ0AAAAASUVORK5CYII="
)
ENTRY_COUNT = 49


def entries() -> list[dict]:
    return [{
        "schemaVersion": 22,
        "id": f"thumbnail-entry-{index:03d}",
        "text": f"prompt {index}",
        "title": f"Thumbnail image {index:03d}",
        "url": "",
        "savedAt": f"2026-08-01T{index % 24:02d}:{index % 60:02d}:00.000Z",
        "classification": {"pathIds": ["content:prompt:image"], "status": "confirmed", "source": "manual"},
        "facetAssignments": [], "analysisCandidates": [], "analysisBreakdown": [],
        "rejectedCandidateKeys": [], "negativeTerms": [], "customLabels": ["Thumbnail"],
        "mediaAssets": [{
            "id": f"thumbnail-asset-{index:03d}", "kind": "image", "usage": "content",
            "storageMode": "managed", "mimeType": "image/png", "byteSize": len(TINY_PNG),
            "playbackCapability": "unknown", "reviewStatus": "unverified"
        }],
        "primaryMediaId": f"thumbnail-asset-{index:03d}", "timeNotes": []
    } for index in range(ENTRY_COUNT)]


def load_all_batches(page) -> None:
    for _ in range(10):
        if page.locator(".case-card").count() >= ENTRY_COUNT:
            return
        page.evaluate("document.querySelector('#load-more').click()")
        page.wait_for_timeout(20)
    raise AssertionError("没有加载全部测试卡片")


def scroll_through_gallery(page) -> None:
    images = page.locator(".case-card img[data-visual-id]")
    for index in range(images.count()):
        images.nth(index).scroll_into_view_if_needed()
        page.wait_for_timeout(40)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="promptdirector-thumbnail-rebind-") as profile:
        with sync_playwright() as playwright:
            context = launch_context(
                playwright, profile,
                viewport={"width": 1440, "height": 900},
                accept_downloads=True,
                extension_dir=EXTENSION_DIR,
            )
            try:
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                extension_id = worker.url.split("/")[2]
                setup = context.new_page()
                setup.goto(f"chrome-extension://{extension_id}/collector.html")
                values = entries()
                setup.evaluate("async () => chrome.storage.local.clear()")
                setup.evaluate("""async ({entries, png}) => {
                    const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
                    const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
                    for (const entry of entries) {
                      await saveMediaBlob(entry.mediaAssets[0].id, new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
                    }
                    await chrome.storage.local.set({
                      schemaVersion: 22,
                      entries,
                      organizerState: {version: 4, collections: [{
                        id: 'collection:thumbnail', name: 'Thumbnail project', order: 0,
                        entryIds: entries.map(entry => entry.id)
                      }]}
                    });
                }""", {"entries": values, "png": base64.b64encode(TINY_PNG).decode()})

                page = context.new_page()
                page.goto(f"chrome-extension://{extension_id}/library.html", wait_until="domcontentloaded")
                page.locator("body[data-library-state='ready']").wait_for(timeout=10_000)
                load_all_batches(page)
                page.locator("#collection-filters .project-filter").filter(has_text="Thumbnail project").click()
                load_all_batches(page)
                scroll_through_gallery(page)
                page.wait_for_function("""() => document.querySelectorAll('.case-card img[data-visual-id]:not([src])').length === 0""", timeout=10_000)
                missing_count = page.locator(".case-card img[data-visual-id]:not([src])").count()
                assert missing_count == 0, f"后续批次有 {missing_count} 张卡片没有重新绑定缩略图加载"

                page.evaluate("""() => Object.defineProperty(navigator, 'clipboard', {
                  configurable: true,
                  value: {writeText: async () => undefined}
                })""")
                page.locator(".case-card").first.click()
                page.locator("#detail-drawer.open").wait_for(timeout=5_000)
                copy_button = page.locator("#detail-drawer .prompt-section .detail-core-actions button").first
                copy_button.click()
                page.wait_for_function("""() => document.querySelector('#detail-drawer .prompt-section .detail-core-actions button')?.textContent === '已复制'""")
                assert copy_button.text_content() == "已复制", "复制按钮没有给出点击成功反馈"
                feedback = page.locator("#feedback")
                assert feedback.text_content() == "完整提示词已复制", "复制后没有显示可见反馈"
                assert feedback.evaluate("element => getComputedStyle(element).position") == "fixed", "复制反馈没有悬浮在详情层上方"
                print({"cards": ENTRY_COUNT, "missing_thumbnails": missing_count, "copy_feedback": True})
            finally:
                context.close()


if __name__ == "__main__":
    main()
