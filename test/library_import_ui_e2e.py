from __future__ import annotations

import re
import tempfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, base_entry, extension_session


def wait_for_confirmation(page, supported: str) -> None:
    expect(page.locator("#import-dialog")).to_be_visible()
    expect(page.locator("#import-confirmation")).to_be_visible()
    expect(page.locator("#import-supported-count")).to_have_text(supported)


def seed_import_job(page, *, job_id: str, status: str = "queued", asset_id: str, staged_id: str) -> None:
    page.evaluate(
        """async ({jobId, status, assetId, stagedId}) => {
          const now = new Date().toISOString();
          await chrome.alarms.clear('prompt-director-local-import');
          await chrome.storage.local.set({
            importJobs: {
              version: 1,
              items: [{
                id: jobId,
                status,
                collectionId: 'collection:fixture',
                createdAt: now,
                updatedAt: now,
                createdEntryIds: [],
                options: {duplicateAction: 'skip', autoAnalyze: false},
                items: [{id: `${jobId}:item`, stagedAssetId: stagedId, status: 'queued'}]
              }]
            },
            importStaging: {
              version: 1,
              assets: [{
                id: stagedId,
                assetId,
                name: 'resume.txt',
                relativePath: 'resume.txt',
                kind: 'document',
                mimeType: 'text/plain',
                byteSize: 10,
                contentHash: 'c'.repeat(64),
                contentText: 'Retry note'
              }]
            }
          });
        }""",
        {"jobId": job_id, "status": status, "assetId": asset_id, "stagedId": staged_id},
    )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="prompt-director-folder-import-") as folder_temp:
        folder = Path(folder_temp) / "Reference Folder"
        (folder / "nested").mkdir(parents=True)
        (folder / "brief.txt").write_text("Folder brief", encoding="utf-8")
        (folder / "nested" / "brief.txt").write_text("Folder brief", encoding="utf-8")
        (folder / "nested" / "shot.md").write_text("Nested shot", encoding="utf-8")

        with extension_session("prompt-director-library-import-ui-", viewport={"width": 1280, "height": 900}) as run:
            setup = run.open_page("collector.html")
            duplicate_entry = base_entry("entry:duplicate", "Existing duplicate", "", "content:image")
            duplicate_entry.update({
                "mediaAssets": [{
                    "id": "asset:existing-duplicate",
                    "kind": "document",
                    "storageMode": "managed",
                    "mimeType": "text/plain",
                    "byteSize": 12,
                    "sourceTitle": "duplicate.txt",
                    "relativePath": "duplicate.txt",
                }],
                "primaryMediaId": "asset:existing-duplicate",
            })
            run.seed_storage(setup, {
                "schemaVersion": 24,
                "entries": [duplicate_entry],
                "organizerState": {
                    "version": 6,
                    "collections": [{
                        "id": "collection:fixture",
                        "name": "Import Review",
                        "order": 0,
                        "entryIds": [],
                        "visibility": "library",
                    }] + [{
                        "id": f"collection:fixture:{index}",
                        "name": "用于验证完整换行显示的特别长项目名称" if index == 11 else f"Import Project {index:02d}",
                        "order": index,
                        "entryIds": [],
                        "visibility": "library",
                    } for index in range(1, 12)],
                },
                **ai_configuration_fixture(
                    providers={
                        "openai": {
                            "apiKey": "test-only-key",
                            "consent": True,
                            "models": {"imageAnalysis": "gpt-4.1-mini"},
                        },
                    },
                    assignments={
                        "imageAnalysis": {"providerId": "openai", "model": "gpt-4.1-mini"},
                    },
                    auto_analyze_imports=True,
                ),
            })
            setup.evaluate(
                """async () => {
                  const media = await import(chrome.runtime.getURL('media-store.js'));
                  await media.saveMediaBlob(
                    'asset:existing-duplicate',
                    new Blob(['same content'], {type: 'text/plain'})
                  );
                }"""
            )

            library = run.open_page("library.html", wait_until="networkidle")
            library.wait_for_selector("body[data-library-state='ready']", timeout=10_000)
            library.evaluate(
                """() => {
                  Object.defineProperty(window, 'showOpenFilePicker', {value: undefined, configurable: true});
                  Object.defineProperty(window, 'showDirectoryPicker', {value: undefined, configurable: true});
                  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
                  chrome.runtime.sendMessage = (message, ...rest) => {
                    if (message?.type !== 'START_IMPORT_JOB') return send(message, ...rest);
                    window.__capturedStartImport = structuredClone(message);
                    return send({...message, options: {...message.options, autoAnalyze: false}}, ...rest);
                  };
                }"""
            )

            library.locator("#add-menu > summary").click()
            library.locator("#add-media").click()
            expect(library.locator("#import-source")).to_be_visible()
            expect(library.locator("#import-last-job")).to_be_hidden()
            with library.expect_file_chooser() as chooser:
                library.locator("#import-choose-files").click()
            long_markdown = ("# Long document\n\n" + "\n\n".join(
                f"## Section {index}\nParagraph {index} keeps the reader scrollable."
                for index in range(1, 81)
            ) + "\n\nEND-OF-DOCUMENT").encode("utf-8")
            chooser.value.set_files([
                {"name": "duplicate.txt", "mimeType": "text/plain", "buffer": b"same content"},
                {"name": "new-note.md", "mimeType": "text/markdown", "buffer": long_markdown},
                {"name": "notes.rtf", "mimeType": "application/rtf", "buffer": br"{\rtf1\ansi RTF import\par Structured note}".replace(b"\\\\", b"\\")},
            ])
            wait_for_confirmation(library, "3")
            expect(library.locator("#import-duplicate-count")).to_have_text("1")
            duplicate_row = library.locator(".import-file-row").filter(has_text="duplicate.txt")
            new_row = library.locator(".import-file-row").filter(has_text="new-note.md")
            expect(duplicate_row.locator("input")).not_to_be_checked()
            expect(duplicate_row.locator("input")).to_be_enabled()
            expect(duplicate_row).to_contain_text("精确重复")
            expect(new_row.locator("input")).to_be_checked()
            expect(new_row.locator("input")).to_be_disabled()
            expect(library.locator("#import-auto-analyze")).not_to_be_checked()
            expect(library.locator("#import-project")).to_have_attribute("role", "combobox")
            library.locator("#import-project").click()
            expect(library.locator(".project-combobox-option")).to_have_count(12)
            import_project_menu = library.locator(".project-combobox-listbox").evaluate(
                """node => {
                  const menu = node.getBoundingClientRect();
                  const footer = node.closest('dialog').querySelector(':scope > footer').getBoundingClientRect();
                  return {background: getComputedStyle(node).backgroundColor, position: getComputedStyle(node).position, visible: !node.hidden, top: menu.top, bottom: menu.bottom, left: menu.left, right: menu.right, viewportWidth: innerWidth, viewportHeight: innerHeight, footerTop: footer.top, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight};
                }"""
            )
            assert import_project_menu["visible"] is True
            assert import_project_menu["background"] not in {"rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"}, import_project_menu
            assert import_project_menu["position"] == "fixed", import_project_menu
            assert import_project_menu["top"] >= 11 and import_project_menu["bottom"] <= import_project_menu["footerTop"] + 1, import_project_menu
            assert import_project_menu["left"] >= 11 and import_project_menu["right"] <= import_project_menu["viewportWidth"] - 11, import_project_menu
            assert import_project_menu["clientHeight"] <= import_project_menu["scrollHeight"], import_project_menu
            library.locator("#import-project").press("Escape")
            expect(library.locator("#import-project")).to_have_attribute("aria-expanded", "false")
            library.locator("#import-project").click()
            library.locator(".project-combobox-option", has_text="Import Review").click()
            duplicate_row.locator("input").check()
            expect(duplicate_row).to_contain_text("仍导入")

            library.locator("#import-start").click()
            expect(library.locator("#import-job-title")).to_have_text("导入完成", timeout=8000)
            payload = library.evaluate("() => window.__capturedStartImport")
            assert payload["collectionId"] == "collection:fixture", payload
            assert len(payload["stagedAssets"]) == 3, payload
            assert {item["name"] for item in payload["stagedAssets"]} == {"duplicate.txt", "new-note.md", "notes.rtf"}, payload
            assert all(item.get("stagedAssetId") for item in payload["items"]), payload
            assert {item["keepDuplicate"] for item in payload["items"]} == {False, True}, payload
            assert payload["options"] == {"autoAnalyze": False}, payload

            expect(library.locator("#import-undo")).to_be_visible()
            expect(library.locator("#import-view-project")).to_be_visible()
            library.locator("#import-view-project").click()
            expect(library.locator("#import-dialog")).not_to_be_visible()
            expect(library.locator(".project-filter", has_text="Import Review")).to_have_attribute("aria-pressed", "true")

            rtf_card = library.locator(".case-card").filter(has_text="notes.rtf")
            rtf_card.click()
            expect(library.locator(".detail-visual-gallery.is-document-detail")).to_be_visible()
            expect(library.locator(".markdown-reader")).to_contain_text("RTF import")
            rtf_text = library.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries.find(item => item.title === 'notes.rtf')?.text || '')")
            assert "\\rtf" not in rtf_text and "RTF import" in rtf_text, rtf_text
            library.locator("#detail-close").click()
            expect(library.locator("#detail-drawer")).not_to_be_visible()

            markdown_card = library.locator(".case-card").filter(has_text="new-note.md")
            expect(markdown_card).to_have_count(1)
            markdown_card.click()
            expect(library.locator(".detail-visual-gallery.is-document-detail")).to_be_visible()
            expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", library.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries.find(item => item.title === 'new-note.md').id)"))
            expect(library.locator(".markdown-reader")).to_contain_text("END-OF-DOCUMENT")
            expect(library.locator(".drawer-toolbar.has-document-navigation #detail-navigation")).to_be_visible()
            document_toolbar = library.evaluate(
                """() => {
                  const box = (selector) => {
                    const rect = document.querySelector(selector).getBoundingClientRect();
                    return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
                  };
                  const nav = box('#detail-navigation');
                  const editor = box('.entry-editor-inline > summary');
                  const close = box('#detail-close');
                  const overlaps = (left, right) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
                  return {nav, editor, close, navEditorOverlap: overlaps(nav, editor), closeEditorOverlap: overlaps(close, editor)};
                }"""
            )
            assert not document_toolbar["navEditorOverlap"] and not document_toolbar["closeEditorOverlap"], document_toolbar
            long_document = library.locator(".detail-visual-gallery.is-document-detail .detail-visual-stage").evaluate(
                """stage => {
                  const before = {clientHeight: stage.clientHeight, scrollHeight: stage.scrollHeight};
                  stage.scrollTop = stage.scrollHeight;
                  return {...before, scrollTop: stage.scrollTop, hasEnd: stage.textContent.includes('END-OF-DOCUMENT')};
                }"""
            )
            assert long_document["scrollHeight"] > long_document["clientHeight"], long_document
            assert long_document["scrollTop"] > 0 and long_document["hasEnd"], long_document
            library.screenshot(path="/tmp/promptdirector-long-document-detail.png")
            library.locator("#detail-close").click()

            library.locator("#add-menu > summary").click()
            library.locator("#add-media").click()
            expect(library.locator("#import-last-job")).to_be_visible()
            library.locator("#import-last-job").click()
            library.locator("#import-undo").click()
            expect(library.locator("#import-undo")).to_be_hidden()
            remaining_ids = library.evaluate("() => chrome.storage.local.get('entries').then(value => (value.entries || []).map(item => item.id))")
            assert remaining_ids == ["entry:duplicate"], remaining_ids
            library.locator("#import-cancel").click()

            library.locator("#add-menu > summary").click()
            library.locator("#add-media").click()
            expect(library.locator("#import-source")).to_be_visible()
            with library.expect_file_chooser() as chooser:
                library.locator("#add-folder").click()
            chooser.value.set_files(str(folder))
            wait_for_confirmation(library, "3")
            folder_rows = library.locator("#import-file-list .import-file-row")
            expect(folder_rows).to_have_count(3)
            expect(library.locator("#import-duplicate-count")).to_have_text("1")
            expect(library.locator("#import-file-list")).to_contain_text("Reference Folder/brief.txt")
            expect(library.locator("#import-file-list")).to_contain_text("Reference Folder/nested/brief.txt")
            expect(library.locator("#import-file-list")).to_contain_text("Reference Folder/nested/shot.md")
            expect(library.locator("#import-project")).to_have_value("Reference Folder")
            library.locator("#import-cancel").click()
            expect(library.locator("#import-dialog")).not_to_be_visible()

            drag_state = library.evaluate(
                """async () => {
                  const transfer = new DataTransfer();
                  transfer.items.add(new File(['Dropped note'], 'dropped.txt', {type: 'text/plain'}));
                  document.dispatchEvent(new DragEvent('dragenter', {dataTransfer: transfer, bubbles: true, cancelable: true}));
                  const overlayVisible = !document.querySelector('#library-drop-target').hidden;
                  document.dispatchEvent(new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true}));
                  return overlayVisible;
                }"""
            )
            assert drag_state is True
            wait_for_confirmation(library, "1")
            expect(library.locator("#import-file-list")).to_contain_text("dropped.txt")
            library.set_viewport_size({"width": 390, "height": 844})
            mobile_layout = library.evaluate(
                """() => {
                  const dialog = document.querySelector('#import-dialog').getBoundingClientRect();
                  return {
                    viewportWidth: innerWidth,
                    pageWidth: document.documentElement.scrollWidth,
                    dialogLeft: dialog.left,
                    dialogRight: dialog.right,
                    fileListWidth: document.querySelector('#import-file-list').scrollWidth,
                    fileListClientWidth: document.querySelector('#import-file-list').clientWidth
                  };
                }"""
            )
            assert mobile_layout["pageWidth"] <= mobile_layout["viewportWidth"], mobile_layout
            assert mobile_layout["dialogLeft"] >= 0 and mobile_layout["dialogRight"] <= mobile_layout["viewportWidth"], mobile_layout
            assert mobile_layout["fileListWidth"] <= mobile_layout["fileListClientWidth"], mobile_layout
            library.screenshot(path="/tmp/promptdirector-import-confirmation-mobile.png")
            library.locator("#import-cancel").click()
            library.set_viewport_size({"width": 1280, "height": 900})

            seed_import_job(
                library,
                job_id="import-job:cancel-ui",
                asset_id="asset:cancel-ui",
                staged_id="staged:cancel-ui",
            )
            library.reload(wait_until="networkidle")
            expect(library.locator("#import-dialog")).to_be_visible()
            expect(library.locator("#import-job-title")).to_have_text(re.compile("^(等待导入|正在导入)$"))
            expect(library.locator("#import-cancel")).to_have_text("取消剩余项")
            library.locator("#import-cancel").click()
            expect(library.locator("#import-job-title")).to_have_text("导入已取消")
            canceled_job = library.evaluate("() => chrome.storage.local.get('importJobs').then(value => value.importJobs.items[0])")
            assert canceled_job["status"] == "canceled", canceled_job
            library.locator("#import-cancel").click()

            seed_import_job(
                library,
                job_id="import-job:retry-ui",
                asset_id="asset:retry-ui",
                staged_id="staged:retry-ui",
            )
            library.reload(wait_until="networkidle")
            expect(library.locator("#import-job-title")).to_have_text(re.compile("^(等待导入|正在导入)$"))
            library.evaluate("() => chrome.alarms.create('prompt-director-local-import', {when: Date.now()})")
            expect(library.locator("#import-job-title")).to_have_text("部分导入失败", timeout=8000)
            expect(library.locator("#import-retry")).to_be_visible()
            library.evaluate(
                """async () => {
                  const media = await import(chrome.runtime.getURL('media-store.js'));
                  await media.saveMediaBlob('asset:retry-ui', new Blob(['Retry note'], {type: 'text/plain'}));
                }"""
            )
            library.locator("#import-retry").click()
            expect(library.locator("#import-job-title")).to_have_text("导入完成", timeout=8000)
            retry_jobs = library.evaluate("() => chrome.storage.local.get('importJobs').then(value => value.importJobs.items)")
            assert len(retry_jobs) == 2, retry_jobs
            assert retry_jobs[1]["retryOf"] == "import-job:retry-ui", retry_jobs
            assert len(retry_jobs[1]["items"]) == 1 and retry_jobs[1]["items"][0]["status"] == "imported", retry_jobs

            print({
                "entryPoints": ["multi-file", "folder", "drop"],
                "rtfLocalMarkdown": True,
                "longDocumentScrollable": long_document,
                "documentToolbar": document_toolbar,
                "duplicateDefaultSkip": True,
                "duplicateKeep": True,
                "mobileNoOverflow": True,
                "projectCombobox": import_project_menu,
                "startPayloadFields": sorted(payload.keys()),
                "refreshRestoredActiveJob": True,
                "actions": ["cancel", "retry", "undo", "view-project"],
            })


if __name__ == "__main__":
    main()
