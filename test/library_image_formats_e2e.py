"""Registered image formats must survive default import and a real filesystem backup."""
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session


def main() -> None:
    fixtures = Path(__file__).parent / "fixtures" / "transfer-media"
    with tempfile.TemporaryDirectory(prefix="promptdirector-image-transfer-") as temp, extension_session("promptdirector-image-transfer-") as session:
        setup = session.open_page("collector.html")
        schema = setup.evaluate("async () => (await import(chrome.runtime.getURL('taxonomy.js'))).SCHEMA_VERSION")
        session.seed_storage(setup, {"schemaVersion": schema, "entries": [base_entry("keep", "Keep", "Keep", "content:prompt:text")]})
        entry = base_entry("formats", "Image formats", "Keep original image formats", "content:prompt:image")
        entry["mediaAssets"] = []
        expected = {}
        for extension in ["gif", "avif"]:
            data = (fixtures / f"original.{extension}").read_bytes()
            expected[extension] = hashlib.sha256(data).hexdigest()
            entry["mediaAssets"].append({
                "id": extension, "kind": "image", "storageMode": "managed", "sourceFormat": extension,
                "mimeType": f"image/{extension}", "byteSize": len(data), "assetPath": f"images/formats/original.{extension}",
                "capturedAt": "2026-09-07T00:00:00.000Z",
            })
        entry["primaryMediaId"] = "gif"
        library = setup.evaluate("async entry => (await import(chrome.runtime.getURL('lib.js'))).renderLibraryJson([entry])", entry)
        archive_path = Path(temp) / "formats.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("library.json", library)
            for asset in entry["mediaAssets"]:
                archive.write(fixtures / f"original.{asset['sourceFormat']}", asset["assetPath"])
        page = session.open_page("library.html", wait_until="networkidle")
        page.locator("#open-settings").click()
        page.locator('[data-settings-tab="general"]').click()
        page.locator("#library-package-file").set_input_files(str(archive_path))
        expect(page.locator("#library-package-import-confirm")).to_be_enabled()
        expect(page.locator("#library-package-import-media-count")).to_have_text("2")
        page.locator("#library-package-import-confirm").click()
        expect(page.locator("#library-package-import-dialog")).to_be_hidden()
        page.evaluate("""() => {
          window.showDirectoryPicker = async () => {
            if (!navigator.userActivation.isActive) throw new Error('Missing activation');
            return navigator.storage.getDirectory();
          };
        }""")
        page.locator("#create-folder-backup").click()
        expect(page.locator("#data-safety-feedback")).to_contain_text("完整备份已完成", timeout=30000)
        proof = page.evaluate("""async () => {
          const root = await navigator.storage.getDirectory();
          const {sha256Blob} = await import(chrome.runtime.getURL('blob-digest.js'));
          for await (const directory of root.values()) {
            if (directory.kind !== 'directory' || !directory.name.startsWith('PromptDirector-Backup-')) continue;
            const marker = JSON.parse(await (await (await directory.getFileHandle('complete.json')).getFile()).text());
            const library = JSON.parse(await (await (await directory.getFileHandle('library.json')).getFile()).text());
            const entry = library.entries.find(entry => entry.id === 'formats');
            const hashes = {};
            for (const asset of entry.mediaAssets) {
              const parts = asset.assetPath.split('/');
              let parent = directory;
              for (const name of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(name);
              const blob = await (await parent.getFileHandle(parts.at(-1))).getFile();
              hashes[asset.sourceFormat] = await sha256Blob(blob);
            }
            return {hashes, mediaCount: marker.mediaCount};
          }
        }""")
        assert proof == {"hashes": expected, "mediaCount": 2}, proof
        assert not session.page_errors, session.page_errors
        print(json.dumps({"formats": list(expected), "defaultImportAndFilesystemBackup": "passed"}))


if __name__ == "__main__":
    main()
