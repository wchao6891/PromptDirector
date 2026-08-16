from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import zipfile

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BYTES = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
CATALOG_URL = "https://wchao6891.github.io/PromptDirector-Curated/catalog.json"
METRICS_URL = "https://wchao6891.github.io/PromptDirector-Curated/metrics.json"
COVER_URL = "https://wchao6891.github.io/PromptDirector-Curated/covers/video-workflow.png"
PREVIEW_URL = "https://wchao6891.github.io/PromptDirector-Curated/previews/video-workflow/preview.json"
POSTER_URL = "https://wchao6891.github.io/PromptDirector-Curated/previews/video-workflow/poster.webp"
PACKAGE_URL = "https://github.com/wchao6891/PromptDirector-Curated/releases/download/video-workflow-1.0.0/video-workflow.zip"
VIDEO_BYTES = b"fixture-video"
VIDEO_URL = "https://github.com/wchao6891/PromptDirector-Curated/releases/download/video-workflow-media-1.0.0/" + hashlib.sha256(VIDEO_BYTES).hexdigest() + ".mp4"


def package_fixture() -> bytes:
    entry = base_entry("curated-video-case", "精选视频案例", "镜头沿主体缓慢环绕。", "content:prompt:video")
    entry["mediaAssets"] = [
        {
            "id": "curated-video",
            "kind": "video",
            "usage": "content",
            "storageMode": "managed",
            "mimeType": "video/mp4",
            "byteSize": len(VIDEO_BYTES),
            "assetPath": "videos/curated-video.mp4",
            "posterAssetId": "curated-video-poster",
        },
        {
            "id": "curated-video-poster",
            "kind": "image",
            "usage": "poster",
            "storageMode": "managed",
            "mimeType": "image/png",
            "byteSize": len(PNG_BYTES),
            "width": 1,
            "height": 1,
            "assetPath": "images/curated-video-poster.png",
        },
    ]
    entry["primaryMediaId"] = "curated-video"
    package = {
        "format": "prompt-case-library",
        "version": 3,
        "entries": [entry],
        "organizerState": {"version": 6, "collections": []},
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("library.json", json.dumps(package, ensure_ascii=False))
        archive.writestr("videos/curated-video.mp4", VIDEO_BYTES)
        archive.writestr("images/curated-video-poster.png", PNG_BYTES)
    return stream.getvalue()


def main() -> None:
    archive = package_fixture()
    item = {
        "id": "feature:video-workflow",
        "title": "视频精选",
        "type": "video_prompt",
        "packageId": "video-workflow",
        "packageVersion": "1.0.0",
        "authorId": "author-video-editorial",
        "author": "视频作者",
        "license": "权利归原作者",
        "rightsStatus": "verified_authorized",
        "rightsReviewUrl": "https://wchao6891.github.io/PromptDirector-Curated/reviews/video-workflow.json",
        "updatedAt": "2026-08-10T00:00:00.000Z",
        "coverUrl": COVER_URL,
        "previewUrl": PREVIEW_URL,
        "downloadUrl": PACKAGE_URL,
        "sha256": hashlib.sha256(archive).hexdigest(),
        "archiveBytes": len(archive),
        "caseCount": 1,
        "imageCount": 1,
        "videoCount": 1,
        "summary": "视频包只公开封面。",
        "order": 1,
    }
    catalog = {
        "format": "prompt-director-curated",
        "version": 2,
        "updatedAt": "2026-08-10T00:00:00.000Z",
        "themes": [item],
    }
    preview = {
        "format": "prompt-director-curated-preview",
        "version": 1,
        "catalogId": item["id"],
        "packageId": item["packageId"],
        "packageVersion": item["packageVersion"],
        "entries": [{
            "id": "curated-video-case",
            "title": "精选视频案例",
            "text": "镜头沿主体缓慢环绕。",
            "author": "视频作者",
            "rights": "权利归原作者",
            "sourceUrl": "https://example.com/video-case",
            "mediaKind": "video",
            "previewImageUrl": POSTER_URL,
            "videoUrl": VIDEO_URL,
            "videoSha256": hashlib.sha256(VIDEO_BYTES).hexdigest(),
            "videoBytes": len(VIDEO_BYTES),
            "videoMimeType": "video/mp4",
            "width": 1280,
            "height": 720,
        }],
    }
    metrics = {
        "format": "prompt-director-curated-metrics",
        "version": 1,
        "updatedAt": "2026-08-10T01:00:00.000Z",
        "downloads": {item["id"]: 3},
    }

    with extension_session("prompt-director-curated-video-", viewport={"width": 1280, "height": 900}) as session:
        session.context.route(CATALOG_URL, lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(catalog)
        ))
        session.context.route(METRICS_URL, lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(metrics)
        ))
        session.context.route(PREVIEW_URL, lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(preview)
        ))
        session.context.route(COVER_URL, lambda route: route.fulfill(
            status=200, content_type="image/png", body=PNG_BYTES
        ))
        session.context.route(POSTER_URL, lambda route: route.fulfill(
            status=200, content_type="image/webp", body=PNG_BYTES
        ))
        session.context.route(VIDEO_URL, lambda route: route.fulfill(
            status=200, content_type="video/mp4", body=VIDEO_BYTES
        ))
        session.context.route(f"{PACKAGE_URL}*", lambda route: route.fulfill(
            status=200, content_type="application/zip", body=archive
        ))
        curated = session.open_page("curated.html", wait_until="networkidle")
        curated.locator("#filter-button").click()
        curated.locator('#filter-popover input[value="video_prompt"]').check()
        expect(curated.locator(".pack-card")).to_have_count(1)
        curated.locator(".pack-card").click()
        expect(curated.locator(".case-card .case-visual")).to_have_count(1)
        expect(curated.locator(".case-card .case-copy, .case-actions")).to_have_count(0)
        expect(curated.locator(".case-card .case-video-badge")).to_have_count(1)

        curated.locator(".case-card").click()
        expect(curated.locator(".case-detail-video")).to_have_count(1)
        expect(curated.locator(".case-detail-video")).to_have_attribute("poster", POSTER_URL)
        curated.locator(".case-save-action").click()
        expect(curated).to_have_url(re.compile(r"/library\.html(?:\?.*)?$"))
        expect(curated.locator("#detail-drawer")).to_have_class(re.compile(r"\bopen\b"))
        expect(curated.locator(".detail-video")).to_have_count(1)
        state = curated.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert len(state["entries"]) == 1, state
        saved = state["entries"][0]
        assert len(saved["mediaAssets"]) == 2, saved
        assets = curated.evaluate(
            """async (entry) => Promise.all(entry.mediaAssets.map(async (asset) => {
              const {getMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const blob = await getMediaBlob(asset.id);
              return {id: asset.id, kind: asset.kind, type: blob?.type, size: blob?.size};
            }))""",
            saved,
        )
        assert assets == [
            {"id": saved["mediaAssets"][0]["id"], "kind": "video", "type": "video/mp4", "size": len(VIDEO_BYTES)},
            {"id": saved["mediaAssets"][1]["id"], "kind": "image", "type": "image/png", "size": len(PNG_BYTES)},
        ], assets

        print({"video_online_player": True, "video_single_save": True, "assets": assets})


if __name__ == "__main__":
    main()
