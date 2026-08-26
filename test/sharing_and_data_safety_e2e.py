from __future__ import annotations

import io
import json
import tempfile
import zipfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session, wait_for_download


def main() -> None:
    entries = [
        base_entry("share-one", "分享案例一", "柔和逆光。", "content:prompt:image", 1),
        base_entry("share-two", "分享案例二", "低饱和庭院。", "content:prompt:image", 2),
    ]
    entries[0]["mediaAssets"] = [
        {"id": "share-image-one", "kind": "image", "storageMode": "managed", "mimeType": "image/png", "width": 1, "height": 1, "palette": {"colors": ["#123456", "#345678"]}},
        {"id": "share-video", "kind": "video", "storageMode": "managed", "mimeType": "video/mp4", "posterAssetId": "share-poster"},
        {"id": "share-poster", "kind": "image", "usage": "poster", "storageMode": "managed", "mimeType": "image/png", "derivedFromAssetId": "share-video"},
        {"id": "share-document", "kind": "document", "storageMode": "managed", "mimeType": "application/pdf", "sourceTitle": "创作说明"},
    ]
    entries[0]["primaryMediaId"] = "share-image-one"
    entries[0]["timeNotes"] = [
        {"id": "share-note", "assetId": "share-video", "startMs": 1200, "endMs": 3400, "text": "镜头加速"}
    ]
    entries[1]["mediaAssets"] = [
        {"id": "share-image-two", "kind": "image", "storageMode": "managed", "mimeType": "image/png", "width": 1, "height": 1, "palette": {"colors": ["#123456", "#345678"]}}
    ]
    entries[1]["primaryMediaId"] = "share-image-two"
    entries[1]["note"] = "不应公开的私人笔记"
    entries[1]["metadataLabels"] = ["作者：测试作者", "权利：本人原创", "秘密：sk-private"]
    trashed_entry = base_entry("trash-one", "回收站案例", "需要跨电脑恢复。", "content:prompt:image", 3)
    trashed_entry["mediaAssets"] = [{
        "id": "trash-image",
        "kind": "image",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 8,
        "height": 8,
    }]
    trashed_entry["primaryMediaId"] = "trash-image"
    trash_state = {
        "version": 1,
        "items": [{
            "id": "trash:entry:trash-one",
            "kind": "entry",
            "targetId": "trash-one",
            "deletedAt": "2026-08-26T00:00:00.000Z",
            "snapshot": trashed_entry,
            "relationships": {"collections": [{"id": "collection:trash", "index": 0}]},
        }, {
            "id": "trash:collection:collection:trash",
            "kind": "collection",
            "targetId": "collection:trash",
            "deletedAt": "2026-08-26T00:00:00.000Z",
            "snapshot": {
                "id": "collection:trash",
                "name": "回收站项目",
                "parentId": None,
                "order": 0,
                "entryIds": ["trash-one"],
            },
            "relationships": {},
        }],
    }
    with extension_session("prompt-director-share-") as session:
        setup = session.open_page("collector.html")
        current_schema = setup.evaluate("async () => (await import(chrome.runtime.getURL('taxonomy.js'))).SCHEMA_VERSION")
        session.seed_storage(setup, {"schemaVersion": current_schema, "entries": entries, "trashState": trash_state})
        setup.evaluate(
            """async () => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const canvas = document.createElement('canvas');
              canvas.width = 8;
              canvas.height = 8;
              const context = canvas.getContext('2d');
              context.fillStyle = '#e5484d';
              context.fillRect(0, 0, 8, 8);
              const imageBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
              await saveMediaBlob('share-image-one', imageBlob, {checkCapacity: false});
              await saveMediaBlob('share-image-two', imageBlob, {checkCapacity: false});
              await saveMediaBlob('share-poster', imageBlob, {checkCapacity: false});
              await saveMediaBlob('share-video', new Blob(['fixture-video'], {type: 'video/mp4'}), {checkCapacity: false});
              await saveMediaBlob('share-document', new Blob(['%PDF-1.4 fixture'], {type: 'application/pdf'}), {checkCapacity: false});
              await saveMediaBlob('trash-image', imageBlob, {checkCapacity: false});
              const opfsRoot = await navigator.storage.getDirectory();
              const linkedHandle = await opfsRoot.getFileHandle('linked-original.zzz', {create: true});
              const writable = await linkedHandle.createWritable();
              await writable.write(new Blob(['linked-original-bytes'], {type: 'application/octet-stream'}));
              await writable.close();
              const linkedFile = await linkedHandle.getFile();
              const {saveLocalAssetHandle} = await import(chrome.runtime.getURL('local-asset-store.js'));
              await saveLocalAssetHandle('linked-local-image', linkedHandle, linkedFile);
              const stored = await chrome.storage.local.get('entries');
              const linkedEntry = {
                schemaVersion: 24,
                id: 'linked-one',
                title: '本机链接素材案例',
                text: '备份时必须复制原件。',
                url: 'https://fixture.invalid/linked-one',
                savedAt: '2026-08-02T08:04:00.000Z',
                classification: {pathIds: ['content:prompt:image'], status: 'confirmed', source: 'manual'},
                facetAssignments: [], analysisCandidates: [], analysisBreakdown: [], rejectedCandidateKeys: [],
                negativeTerms: [], customLabels: [], timeNotes: [],
                mediaAssets: [{
                  id: 'linked-local-image', recordType: 'local-asset-reference', kind: 'attachment', usage: 'content',
                  storageMode: 'reference', mimeType: linkedFile.type, byteSize: linkedFile.size,
                  sourceTitle: linkedFile.name, sourceFormat: 'zzz', formatCategory: 'local-link',
                  relativePath: linkedFile.name, sourceLastModified: linkedFile.lastModified, linkStatus: 'linked',
                  importFailure: {code: 'unsupported_format', message: '不支持的素材格式', forceAllowed: false}
                }],
                primaryMediaId: 'linked-local-image'
              };
              await chrome.storage.local.set({entries: [...stored.entries, linkedEntry]});
            }"""
        )
        setup.wait_for_function(
            """async () => {
              const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
              return state?.entries?.length === 3;
            }"""
        )
        library = session.open_page("library.html", wait_until="networkidle")
        library.locator("#search-input").fill("share-")
        library.locator("#select-cases").click()
        expect(library.locator("#share-bar")).to_be_visible()
        library.locator(".case-card").nth(0).click()
        library.locator(".case-card").nth(1).click()
        expect(library.locator("#share-count")).to_have_text("已选 2")
        library.locator("#share-export").click()
        expect(library.locator("#share-dialog")).to_be_visible()
        expect(library.locator("#share-dialog-submit")).to_be_disabled()
        library.locator("#share-dialog-export").click()
        expect(library.locator("#feedback")).to_contain_text("分享包已导出")
        archive_path, download_id = wait_for_download(library)
        with zipfile.ZipFile(archive_path) as archive:
            shared = json.loads(archive.read("library.json"))
            assert len(shared["entries"]) == 2
            assert shared["schemaVersion"] == current_schema
            assert shared["organizerState"]["collections"] == []
            serialized = json.dumps(shared, ensure_ascii=False)
            assert "apiKey" not in serialized
            preview = archive.read("打开分享包.html").decode("utf-8")
            assert "Content-Security-Policy" in preview
            assert "share-preview-foundation.css" in archive.namelist()
            assert "share-preview-masonry.js" in archive.namelist()
            assert '<symbol id="icon-x"' in preview
            assert 'href="https://chromewebstore.google.com/detail/iahakaahijddcjjldidbclicedibgpjm"' in preview
            assert 'href="https://github.com/wchao6891/PromptDirector"' in preview
            assert archive.testzip() is None
            offline_root = session.profile_dir / "offline-share"
            archive.extractall(offline_root)

        offline = session.context.new_page()
        offline.goto((offline_root / "打开分享包.html").as_uri(), wait_until="networkidle")
        screenshots = Path(tempfile.gettempdir()) / "promptdirector-share-preview-evidence"
        screenshots.mkdir(parents=True, exist_ok=True)
        offline.screenshot(path=str(screenshots / "share-preview-desktop.png"), full_page=True)
        expect(offline.locator("#case-grid > .case-card")).to_have_count(2)
        assert offline.locator("#case-grid > .case-card").nth(0).evaluate("element => element.offsetLeft") != offline.locator("#case-grid > .case-card").nth(1).evaluate("element => element.offsetLeft")
        expect(offline.locator("html")).to_have_attribute("data-theme", "dark")
        expect(offline.locator(".install-action")).to_have_attribute(
            "href", "https://chromewebstore.google.com/detail/iahakaahijddcjjldidbclicedibgpjm"
        )
        expect(offline.locator(".source-action")).to_have_attribute(
            "href", "https://github.com/wchao6891/PromptDirector"
        )
        offline.locator("#search").fill("庭院")
        expect(offline.locator("#visible-count")).to_have_text("1")
        expect(offline.locator("#case-grid > .case-card:visible")).to_have_count(1)
        offline.locator("#search").fill("")
        offline.locator("#case-grid > .case-card").nth(0).click()
        expect(offline.locator("#detail-view")).to_be_visible()
        assert offline.locator("#detail-close .ui-icon").evaluate("element => element.getBoundingClientRect().width") > 0
        expect(offline.locator(".case-detail:visible .detail-image-frame img")).to_be_visible()
        assert offline.locator(".case-detail:visible .detail-image-frame").evaluate("element => getComputedStyle(element).opacity") == "1"
        offline.screenshot(path=str(screenshots / "share-preview-detail-desktop.png"), full_page=True)
        expect(offline.locator(".case-detail:visible video")).to_have_count(1)
        expect(offline.locator(".case-detail:visible a[href*='documents/']")).to_have_count(1)
        expect(offline.locator(".case-detail:visible .time-notes")).to_contain_text("镜头加速")
        offline.locator(".case-detail:visible [data-copy-prompt]").click()
        expect(offline.locator("#feedback")).to_have_text("提示词已复制")
        offline.locator(".case-detail:visible button[data-media-index='1']").click()
        expect(offline.locator(".case-detail:visible .detail-media-panel[data-media-index='1']")).to_be_visible()
        expect(offline.locator(".case-detail:visible .related-section")).to_be_visible()
        offline.locator("#detail-close").click()
        expect(offline.locator("#detail-view")).to_be_hidden()
        offline.set_viewport_size({"width": 390, "height": 844})
        offline.wait_for_timeout(250)
        assert offline.evaluate("document.documentElement.scrollWidth <= 390")
        offline.locator("#case-grid > .case-card").nth(0).click()
        expect(offline.locator(".case-detail:visible .detail-body")).to_be_visible()
        assert offline.evaluate("document.documentElement.scrollWidth <= 390")
        offline.screenshot(path=str(screenshots / "share-preview-detail-mobile.png"), full_page=True)
        offline.close()

        library.locator("#select-cases").click()
        library.locator('.case-card[data-entry-id="share-two"]').click()
        library.locator("#share-export").click()
        expect(library.locator("#share-dialog")).to_be_visible()
        expect(library.locator("#share-dialog-disclosure")).not_to_be_checked()
        library.locator("#share-dialog-disclosure").check()
        expect(library.locator("#share-dialog-submit")).to_be_enabled()
        library.locator("#share-dialog-submit").click()
        expect(library.locator("#share-dialog-result")).to_be_visible(timeout=15_000)
        expect(library.locator("#share-dialog-result")).to_contain_text("投稿包已生成")
        expect(library.locator("#share-dialog-show-files")).to_be_visible()
        expect(library.locator("#share-dialog-open-form")).to_be_visible()
        submission_path, _ = wait_for_download(library, after_id=download_id)
        with zipfile.ZipFile(submission_path) as transport:
            assert sorted(transport.namelist()) == ["payload.zip", "submission.json"]
            manifest = json.loads(transport.read("submission.json"))
            payload_bytes = transport.read("payload.zip")
            assert manifest["format"] == "prompt-director-curated-submission"
            assert manifest["version"] == 1
            assert manifest["caseCount"] == 1
            assert manifest["mediaCount"] == 1
            assert manifest["payloadBytes"] == len(payload_bytes)
            import hashlib
            assert manifest["submissionId"] == hashlib.sha256(payload_bytes).hexdigest()
            with zipfile.ZipFile(io.BytesIO(payload_bytes)) as payload:
                submission_library = json.loads(payload.read("library.json"))
                assert len(submission_library["entries"]) == 1
                assert submission_library["entries"][0]["title"] == "分享案例二"
                serialized = json.dumps(submission_library, ensure_ascii=False)
                assert "不应公开的私人笔记" not in serialized
                assert "sk-private" not in serialized
                assert "作者：测试作者" in serialized
                assert "权利：本人原创" in serialized
                assert payload.testzip() is None
        library.locator("#share-dialog-close").click()

        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="general"]').click()
        expect(library.locator("#create-folder-backup")).to_be_visible()
        expect(library.locator("#restore-folder-backup")).to_be_visible()
        assert library.locator("#create-portable-backup").count() == 0
        library.evaluate(
            """() => {
              class MemoryFileHandle {
                constructor(name) { this.kind = 'file'; this.name = name; this.blob = new Blob([]); }
                async getFile() { return new File([this.blob], this.name, {type: this.blob.type}); }
                async createWritable() {
                  let pending = this.blob;
                  return {
                    write: async (value) => { pending = value instanceof Blob ? value : new Blob([value]); },
                    close: async () => { this.blob = pending; },
                    abort: async () => undefined
                  };
                }
              }
              class MemoryDirectoryHandle {
                constructor(name) { this.kind = 'directory'; this.name = name; this.files = new Map(); this.directories = new Map(); }
                async requestPermission() { return 'granted'; }
                async getFileHandle(name, options = {}) {
                  if (!this.files.has(name) && options.create) this.files.set(name, new MemoryFileHandle(name));
                  if (!this.files.has(name)) throw new DOMException('Not found', 'NotFoundError');
                  return this.files.get(name);
                }
                async getDirectoryHandle(name, options = {}) {
                  if (!this.directories.has(name) && options.create) this.directories.set(name, new MemoryDirectoryHandle(name));
                  if (!this.directories.has(name)) throw new DOMException('Not found', 'NotFoundError');
                  return this.directories.get(name);
                }
                async *entries() {
                  for (const item of this.directories) yield item;
                  for (const item of this.files) yield item;
                }
              }
              window.__installBackupRoot = () => {
                window.__backupRoot = new MemoryDirectoryHandle('chosen-parent');
                Object.defineProperty(window, 'showDirectoryPicker', {
                  value: async () => window.__backupRoot,
                  configurable: true
                });
              };
              window.__installBackupRoot();
            }"""
        )
        library.locator("#create-folder-backup").click()
        expect(library.locator("#data-safety-feedback")).to_contain_text("完整备份已完成", timeout=15_000)
        backup_result = library.evaluate(
            """async () => {
              const folder = [...window.__backupRoot.directories.values()][0];
              const libraryJson = JSON.parse(await (await folder.files.get('library.json').getFile()).text());
              const completion = JSON.parse(await (await folder.files.get('complete.json').getFile()).text());
              const trashEntry = libraryJson.trashState.items.find((item) => item.kind === 'entry');
              const linkedEntry = libraryJson.entries.find((entry) => entry.id === 'linked-one');
              return {
                completeExists: folder.files.has('complete.json'),
                trashCases: completion.trashCaseCount,
                trashProjects: completion.trashProjectCount,
                manifestPaths: completion.files.map((item) => item.path),
                trashAsset: trashEntry.snapshot.mediaAssets[0],
                linkedAsset: linkedEntry.mediaAssets[0]
              };
            }"""
        )
        assert backup_result["completeExists"] is True, backup_result
        assert backup_result["trashCases"] == 1 and backup_result["trashProjects"] == 1, backup_result
        assert "library.json" in backup_result["manifestPaths"], backup_result
        assert backup_result["trashAsset"]["storageMode"] == "managed", backup_result
        assert backup_result["trashAsset"]["assetPath"] in backup_result["manifestPaths"], backup_result
        assert backup_result["linkedAsset"]["storageMode"] == "managed", backup_result
        assert backup_result["linkedAsset"]["assetPath"] in backup_result["manifestPaths"], backup_result
        assert "recordType" not in backup_result["linkedAsset"], backup_result

        library.evaluate(
            """async () => {
              window.__portableBackupFolder = [...window.__backupRoot.directories.values()][0];
              const media = await import(chrome.runtime.getURL('media-store.js'));
              for (const id of ['share-image-one', 'share-image-two', 'share-poster', 'share-video', 'share-document', 'trash-image', 'linked-local-image']) {
                await media.deleteMediaBlob(id);
              }
              const {deleteLocalAssetHandle} = await import(chrome.runtime.getURL('local-asset-store.js'));
              await deleteLocalAssetHandle('linked-local-image');
              await chrome.storage.local.set({
                entries: [],
                trashState: {version: 1, items: []},
                organizerState: {version: 7, collections: []},
                compoundCases: [],
                composerSessions: [],
                creativeRuns: [],
                creativeSkills: {version: 1, items: []}
              });
              Object.defineProperty(window, 'showDirectoryPicker', {
                value: async () => window.__portableBackupFolder,
                configurable: true
              });
            }"""
        )
        library.locator("#restore-folder-backup").click()
        restore_dialog = library.locator("#promptdirector-app-dialog")
        expect(restore_dialog).to_be_visible(timeout=15_000)
        expect(restore_dialog).to_contain_text("恢复资料库备份")
        restore_dialog.locator("button[type='submit']").click()
        expect(library.locator("#data-safety-feedback")).to_contain_text("媒体文件校验并恢复完成", timeout=15_000)
        restored_state = library.evaluate(
            """async () => {
              const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
              const media = await import(chrome.runtime.getURL('media-store.js'));
              return {
                entryIds: state.entries.map((entry) => entry.id).sort(),
                trashKinds: state.trashState.items.map((item) => item.kind).sort(),
                activeImageBytes: (await media.getMediaBlob('share-image-one'))?.size || 0,
                trashImageBytes: (await media.getMediaBlob('trash-image'))?.size || 0,
                linkedImageBytes: (await media.getMediaBlob('linked-local-image'))?.size || 0,
                linkedStorageMode: state.entries.find((entry) => entry.id === 'linked-one')?.mediaAssets?.[0]?.storageMode || ''
              };
            }"""
        )
        assert restored_state["entryIds"] == ["linked-one", "share-one", "share-two"], restored_state
        assert restored_state["trashKinds"] == ["collection", "entry"], restored_state
        assert restored_state["activeImageBytes"] > 0 and restored_state["trashImageBytes"] > 0, restored_state
        assert restored_state["linkedImageBytes"] > 0 and restored_state["linkedStorageMode"] == "managed", restored_state

        library.evaluate(
            """async () => {
              const stored = await chrome.storage.local.get('entries');
              const linked = {
                ...stored.entries[0],
                id: 'unreadable-linked-case',
                title: '失效本机链接',
                mediaAssets: [{
                  id: 'unreadable-linked-asset',
                  recordType: 'local-asset-reference',
                  kind: 'attachment',
                  storageMode: 'reference',
                  mimeType: 'application/octet-stream',
                  byteSize: 12,
                  sourceTitle: 'missing.zzz',
                  sourceFormat: 'zzz',
                  formatCategory: 'local-link',
                  relativePath: 'missing.zzz',
                  linkStatus: 'relink-required',
                  importFailure: {
                    code: 'unsupported_format',
                    message: '不支持的素材格式',
                    forceAllowed: false
                  }
                }],
                primaryMediaId: 'unreadable-linked-asset'
              };
              await chrome.storage.local.set({entries: [...stored.entries, linked]});
              window.__installBackupRoot();
            }"""
        )
        library.locator("#create-folder-backup").click()
        expect(library.locator("#data-safety-feedback")).to_contain_text("未写入完成标记", timeout=15_000)
        failed_backup = library.evaluate(
            """() => {
              const folder = [...window.__backupRoot.directories.values()][0];
              return {created: Boolean(folder), completeExists: Boolean(folder?.files.has('complete.json'))};
            }"""
        )
        assert failed_backup == {"created": True, "completeExists": False}, failed_backup
        print({"shared_entries": 2, "curated_submission": True, "private_drafts_removed": True, "data_safety": True, "folder_backup": backup_result, "cross_machine_restore": restored_state, "unreadable_source_no_marker": failed_backup, "offline_preview": True, "mobile_width": 390, "screenshots": str(screenshots)})


if __name__ == "__main__":
    main()
