from __future__ import annotations

import base64
import json
import tempfile
import zipfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import extension_session


GOOD_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
BAD_PNG = b"not-a-real-png"


def entry(entry_id: str, title: str, text: str, asset_id: str, path: str, byte_size: int, schema: int) -> dict:
    return {
        "id": entry_id,
        "schemaVersion": schema,
        "title": title,
        "text": text,
        "savedAt": "2026-08-26T00:00:00.000Z",
        "classification": {"pathIds": [], "status": "needs_review", "source": "auto"},
        "facetAssignments": [],
        "mediaAssets": [{
            "id": asset_id,
            "kind": "image",
            "storageMode": "managed",
            "assetPath": path,
            "sourceFormat": "png",
            "mimeType": "image/png",
            "byteSize": byte_size,
        }],
        "primaryMediaId": asset_id,
    }


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="prompt-director-broken-zip-") as temporary:
        archive_path = Path(temporary) / "historical-broken-share.zip"
        with extension_session("prompt-director-broken-zip-") as session:
            setup = session.open_page("collector.html")
            schema = setup.evaluate("async () => (await import(chrome.runtime.getURL('taxonomy.js'))).SCHEMA_VERSION")
            package = {
                "format": "prompt-case-library",
                "version": 5,
                "schemaVersion": schema,
                "organizerState": {"version": 7, "collections": []},
                "entries": [
                    entry("case:missing", "缺失素材但正文完好", "这段正文必须保留。", "image:missing", "images/missing.png", 5, schema),
                    entry("case:damaged", "图片字节损坏但正文完好", "这段正文也必须保留。", "image:damaged", "images/damaged.png", len(BAD_PNG), schema),
                    entry("case:good", "完整案例", "有效图片与正文。", "image:good", "images/good.png", len(GOOD_PNG), schema),
                ],
            }
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
                archive.writestr("library.json", json.dumps(package, ensure_ascii=False))
                archive.writestr("images/damaged.png", BAD_PNG)
                archive.writestr("images/good.png", GOOD_PNG)

            library = session.open_page("library.html", wait_until="networkidle")
            library.locator("#library-package-file").set_input_files(str(archive_path))
            dialog = library.locator("#promptdirector-app-dialog")
            expect(dialog).to_be_visible(timeout=10_000)
            expect(dialog).to_contain_text("可导入 3 个新案例")
            expect(dialog).to_contain_text("丢弃损坏或缺失的媒体 2 项")
            dialog.locator("button[type='submit']").click()
            expect(library.locator("#data-safety-feedback")).to_contain_text("分享包媒体已校验", timeout=10_000)

            restored = library.evaluate(
                """async () => {
                  const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
                  const media = await import(chrome.runtime.getURL('media-store.js'));
                  return {
                    entries: state.entries.map((entry) => ({
                      id: entry.id,
                      text: entry.text,
                      mediaIds: (entry.mediaAssets || []).map((asset) => asset.id)
                    })).sort((left, right) => left.id.localeCompare(right.id)),
                    goodBytes: (await media.getMediaBlob('image:good'))?.size || 0,
                    damagedBytes: (await media.getMediaBlob('image:damaged'))?.size || 0
                  };
                }"""
            )
            assert [item["id"] for item in restored["entries"]] == ["case:damaged", "case:good", "case:missing"], restored
            assert restored["entries"][0]["mediaIds"] == [] and restored["entries"][0]["text"], restored
            assert restored["entries"][1]["mediaIds"] == ["image:good"], restored
            assert restored["entries"][2]["mediaIds"] == [] and restored["entries"][2]["text"], restored
            assert restored["goodBytes"] == len(GOOD_PNG) and restored["damagedBytes"] == 0, restored


if __name__ == "__main__":
    main()
