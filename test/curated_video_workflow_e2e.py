from __future__ import annotations

import base64
import hashlib
import io
import json
import zipfile

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
CATALOG_URL = "https://wchao6891.github.io/PromptDirector-Curated/catalog.json"
COVER_URL = "https://wchao6891.github.io/PromptDirector-Curated/covers/video-workflow.png"
PACKAGE_URL = "https://github.com/wchao6891/PromptDirector-Curated/releases/download/video-workflow-1.0.0/video-workflow.zip"
VIDEO_BYTES = b"fixture-video"
POSTER_BYTES = base64.b64decode(PNG_BASE64)


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
            "byteSize": len(POSTER_BYTES),
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
        "organizerState": {
            "version": 6,
            "collections": [{
                "id": "collection:curated-video-workflow",
                "name": "视频精选主题",
                "order": 0,
                "entryIds": [entry["id"]],
            }],
        },
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("library.json", json.dumps(package, ensure_ascii=False))
        archive.writestr("videos/curated-video.mp4", VIDEO_BYTES)
        archive.writestr("images/curated-video-poster.png", POSTER_BYTES)
    return stream.getvalue()


def main() -> None:
    archive = package_fixture()
    catalog = {
        "format": "prompt-director-curated",
        "version": 2,
        "updatedAt": "2026-08-10T00:00:00.000Z",
        "themes": [{
            "id": "feature:video-workflow",
            "title": "视频精选",
            "type": "video_prompt",
            "packageId": "video-workflow",
            "packageVersion": "1.0.0",
            "author": "PromptDirector Editorial",
            "license": "测试许可",
            "updatedAt": "2026-08-10T00:00:00.000Z",
            "coverUrl": COVER_URL,
            "downloadUrl": PACKAGE_URL,
            "sha256": hashlib.sha256(archive).hexdigest(),
            "caseCount": 1,
            "imageCount": 1,
            "videoCount": 1,
            "summary": "验证视频预览与保存。",
            "order": 1,
        }],
    }

    with extension_session("prompt-director-curated-video-", viewport={"width": 1280, "height": 900}) as session:
        session.context.route(CATALOG_URL, lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(catalog),
        ))
        session.context.route(COVER_URL, lambda route: route.fulfill(
            status=200,
            content_type="image/png",
            body=POSTER_BYTES,
        ))
        session.context.route(f"{PACKAGE_URL}*", lambda route: route.fulfill(
            status=200,
            content_type="application/zip",
            body=archive,
        ))
        session.context.add_init_script(
            """(() => {
              if (!globalThis.chrome?.permissions) return;
              Object.defineProperty(chrome.permissions, 'contains', {value: async () => true});
              Object.defineProperty(chrome.permissions, 'request', {value: async () => true});
            })()"""
        )

        curated = session.open_page("curated.html", wait_until="networkidle")
        curated.locator(".theme-open").click()
        curated.wait_for_timeout(500)
        expect(curated.locator("#cases-view")).to_be_visible()
        expect(curated.locator("#curated-status")).to_have_text("")
        expect(curated.locator("#curated-grid .case-shot")).to_have_count(1)
        curated.locator("#curated-grid .case-card").click()
        video = curated.locator("#detail-content video")
        expect(video).to_have_count(1)
        expect(video).to_have_attribute("controls", "")

        curated.locator("#detail-close").click()
        curated.locator("#save-theme").click()
        expect(curated.locator("#save-theme")).to_have_text("已全部保存")
        saved = curated.evaluate(
            """async () => {
              const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
              const entry = state.entries.find((item) => item.title === '精选视频案例');
              const store = await import(chrome.runtime.getURL('media-store.js'));
              const assets = await Promise.all(entry.mediaAssets.map(async (asset) => {
                const blob = await store.getMediaBlob(asset.id);
                return {kind: asset.kind, usage: asset.usage, type: blob?.type, size: blob?.size};
              }));
              return {entry, assets};
            }"""
        )
        assert saved["entry"]["mediaAssets"][0]["kind"] == "video", saved
        assert saved["assets"] == [
            {"kind": "video", "usage": "content", "type": "video/mp4", "size": len(VIDEO_BYTES)},
            {"kind": "image", "usage": "poster", "type": "image/png", "size": len(POSTER_BYTES)},
        ], saved

        print({"video_preview": True, "video_saved": True, "assets": saved["assets"]})


if __name__ == "__main__":
    main()
