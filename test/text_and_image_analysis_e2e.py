from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZ0AAAAASUVORK5CYII="


def main() -> None:
    text_entry = base_entry("analysis-text", "待分析提示词", "雾中庭院，低饱和，中央构图。", "content:prompt:image")
    image_entry = base_entry("analysis-image", "待分析主图", "", "content:image-case", 1)
    image_entry["mediaAssets"] = [{
        "id": "analysis-image-main",
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
        "capturedAt": "2026-08-02T08:01:00.000Z",
        "playbackCapability": "unknown",
        "reviewStatus": "verified",
    }]
    image_entry["primaryMediaId"] = "analysis-image-main"
    project_id = "collection:analysis"
    with extension_session("prompt-director-analysis-") as session:
        setup = session.open_page("collector.html")
        session.seed_storage(
            setup,
            {
                "schemaVersion": 24,
                "entries": [text_entry, image_entry],
                "organizerState": {
                    "version": 4,
                    "collections": [{
                        "id": project_id,
                        "name": "分析验收",
                        "order": 0,
                        "entryIds": [text_entry["id"], image_entry["id"]],
                    }],
                },
                "visionSettings": {"activeProvider": "openai", "consent": False},
            },
        )
        setup.evaluate(
            """async (dataUrl) => {
              const {saveScreenshotBlob} = await import(chrome.runtime.getURL('image-store.js'));
              await saveScreenshotBlob('analysis-image-main', await (await fetch(dataUrl)).blob());
            }""",
            TINY_PNG,
        )
        library = session.open_page("library.html", wait_until="networkidle")
        if not library.locator("#settings-dialog").is_visible():
            library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()
        library.locator("#preview-analysis-batch").click()
        expect(library.locator("#analysis-batch-summary")).to_contain_text("1 次请求")
        expect(library.locator("#analysis-batch-summary")).to_contain_text("固定分类提示")
        library.locator("#settings-close").click()

        print({"text_preview": 1, "batch_visual_preview": True})


if __name__ == "__main__":
    main()
