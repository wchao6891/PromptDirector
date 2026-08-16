from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def main() -> None:
    entry = base_entry(
        "captured-x-post",
        "Director Name · A practical lighting breakdown",
        "A practical lighting breakdown for a midnight chase: keep the street cyan, reserve warm light for the character, and let the wet road carry the contrast.",
        "content:prompt:image",
        1,
    )
    entry.update({
        "url": "https://x.com/director/status/123",
        "sourceFacts": {
            "provider": "x",
            "pageType": "post",
            "itemId": "123",
            "author": "Director Name",
            "handle": "director",
            "publishedAt": "2026-08-16T09:30:00.000Z",
            "capturedAt": "2026-08-16T09:31:00.000Z",
            "engagement": {"likes": 42, "reposts": 7},
            "captureScope": "document",
            "extractionMethod": "page",
            "status": "complete",
        },
        "mediaAssets": [
            {
                "id": "post-image",
                "kind": "image",
                "usage": "content",
                "storageMode": "managed",
                "mimeType": "image/png",
                "width": 1600,
                "height": 1067,
                "capturedAt": "2026-08-16T09:31:00.000Z",
                "reviewStatus": "verified",
            },
            {
                "id": "post-video",
                "kind": "video",
                "usage": "content",
                "storageMode": "reference",
                "sourceUrl": "https://x.com/director/status/123/video/1",
                "sourceTitle": "Attached clip",
                "originalWorkUrl": "https://x.com/director/status/123",
                "reference": {
                    "url": "https://x.com/director/status/123/video/1",
                    "provider": "x",
                    "playbackMode": "embed",
                },
                "reviewStatus": "verified",
            },
        ],
        "primaryMediaId": "post-image",
        "articleDocument": {
            "version": 1,
            "blocks": [
                {"id": "post-copy", "kind": "paragraph", "text": "A practical lighting breakdown for a midnight chase: keep the street cyan, reserve warm light for the character, and let the wet road carry the contrast.", "sourceOrder": 0},
                {"id": "post-image-block", "kind": "image", "assetId": "post-image", "sourceUrl": "https://x.com/post-image.png", "sourceOrder": 1},
                {"id": "post-video-block", "kind": "video", "assetId": "post-video", "sourceUrl": "https://x.com/director/status/123/video/1", "sourceOrder": 2},
            ],
        },
    })

    with extension_session("prompt-director-x-post-") as run:
        setup = run.open_page("collector.html")
        setup.evaluate(
            """async ({entry, png}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              await saveMediaBlob('post-image', new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
              await chrome.storage.local.clear();
              await chrome.storage.local.set({schemaVersion: 24, entries: [entry]});
            }""",
            {"entry": entry, "png": PNG_BASE64},
        )

        library = run.open_page("library.html", wait_until="networkidle")
        expect(library.locator(".case-card")).to_have_count(1)
        library.locator(".case-card").click()
        expect(library.locator(".captured-post-view")).to_be_visible(timeout=8000)
        expect(library.locator(".captured-post-text")).to_contain_text("practical lighting breakdown")
        expect(library.locator(".captured-post-heading")).to_contain_text("Director Name")
        expect(library.locator(".captured-post-heading")).to_contain_text("@director")
        expect(library.locator(".compact-captured-image img")).to_have_count(1)
        expect(library.get_by_text("打开原帖观看视频")).to_have_count(1)
        expect(library.locator(".article-document-reader")).to_have_count(0)
        expect(library.locator(".detail-video, iframe")).to_have_count(0)
        expect(library.get_by_text("单独查看文章媒体")).to_have_count(0)

        print({
            "page_type": "post",
            "author": "Director Name",
            "saved_media": 2,
            "compact_post": True,
            "black_video_embed": False,
        })


if __name__ == "__main__":
    main()
