"""Stop the real worker at the restore commit boundary; retain cases and media.
Fault injection pauses storage acknowledgement only, never supplies an apply result.
"""
import json
from e2e_support import base_entry, extension_session, wait_for_async_condition


def check_interruption(phase):
    with extension_session(f"pd-restore-{phase}-") as session:
        page = session.open_page("collector.html")
        old = base_entry("before-restore", "本机原案例", "必须能回退", "content:image-case", 1)
        old["mediaAssets"] = [{"id": "before-media", "kind": "image", "usage": "content", "storageMode": "managed", "mimeType": "image/png"}]
        session.seed_storage(page, {"entries": [old]})
        page.evaluate("""async () => {
          const {saveMediaBlob} = await import('./media-store.js');
          await saveMediaBlob('before-media', new Blob(['original-media-fixture'], {type:'image/png'}));
        }""")
        worker = session.context.service_workers[0]
        cdp = session.context.new_cdp_session(page)
        versions = []
        cdp.on("ServiceWorker.workerVersionUpdated", lambda event: versions.extend(event["versions"]))
        cdp.send("ServiceWorker.enable")
        worker.evaluate("""phase => {
          const set = chrome.storage.local.set.bind(chrome.storage.local);
          chrome.storage.local.set = async payload => {
            await set(payload);
            if (payload.libraryImportTransactions?.items?.some(item => item.status === phase)) {
              await new Promise(() => {});
            }
          };
        }""", phase)
        incoming = base_entry("incoming-restore", "备份里的案例", "恢复后正文", "content:text-case", 2)
        page.evaluate("""async entry => {
          const {renderLibraryJson} = await import('./lib.js');
          const {applyLibraryImportWithReceipt} = await import('./library-import-client.js');
          const library = JSON.parse(renderLibraryJson([entry], {}));
          const preview = await chrome.runtime.sendMessage({type:'PREVIEW_LIBRARY_IMPORT', library,
            sourceType:'complete-backup', mode:'exact-replace', resourceIndex:{mediaAssetIds:[],skillAssetIds:[]}});
          if (!preview.ok) throw new Error(preview.message);
          window.restoreRequest = {type:'APPLY_LIBRARY_IMPORT', library, plan:preview.plan,
            planToken:preview.planToken, operationId:crypto.randomUUID()};
          applyLibraryImportWithReceipt(window.restoreRequest, {send: async request => {
            try { return await chrome.runtime.sendMessage(request); }
            catch (error) { window.channelError = error.message; throw error; }
          }}).then(result => window.restoreResult=result, error => window.restoreError=error.message);
        }""", incoming)
        wait_for_async_condition(page, """async phase =>
          (await chrome.storage.local.get('libraryImportTransactions')).libraryImportTransactions?.items?.some(item=>item.status===phase)
        """, arg=phase)
        version = next(v for v in reversed(versions) if v.get("scriptURL") == worker.url and v.get("runningStatus") == "running")
        cdp.send("ServiceWorker.stopWorker", {"versionId": version["versionId"]})
        page.wait_for_function("() => window.restoreResult || window.restoreError")
        proof = page.evaluate("""async () => {
          const stored = await chrome.storage.local.get(['entries','libraryReplacementRecoveryPoint','libraryImportTransactions']);
          const {getMediaBlob} = await import('./media-store.js');
          const point = stored.libraryReplacementRecoveryPoint;
          const replay = await chrome.runtime.sendMessage(window.restoreRequest);
          const afterReplay = (await chrome.storage.local.get('libraryReplacementRecoveryPoint')).libraryReplacementRecoveryPoint;
          return {result:window.restoreResult, error:window.restoreError, channelError:window.channelError,
            entries:stored.entries.map(entry=>({id:entry.id,text:entry.text})),
            recoveryEntries:point?.state?.entries?.map(entry=>entry.id),
            media:await (await getMediaBlob('before-media')).text(),
            replay, recoveryIdUnchanged:point?.id===afterReplay?.id,
            receipt:stored.libraryImportTransactions.items[0].status};
        }""")
        assert "message channel closed before a response was received" in proof["channelError"], proof
        assert proof["result"]["ok"] and proof["receipt"] == "completed", proof
        assert proof["entries"] == [{"id": incoming["id"], "text": incoming["text"]}], proof
        assert proof["recoveryEntries"] == [old["id"]], proof
        assert proof["media"] == "original-media-fixture", proof
        assert proof["replay"] == proof["result"] and proof["recoveryIdUnchanged"], proof
        rollback = page.evaluate("""async () => {
          const point = (await chrome.storage.local.get('libraryReplacementRecoveryPoint')).libraryReplacementRecoveryPoint;
          const request = {type:'RESTORE_LIBRARY_REPLACEMENT_POINT', expectedPointId:point.id, operationId:crypto.randomUUID()};
          const first = await chrome.runtime.sendMessage(request);
          const second = await chrome.runtime.sendMessage(request);
          const stored = await chrome.storage.local.get(['entries','libraryReplacementRecoveryPoint']);
          return {first, second, entries:stored.entries.map(entry=>entry.id)};
        }""")
        assert rollback["first"] == rollback["second"] and rollback["entries"] == [old["id"]], rollback
        assert page.evaluate("""async () => {
          const {withLocalUpgradeLock} = await import('./local-extension-upgrade.js');
          return withLocalUpgradeLock(async () => {
            let entered = false;
            try { await withLocalUpgradeLock(() => {entered=true;}); }
            catch (error) { return error.code==='UPGRADE_BUSY' && !entered; }
            return false;
          });
        }""")
        print(json.dumps({"phase": phase, "worker_stop_recovered": True, "case_and_recovery_media_preserved": True}), flush=True)


if __name__ == "__main__":
    for phase in ["pending", "completed"]:
        check_interruption(phase)
