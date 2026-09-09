"""Real Chrome file handles + installed updater + final ZIP + runtime reload.
Only directory consent and the release download transport are supplied by fixtures.
The temporary browser profile never contains user data.
"""
import argparse
import json
import shutil
import tempfile
import time
import zipfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from e2e_support import base_entry, seed_extension_storage


def grant_directory_by_drop(page, context, installed):
    page.bring_to_front()
    page.evaluate("""() => {
      window.installationHandle = null;
      window.installationDrop = {events:[]};
      window.addEventListener('dragenter', event => {window.installationDrop.events.push({type:'enter',items:event.dataTransfer.items.length,files:event.dataTransfer.files.length});}, {capture:true,once:true});
      // CDP sends another dragover immediately before drop. Keep accepting it
      // until the drop so Chromium can negotiate the directory operation.
      const accept = event => {event.preventDefault();event.stopImmediatePropagation();};
      window.addEventListener('dragover', accept, {capture:true});
      window.addEventListener('drop', async event => {
        event.preventDefault();event.stopImmediatePropagation();
        window.removeEventListener('dragover', accept, {capture:true});
        window.installationDrop.events.push({type:'drop',items:event.dataTransfer.items.length,files:event.dataTransfer.files.length});
        try { window.installationHandle=await event.dataTransfer.items[0]?.getAsFileSystemHandle(); }
        catch(error){window.installationDrop.error=String(error);}
      }, {capture:true,once:true});
    }""")
    cdp = context.new_cdp_session(page)
    data = {"items": [], "files": [str(installed)], "dragOperationsMask": 1}
    for kind in ["dragEnter", "dragOver", "drop"]:
        cdp.send("Input.dispatchDragEvent", {"type": kind, "x": 50, "y": 50, "data": data})
    try:
        page.wait_for_function("() => Boolean(window.installationHandle)")
    except Exception:
        print({'directoryDrop': page.evaluate("() => window.installationDrop"), 'url':page.url, 'path':str(installed)},flush=True)
        raise
    assert page.evaluate("() => installationHandle.queryPermission({mode:'readwrite'})") == "granted"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("previous_directory", type=Path)
    parser.add_argument("current_archive", type=Path)
    args = parser.parse_args()
    package = args.current_archive.read_bytes()
    with zipfile.ZipFile(args.current_archive) as archive:
        target = json.loads(archive.read("manifest.json"))
    with tempfile.TemporaryDirectory(prefix="pd-native-release-") as temp, sync_playwright() as playwright:
        root = Path(temp)
        installed = root / "installation"
        shutil.copytree(args.previous_directory, installed)
        previous = json.loads((installed / "manifest.json").read_text())
        assert previous["version"] != target["version"]
        profile = root / "profile"
        preferences = profile / "Default" / "Preferences"
        preferences.parent.mkdir(parents=True)
        preferences.write_text(json.dumps({"profile": {"default_content_setting_values": {"file_system_write_guard": 1}}}))
        context = playwright.chromium.launch_persistent_context(
            str(profile), headless=True, channel="chromium", viewport={"width": 1280, "height": 900},
            args=[f"--disable-extensions-except={installed}", f"--load-extension={installed}"]
        )
        try:
            setup = context.new_page()
            setup.goto("chrome://extensions")
            if not setup.locator("#devMode").evaluate("element => element.checked"):
                setup.locator("#devMode").click()
            setup.close()
            release_url = f"{target['homepage_url']}/releases/tag/v{target['version']}"
            download_url = f"{target['homepage_url']}/releases/download/v{target['version']}/PromptDirector-{target['version']}-FIXED-ID-DEV.zip"
            context.route("https://**/*", lambda route: route.fulfill(status=200, content_type="application/zip", body=package)
                          if route.request.url == download_url else route.abort())
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            extension_id = worker.url.split("/")[2]
            page = context.new_page()
            page.goto(f"chrome-extension://{extension_id}/collector.html")
            entry = base_entry("native-upgrade-case", "升级前案例", "升级后正文保持", "content:image-case", 1)
            entry["mediaAssets"] = [{"id":"native-upgrade-media", "kind":"image", "usage":"content", "storageMode":"managed", "mimeType":"image/png"}]
            seed_extension_storage(page, {"entries": [entry]})
            before = page.evaluate("""async () => {
              const {saveMediaBlob} = await import('./media-store.js');
              await saveMediaBlob('native-upgrade-media',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}));
              return {entries:(await chrome.storage.local.get('entries')).entries, media:Array.from(new Uint8Array(await(await(await import('./media-store.js')).getMediaBlob('native-upgrade-media')).arrayBuffer()))};
            }""")
            page.goto(f"chrome-extension://{extension_id}/library.html")
            grant_directory_by_drop(page, context, installed)
            page.evaluate("""({version,releaseUrl}) => {
              window.showDirectoryPicker=async()=>window.installationHandle;
              import('./local-extension-upgrade-ui.js').then(module=>module.openLocalUpgrade({latestVersion:version,releaseUrl}));
            }""", {"version": target["version"], "releaseUrl": release_url})
            page.get_by_role("button", name="下载更新包", exact=True).click()
            button = page.get_by_role("button", name="选择安装文件夹并升级", exact=True)
            expect(button).to_be_visible(timeout=60_000)
            button.click()
            deadline = time.monotonic() + 240
            last_progress = ""
            while not page.is_closed() and time.monotonic() < deadline:
                try:
                    status = page.locator(".app-dialog-status")
                    if status.count():
                        progress = status.inner_text()
                        if progress != last_progress and ("error" in (status.get_attribute("class") or "")):
                            raise AssertionError(progress)
                        last_progress = progress
                    page.wait_for_timeout(200)
                except Exception:
                    # runtime.reload intentionally closes this page. Success is
                    # established below from a new page and the reloaded extension.
                    if not page.is_closed():
                        raise
            assert page.is_closed(), f"Updater did not reload: {last_progress}"
            check = context.new_page()
            check.goto("chrome://extensions")
            check.wait_for_function("""async ({id,version}) =>
              (await chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true}))
                .some(extension=>extension.id===id&&extension.version===version&&extension.state==='ENABLED')
            """, arg={"id": extension_id, "version": target["version"]})
            check.goto(f"chrome-extension://{extension_id}/collector.html")
            proof = check.evaluate("""async () => {
              const upgrade=await import('./local-extension-upgrade.js');
              const record=await upgrade.localUpgradeRecord();
              const {getMediaBlob}=await import('./media-store.js');
              return {id:chrome.runtime.id,version:chrome.runtime.getManifest().version,
                entries:(await chrome.storage.local.get('entries')).entries,
                media:Array.from(new Uint8Array(await(await getMediaBlob('native-upgrade-media')).arrayBuffer())),
                verified:await upgrade.verifyRunningUpgrade(record,chrome.runtime)};
            }""")
            assert proof["verified"] and proof["entries"] == before["entries"] and proof["media"] == before["media"], proof
            assert proof["id"] == extension_id and proof["version"] == target["version"], proof
            # A reload may revoke write consent. Retain the location even then.
            retained = check.evaluate("""async () => {
              const upgrade=await import('./local-extension-upgrade.js');
              const feedback=await (await import('./local-extension-upgrade-ui.js')).runningUpgradeFeedback();
              const saved=await upgrade.localInstallationDirectory();
              const record=await upgrade.localUpgradeRecord();
              return {saved:!!saved,name:saved?.name,cleanupRequired:feedback.cleanupRequired,
                same:!record || await saved.isSameEntry(record.root)};
            }""")
            assert retained['saved'] and retained['same'] and retained['name']==installed.name, retained
            # Supply renewed consent by a real directory drop; no replacement chooser.
            check.goto(f"chrome-extension://{extension_id}/library.html", wait_until="networkidle")
            grant_directory_by_drop(check, context, installed)
            directory_proof = check.evaluate("""async () => {
              const upgrade=await import('./local-extension-upgrade.js');
              const ui=await import('./local-extension-upgrade-ui.js');
              const directory=await import('./local-installation-directory.js');
              await ui.runningUpgradeFeedback();
              const saved=await upgrade.localInstallationDirectory();
              if(!saved || await upgrade.localUpgradeRecord()) throw Error('Cleanup must retain the installed directory');
              const root=await directory.resolveLocalInstallationDirectory(saved, {
                pickDirectory:()=>{throw Error('Must reuse the installed folder after upgrade');}
              });
              return {name:root.name,reused:true};
            }""")
            assert directory_proof["reused"] and directory_proof["name"] == installed.name, directory_proof
            print(json.dumps({"native_in_place_upgrade": "passed", "previous": previous["version"], "current": target["version"],
                              "case_media_identity_retained": True, "installation_directory_reused": True,
                              "permission": "preauthorized isolated profile"}), flush=True)
        finally:
            context.close()


if __name__ == "__main__":
    main()
