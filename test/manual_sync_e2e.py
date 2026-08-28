from __future__ import annotations

from e2e_support import base_entry, extension_session


def main() -> None:
    entry = base_entry("sync-case", "同步案例", "同步前内容", "content:image-case", 1)
    entry["mediaAssets"] = [{
        "id": "sync-asset",
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/webp",
        "byteSize": 10,
    }]
    entry["primaryMediaId"] = "sync-asset"

    with extension_session("prompt-director-manual-sync-") as session:
        setup = session.open_page("collector.html")
        install_probe(setup)
        current_schema = setup.evaluate("async () => (await import(chrome.runtime.getURL('taxonomy.js'))).SCHEMA_VERSION")
        session.seed_storage(setup, {"schemaVersion": current_schema, "entries": [entry]})
        setup.evaluate(
            """async () => {
              const [{saveMediaBlob}, vaultApi, storeApi] = await Promise.all([
                import(chrome.runtime.getURL('media-store.js')),
                import(chrome.runtime.getURL('sync-vault.js')),
                import(chrome.runtime.getURL('sync-store.js'))
              ]);
              await saveMediaBlob(
                'sync-asset',
                new Blob(['sync-bytes'], {type: 'image/webp'}),
                {checkCapacity: false}
              );
              const root = await navigator.storage.getDirectory();
              const vault = await vaultApi.createOrUnlockSyncVault(root, 'manual-sync-password');
              await storeApi.saveSyncDirectoryHandle(root);
              await storeApi.saveSyncCryptoKey(vault.key);
              await chrome.storage.local.set({
                syncSettings: {
                  enabled: true,
                  vaultId: vault.header.vaultId,
                  deviceId: 'device-e2e',
                  retentionCount: 10
                }
              });
            }"""
        )
        setup.wait_for_function(
            """() => chrome.runtime.sendMessage({type: 'GET_STATE'})
              .then(state => state.entries?.some(entry => entry.id === 'sync-case'))"""
        )

        first = setup.evaluate("async () => chrome.runtime.sendMessage({type: 'SYNC_NOW'})")
        assert first["ok"] is True and first["upToDate"] is False, first
        assert first["mediaCount"] == 1, first
        baseline = setup.evaluate("async () => window.__manualSyncProbe()")
        assert baseline["snapshotCount"] == 1, baseline
        assert baseline["status"]["runningCount"] == 0, baseline
        assert baseline["status"]["pendingCount"] == 0, baseline

        # Opening and reading product state must not schedule another run.
        library = session.open_page("library.html", wait_until="networkidle")
        library.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        library.wait_for_timeout(2_000)
        after_open = setup.evaluate("async () => window.__manualSyncProbe()")
        assert after_open["snapshotCount"] == baseline["snapshotCount"], after_open
        assert after_open["meta"] == baseline["meta"], after_open

        # A normal edit marks pending state but does not transfer until the next explicit run.
        edited = library.evaluate(
            """async () => chrome.runtime.sendMessage({
              type: 'UPDATE_ENTRY_TITLE', entryId: 'sync-case', title: '同步后标题'
            })"""
        )
        assert edited["ok"] is True, edited
        library.wait_for_timeout(2_000)
        pending = setup.evaluate("async () => window.__manualSyncProbe()")
        assert pending["snapshotCount"] == baseline["snapshotCount"], pending
        assert pending["meta"]["localDirty"] is True, pending

        second = setup.evaluate("async () => chrome.runtime.sendMessage({type: 'SYNC_NOW'})")
        assert second["ok"] is True and second["upToDate"] is False, second
        assert second["changeSummary"]["byEntity"]["entry"]["updated"] == 1, second
        after_edit_sync = setup.evaluate("async () => window.__manualSyncProbe()")
        assert after_edit_sync["snapshotCount"] == baseline["snapshotCount"] + 1, after_edit_sync
        assert after_edit_sync["meta"]["localDirty"] is False, after_edit_sync

        # A third explicit run is a true no-op: no snapshot or local sync metadata changes.
        third = setup.evaluate("async () => chrome.runtime.sendMessage({type: 'SYNC_NOW'})")
        assert third["ok"] is True and third["upToDate"] is True, third
        after_noop = setup.evaluate("async () => window.__manualSyncProbe()")
        assert after_noop["snapshotCount"] == after_edit_sync["snapshotCount"], after_noop
        assert after_noop["meta"] == after_edit_sync["meta"], after_noop

        # One missing local media item is isolated, named to the user, and does not block healthy data.
        setup.evaluate(
            """async () => {
              const stored = await chrome.storage.local.get(['entries', 'syncMeta']);
              const missing = {
                ...stored.entries[0],
                id: 'sync-missing-case',
                title: '缺图同步案例',
                text: '正文必须继续同步。',
                mediaAssets: [{
                  id: 'sync-missing-asset', kind: 'image', usage: 'content', storageMode: 'managed',
                  mimeType: 'image/webp', byteSize: 10, sourceTitle: 'missing.webp'
                }],
                primaryMediaId: 'sync-missing-asset'
              };
              await chrome.storage.local.set({
                entries: [...stored.entries, missing],
                syncMeta: {
                  ...stored.syncMeta,
                  localDirty: true,
                  dirtyAssetIds: [...new Set([...(stored.syncMeta?.dirtyAssetIds || []), 'sync-missing-asset'])]
                }
              });
            }"""
        )
        salvaged = setup.evaluate("async () => chrome.runtime.sendMessage({type: 'SYNC_NOW'})")
        assert salvaged["ok"] is True and salvaged["upToDate"] is False, salvaged
        assert salvaged["skippedMediaCount"] == 1, salvaged
        assert salvaged["skippedMedia"][0]["ownerTitle"] == "缺图同步案例", salvaged
        assert "缺图同步案例 / missing.webp" in salvaged["message"], salvaged
        salvaged_state = setup.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        missing_case = next(item for item in salvaged_state["entries"] if item["id"] == "sync-missing-case")
        assert missing_case["text"] == "正文必须继续同步。" and missing_case["mediaAssets"] == [], missing_case
        after_salvage = setup.evaluate("async () => window.__manualSyncProbe()")
        assert after_salvage["snapshotCount"] == after_noop["snapshotCount"] + 1, after_salvage

        # A damaged formal snapshot blocks success; an atomic .partial is never treated as state.
        setup.evaluate(
            """async () => {
              const root = await navigator.storage.getDirectory();
              const devices = await root.getDirectoryHandle('PromptDirector-Sync')
                .then((directory) => directory.getDirectoryHandle('devices'));
              const device = await devices.getDirectoryHandle('device-e2e');
              const partial = await device.getFileHandle('999999999998-writing.partial', {create: true});
              const partialWriter = await partial.createWritable();
              await partialWriter.write('incomplete');
              await partialWriter.close();
              const broken = await device.getFileHandle('999999999999-broken.pds', {create: true});
              const brokenWriter = await broken.createWritable();
              await brokenWriter.write('{broken');
              await brokenWriter.close();
            }"""
        )
        damaged = setup.evaluate("async () => chrome.runtime.sendMessage({type: 'SYNC_NOW'})")
        assert damaged["ok"] is False and "损坏" in damaged["message"], damaged
        damaged_state = setup.evaluate("async () => window.__manualSyncProbe()")
        assert damaged_state["settings"]["lastErrorCode"] == "sync_snapshot_corrupt", damaged_state
        assert damaged_state["snapshotCount"] == after_salvage["snapshotCount"] + 1, damaged_state
        assert damaged_state["status"]["state"] == "error", damaged_state
        assert damaged_state["status"]["runningCount"] == 0, damaged_state
        assert damaged_state["status"]["pendingCount"] == 0, damaged_state

        print({
            "manual_only": True,
            "no_op_zero_snapshot": True,
            "pending_local_changes": True,
            "missing_media_isolated_and_named": True,
            "damaged_snapshot_blocked": True,
            "terminal_quiet": True,
            "snapshot_count": after_salvage["snapshotCount"],
        })


def install_probe(page) -> None:
    page.evaluate(
        """() => {
          window.__manualSyncChangedKeys = [];
          chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            window.__manualSyncChangedKeys.push(Object.keys(changes));
          });
          window.__manualSyncProbe = async () => {
            const root = await navigator.storage.getDirectory();
            const vault = await root.getDirectoryHandle('PromptDirector-Sync');
            const devices = await vault.getDirectoryHandle('devices');
            let snapshotCount = 0;
            for await (const device of devices.values()) {
              if (device.kind !== 'directory') continue;
              for await (const file of device.values()) {
                if (file.kind === 'file' && file.name.endsWith('.pds')) snapshotCount += 1;
              }
            }
            const stored = await chrome.storage.local.get(['syncMeta', 'syncSettings']);
            const status = await chrome.runtime.sendMessage({type: 'GET_SYNC_RUN_STATUS'});
            return {
              snapshotCount,
              meta: stored.syncMeta,
              settings: stored.syncSettings,
              changedKeys: window.__manualSyncChangedKeys.splice(0),
              status: status.syncStatus || status.status || status
            };
          };
        }"""
    )


if __name__ == "__main__":
    main()
