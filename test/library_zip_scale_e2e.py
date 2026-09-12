"""Real byte transport beyond ZIP32, using synthetic inert source-file fixtures."""
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

from playwright.sync_api import expect
from e2e_support import base_entry, extension_session, wait_for_download


def write_archive(path: Path, library: str, asset_path: str, size: int, method: int) -> str:
    digest = hashlib.sha256()
    block = b"PromptDirector transport fixture\n" * (1024 * 32)
    with zipfile.ZipFile(path, "w", compression=method, allowZip64=True) as archive:
        archive.writestr("library.json", library)
        with archive.open(asset_path, "w", force_zip64=True) as target:
            remaining = size
            while remaining:
                chunk = block[:min(remaining, len(block))]
                target.write(chunk)
                digest.update(chunk)
                remaining -= len(chunk)
    return digest.hexdigest()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="promptdirector-zip64-") as temporary, extension_session("promptdirector-zip-scale-") as session:
        root = Path(temporary)
        setup = session.open_page("collector.html")
        sentinel = base_entry("local-sentinel", "Keep local case", "Original local text", "content:prompt:text")
        schema = setup.evaluate("async () => (await import(chrome.runtime.getURL('taxonomy.js'))).SCHEMA_VERSION")
        session.seed_storage(setup, {"schemaVersion": schema, "entries": [sentinel]})
        fixtures = [
            ("zip64-original", (1 << 32) + 1, zipfile.ZIP_STORED),
            ("deflated-original", 129 * 1024 * 1024, zipfile.ZIP_DEFLATED),
        ]
        sources = []
        for identity, size, method in fixtures:
            entry = base_entry(identity, identity, "Synthetic byte transport; not a playable design file", "content:prompt:text")
            asset_path = f"attachments/{identity}/original.psd"
            entry["mediaAssets"] = [{
                "id": identity + "-asset", "kind": "attachment", "storageMode": "managed",
                "mimeType": "image/vnd.adobe.photoshop", "sourceFormat": "psd", "byteSize": size,
                "capturedAt": "2026-09-07T00:00:00.000Z", "assetPath": asset_path,
            }]
            entry["primaryMediaId"] = identity + "-asset"
            library_json = setup.evaluate("async entry => (await import(chrome.runtime.getURL('lib.js'))).renderLibraryJson([entry])", entry)
            path = root / f"{identity}.zip"
            digest = write_archive(path, library_json, asset_path, size, method)
            sources.append({"path": path, "id": identity, "size": size, "sha256": digest})
        print("Generated real ZIP32-boundary and DEFLATE fixtures", flush=True)
        page = session.open_page("library.html", wait_until="networkidle")
        page.locator("#open-settings").click()
        page.locator('[data-settings-tab="general"]').click()
        page.locator("#library-package-file").set_input_files([str(item["path"]) for item in sources])
        confirm = page.locator("#library-package-import-confirm")
        expect(confirm).to_be_enabled(timeout=300000)
        # Cancellation after actual preflight must leave the existing library untouched.
        page.locator("#library-package-import-cancel").click()
        state = page.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert [entry["id"] for entry in state["entries"]] == [sentinel["id"]]
        page.locator("#library-package-file").set_input_files([str(item["path"]) for item in sources])
        expect(confirm).to_be_enabled(timeout=300000)
        confirm.click()
        expect(page.locator("#library-package-import-dialog")).to_be_hidden(timeout=300000)
        for source in sources:
            result = page.evaluate("""async id => {
              const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
              const entry = state.entries.find(entry => entry.id === id);
              const {getMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const {sha256Blob} = await import(chrome.runtime.getURL('blob-digest.js'));
              const blob = await getMediaBlob(entry.mediaAssets[0].id);
              return {size: blob.size, sha256: await sha256Blob(blob)};
            }""", source["id"])
            assert result == {"size": source["size"], "sha256": source["sha256"]}, result
        print("Default multi-package import and stored byte hashes passed", flush=True)
        page.locator("#settings-close").click()
        page.locator("#select-cases").click()
        for source in sources:
            page.locator(f'.case-card[data-entry-id="{source["id"]}"]').click()
        if not page.locator("#share-export").is_visible():
            page.locator("#selection-more-menu > summary").click()
        page.locator("#share-export").click()
        page.locator("#share-dialog-export").click()
        expect(page.locator("#feedback")).to_contain_text("分享包已导出", timeout=300000)
        download, _ = wait_for_download(page, timeout_seconds=300)
        # Move this test-created download under the temporary directory for cleanup.
        exported = root / "roundtrip.zip"
        download.rename(exported)
        with zipfile.ZipFile(exported) as archive:
            library = json.loads(archive.read("library.json"))
            for source in sources:
                entry = next(entry for entry in library["entries"] if entry["id"] == source["id"])
                asset = entry["mediaAssets"][0]
                assert archive.getinfo(asset["assetPath"]).file_size == source["size"]
                digest = hashlib.sha256()
                with archive.open(asset["assetPath"]) as stream:
                    while chunk := stream.read(1024 * 1024):
                        digest.update(chunk)
                assert digest.hexdigest() == source["sha256"]
        assert not session.page_errors, session.page_errors
        print(json.dumps({"status": "passed", "actualBytes": sum(item["size"] for item in sources), "zip64": True, "independentPythonReadback": True}), flush=True)


if __name__ == "__main__":
    main()
