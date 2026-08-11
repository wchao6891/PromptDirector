from __future__ import annotations

import time

from e2e_support import extension_session


def wait_for_job(page, job_id: str, statuses: set[str], timeout_seconds: float = 8) -> dict:
    deadline = time.monotonic() + timeout_seconds
    response = None
    while time.monotonic() < deadline:
        response = page.evaluate(
            "(jobId) => chrome.runtime.sendMessage({type: 'GET_IMPORT_JOB', jobId})",
            job_id,
        )
        if response.get("job", {}).get("status") in statuses:
            return response["job"]
        page.wait_for_timeout(100)
    raise AssertionError(f"导入任务没有在期限内进入 {statuses}：{response}")


def main() -> None:
    with extension_session("prompt-director-import-jobs-", viewport={"width": 1280, "height": 900}) as run:
        starter = run.open_page("collector.html")
        run.seed_storage(starter, {"schemaVersion": 24, "entries": []})

        started = starter.evaluate(
            """async () => {
              const media = await import(chrome.runtime.getURL('media-store.js'));
              const assets = [
                {
                  id: 'staged:first', assetId: 'asset:first', name: 'first.txt',
                  relativePath: 'notes/first.txt', kind: 'document', mimeType: 'text/plain',
                  byteSize: 10, contentText: 'First note'
                },
                {
                  id: 'staged:second', assetId: 'asset:second', name: 'second.md',
                  relativePath: 'notes/second.md', kind: 'document', mimeType: 'text/markdown',
                  byteSize: 11, contentText: 'Second note'
                }
              ];
              await media.saveMediaBlob('asset:first', new Blob(['First note'], {type: 'text/plain'}));
              await media.saveMediaBlob('asset:second', new Blob(['Second note'], {type: 'text/markdown'}));
              return chrome.runtime.sendMessage({
                type: 'START_IMPORT_JOB',
                stagedAssets: assets,
                items: assets.map(asset => ({stagedAssetId: asset.id, keepDuplicate: false})),
                options: {autoAnalyze: false}
              });
            }"""
        )
        assert started["ok"], started
        first_job_id = started["job"]["id"]
        starter.close()

        observer = run.open_page("collector.html")
        completed = wait_for_job(observer, first_job_id, {"completed"})
        assert [item["status"] for item in completed["items"]] == ["imported", "imported"], completed
        imported_ids = completed["createdEntryIds"]
        assert len(imported_ids) == 2, completed

        undo = observer.evaluate(
            "(jobId) => chrome.runtime.sendMessage({type: 'UNDO_IMPORT_JOB', jobId})",
            first_job_id,
        )
        assert undo["ok"], undo
        entries_after_undo = observer.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries || [])")
        assert not entries_after_undo, entries_after_undo

        canceled = observer.evaluate(
            """async () => {
              const media = await import(chrome.runtime.getURL('media-store.js'));
              const jobs = await import(chrome.runtime.getURL('import-jobs.js'));
              const stagingApi = await import(chrome.runtime.getURL('import-staging.js'));
              const blob = new Blob(['cancel me'], {type: 'text/plain'});
              await media.saveMediaBlob('asset:cancel-a', blob);
              await media.saveMediaBlob('asset:cancel-b', blob);
              let staging = stagingApi.addStagedAsset(undefined, {
                id: 'staged:cancel-a', assetId: 'asset:cancel-a', name: 'cancel-a.txt',
                relativePath: 'cancel-a.txt', kind: 'document', mimeType: 'text/plain', byteSize: blob.size,
                contentHash: 'a'.repeat(64)
              }).state;
              staging = stagingApi.addStagedAsset(staging, {
                id: 'staged:cancel-b', assetId: 'asset:cancel-b', name: 'cancel-b.txt',
                relativePath: 'cancel-b.txt', kind: 'document', mimeType: 'text/plain', byteSize: blob.size,
                contentHash: 'b'.repeat(64)
              }).state;
              const current = await chrome.storage.local.get('importJobs');
              const created = jobs.createImportJob(current.importJobs, {
                items: [{stagedAssetId: 'staged:cancel-a'}, {stagedAssetId: 'staged:cancel-b'}],
                options: {autoAnalyze: false}
              }, {id: 'import-job:cancel'});
              await chrome.storage.local.set({importJobs: created.state, importStaging: staging});
              return chrome.runtime.sendMessage({type: 'CANCEL_IMPORT_JOB', jobId: created.job.id});
            }"""
        )
        assert canceled["ok"], canceled
        assert canceled["job"]["status"] == "canceled", canceled
        assert all(item["status"] == "skipped" and item["skipReason"] == "canceled" for item in canceled["job"]["items"]), canceled

        failed_job_id = observer.evaluate(
            """async () => {
              const jobs = await import(chrome.runtime.getURL('import-jobs.js'));
              const stagingApi = await import(chrome.runtime.getURL('import-staging.js'));
              const stored = await chrome.storage.local.get(['importJobs', 'importStaging']);
              const staging = stagingApi.addStagedAsset(stored.importStaging, {
                id: 'staged:retry', assetId: 'asset:retry', name: 'retry.txt',
                relativePath: 'retry.txt', kind: 'document', mimeType: 'text/plain', byteSize: 10,
                contentHash: 'c'.repeat(64), contentText: 'Retry note'
              }).state;
              const created = jobs.createImportJob(stored.importJobs, {
                items: [{stagedAssetId: 'staged:retry'}], options: {autoAnalyze: false}
              }, {id: 'import-job:failure'});
              await chrome.storage.local.set({importJobs: created.state, importStaging: staging});
              await chrome.alarms.create('prompt-director-local-import', {when: Date.now()});
              return created.job.id;
            }"""
        )
        failed = wait_for_job(observer, failed_job_id, {"failed"})
        assert len(failed["items"]) == 1 and failed["items"][0]["status"] == "failed", failed

        retry = observer.evaluate(
            """async (jobId) => {
              const media = await import(chrome.runtime.getURL('media-store.js'));
              await media.saveMediaBlob('asset:retry', new Blob(['Retry note'], {type: 'text/plain'}));
              return chrome.runtime.sendMessage({type: 'RETRY_IMPORT_JOB', jobId});
            }""",
            failed_job_id,
        )
        assert retry["ok"], retry
        assert retry["job"]["retryOf"] == failed_job_id and len(retry["job"]["items"]) == 1, retry
        retried = wait_for_job(observer, retry["job"]["id"], {"completed"})
        assert retried["items"][0]["status"] == "imported", retried

        retry_undo = observer.evaluate(
            "(jobId) => chrome.runtime.sendMessage({type: 'UNDO_IMPORT_JOB', jobId})",
            retry["job"]["id"],
        )
        assert retry_undo["ok"], retry_undo
        final_entries = observer.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries || [])")
        assert not final_entries, final_entries

        print({
            "continuedAfterPageClose": True,
            "multiFileImported": len(imported_ids),
            "canceledRemaining": len(canceled["job"]["items"]),
            "retriedFailedOnly": len(retry["job"]["items"]),
            "undoScopedToJob": True,
        })


if __name__ == "__main__":
    main()
