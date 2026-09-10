"""Hold real preflight boundaries to verify truthful readiness and stale-result isolation."""
import json
import tempfile
import zipfile
from pathlib import Path

from playwright.sync_api import expect
from e2e_support import base_entry, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix="pd-import-pending-") as temporary, extension_session("pd-import-pending-") as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {"entries": [base_entry("local-sentinel", "Local case", "Keep local text", "content:prompt:text")]})
        page = session.open_page("library.html", wait_until="networkidle")
        entry = base_entry("pending-case", "Pending case", "Preserve this text", "content:prompt:text")
        original = b"Synthetic attachment transport fixture"
        asset_path = "attachments/pending/original.psd"
        entry["mediaAssets"] = [{"id": "pending-asset", "kind": "attachment", "storageMode": "managed", "mimeType": "image/vnd.adobe.photoshop", "sourceFormat": "psd", "byteSize": len(original), "assetPath": asset_path}]
        entry["primaryMediaId"] = "pending-asset"
        library = page.evaluate("async entry => (await import('./lib.js')).renderLibraryJson([entry])", entry)
        path = Path(temporary) / "pending.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("library.json", library)
            archive.writestr(asset_path, original)
        page.locator("#open-settings").click()
        page.locator('[data-settings-tab="general"]').click()
        page.evaluate("""() => {
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          const estimate = navigator.storage.estimate.bind(navigator.storage);
          window.planGates = [];
          window.capacityGates = [];
          chrome.runtime.sendMessage = async (...args) => {
            if (args[0]?.type === 'PREVIEW_LIBRARY_IMPORT_BATCH') {
              await new Promise(resolve => planGates.push(resolve));
            }
            return send(...args);
          };
          navigator.storage.estimate = async () => {
            if (!window.planGates.length) return estimate();
            return new Promise((resolve, reject) => capacityGates.push({resolve, reject}));
          };
        }""")
        confirm = page.locator("#library-package-import-confirm")
        feedback = page.locator("#library-package-import-feedback")
        rows = page.locator(".library-package-import-status")
        page.locator("#library-package-file").set_input_files(str(path))
        page.wait_for_function("() => planGates.length === 1")
        expect(confirm).to_be_disabled()
        expect(feedback).to_have_text("正在核对案例…")
        expect(rows).not_to_contain_text("可导入")
        page.evaluate("() => planGates[0]()")
        page.wait_for_function("() => capacityGates.length === 1")
        expect(feedback).to_have_text("正在检查可用空间…")
        expect(confirm).to_be_disabled()
        expect(rows).not_to_contain_text("可导入")
        # Removing the only package invalidates its outstanding capacity result.
        page.locator('.library-package-import-row button[aria-label="移除"]').click()
        page.evaluate("() => capacityGates[0].reject(new Error('stale capacity failure'))")
        expect(feedback).not_to_contain_text("stale")
        expect(confirm).to_be_disabled()
        page.locator("#library-package-import-cancel").click()
        page.locator("#library-package-file").set_input_files(str(path))
        page.wait_for_function("() => planGates.length === 2")
        page.evaluate("() => planGates[1]()")
        page.wait_for_function("() => capacityGates.length === 2")
        page.evaluate("() => capacityGates[1].resolve({quota: 0, usage: 0})")
        expect(feedback).to_contain_text("空间")
        expect(rows).to_have_text("检查失败")
        expect(confirm).to_be_disabled()
        page.locator("#library-package-import-cancel").click()
        page.locator("#library-package-file").set_input_files(str(path))
        page.wait_for_function("() => planGates.length === 3")
        page.evaluate("() => planGates[2]()")
        page.wait_for_function("() => capacityGates.length === 3")
        page.evaluate("() => capacityGates[2].resolve({quota: 1e9, usage: 0})")
        expect(confirm).to_be_enabled()
        expect(feedback).to_have_text("检查通过")
        expect(rows).to_contain_text("可导入 1 个新案例")
        confirm.click()
        expect(page.locator("#library-package-import-dialog")).to_be_hidden()
        saved = page.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        imported = next(item for item in saved if item['id'] == entry['id'])
        assert imported['text'] == entry['text']
        stored = page.evaluate("async id => Array.from(new Uint8Array(await (await (await import('./media-store.js')).getMediaBlob(id)).arrayBuffer()))", imported['mediaAssets'][0]['id'])
        assert bytes(stored) == original
        print(json.dumps({"status": "passed", "pendingPlan": True, "pendingCapacity": True, "capacityFailureBlocks": True, "staleResultIgnored": True, "importReadback": True}))


if __name__ == "__main__":
    main()
