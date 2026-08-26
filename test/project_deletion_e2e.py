from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def main() -> None:
    entry = base_entry(
        "project-delete-case",
        "项目删除回归案例",
        "项目和案例应一起进入回收站，并能完整恢复。",
        "content:prompt:image",
    )
    entry["mediaAssets"] = [{
        "id": "project-delete-image",
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "byteSize": 68,
        "width": 1,
        "height": 1,
        "capturedAt": "2026-08-26T00:00:00.000Z",
    }]
    entry["primaryMediaId"] = "project-delete-image"
    project = {
        "id": "collection:project-delete",
        "name": "待删除项目",
        "parentId": None,
        "order": 0,
        "entryIds": [entry["id"]],
    }

    with extension_session("prompt-director-project-delete-") as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entry, project, png}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              await saveMediaBlob('project-delete-image', new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
              await chrome.storage.local.clear();
              await chrome.storage.local.set({
                schemaVersion: 24,
                entries: [entry],
                organizerState: {version: 4, collections: [project]},
                trashState: {version: 1, items: []}
              });
            }""",
            {"entry": entry, "project": project, "png": PNG_BASE64},
        )

        library = session.open_page("library.html", wait_until="networkidle")
        row = library.locator(".project-row", has_text="待删除项目")
        expect(row).to_be_visible()
        row.locator("summary").click()
        row.get_by_role("button", name="删除项目及案例", exact=True).click()
        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="全部移入回收站", exact=True).click()
        expect(library.locator("#feedback")).to_contain_text("已移入回收站")

        deleted = library.evaluate(
            """async () => {
              const state = await chrome.storage.local.get(['entries', 'organizerState', 'trashState']);
              const {getMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const blob = await getMediaBlob('project-delete-image');
              return {
                entryIds: (state.entries || []).map(item => item.id),
                collectionIds: (state.organizerState?.collections || []).map(item => item.id),
                trashKinds: (state.trashState?.items || []).map(item => item.kind).sort(),
                mediaBytes: blob?.size || 0
              };
            }"""
        )
        assert deleted == {
            "entryIds": [],
            "collectionIds": [],
            "trashKinds": ["collection", "entry"],
            "mediaBytes": 68,
        }, deleted

        if library.locator("#settings-dialog").is_visible():
            library.locator("#settings-close").click()
        library.locator("#open-trash").click()
        expect(library.locator("#trash-dialog")).to_be_visible()
        expect(library.locator(".trash-item")).to_have_count(2)
        library.locator("#trash-restore-all").click()
        expect(library.locator("#trash-feedback")).to_contain_text("已恢复")
        restored = library.evaluate(
            """async () => {
              const state = await chrome.storage.local.get(['entries', 'organizerState', 'trashState']);
              const collection = state.organizerState.collections.find(item => item.id === 'collection:project-delete');
              const {getMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              return {
                entryIds: state.entries.map(item => item.id),
                collectionEntryIds: collection?.entryIds || [],
                trashCount: state.trashState.items.length,
                mediaBytes: (await getMediaBlob('project-delete-image'))?.size || 0
              };
            }"""
        )
        assert restored == {
            "entryIds": ["project-delete-case"],
            "collectionEntryIds": ["project-delete-case"],
            "trashCount": 0,
            "mediaBytes": 68,
        }, restored
        print({"project_delete_restore": True, "media_bytes": restored["mediaBytes"]})


if __name__ == "__main__":
    main()
