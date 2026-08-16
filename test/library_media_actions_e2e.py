from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def action_geometry(page, name: str) -> dict:
    button = page.get_by_role("button", name=name)
    expect(button).to_have_count(1)
    return button.evaluate(
        """button => {
          const rect = button.getBoundingClientRect();
          const stage = button.closest('.detail-visual-stage').getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            buttonTop: rect.top,
            buttonBottom: rect.bottom,
            stageTop: stage.top,
            stageBottom: stage.bottom,
            clickable: hit === button || button.contains(hit)
          };
        }"""
    )


def assert_action_is_reachable(page, name: str) -> None:
    geometry = action_geometry(page, name)
    assert geometry["stageTop"] <= geometry["buttonTop"], geometry
    assert geometry["buttonBottom"] <= geometry["stageBottom"], geometry
    assert geometry["clickable"], geometry


def main() -> None:
    entry = base_entry(
        "multi-image-case",
        "多图案例",
        "切换主图后保留的案例文字。",
        "content:prompt:image",
        1,
    )
    entry["mediaAssets"] = [
        image_asset(f"multi-image-{index}", f"2026-08-03T00:00:{index:02d}.000Z", index)
        for index in range(1, 16)
    ]
    entry["primaryMediaId"] = "multi-image-1"

    with extension_session(
        "prompt-director-media-actions-",
        viewport={"width": 1440, "height": 900},
    ) as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entry, png}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              for (let index = 1; index <= 15; index += 1) {
                await saveMediaBlob(`multi-image-${index}`, new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
              }
              await chrome.storage.local.clear();
              await chrome.storage.local.set({schemaVersion: 24, entries: [entry]});
            }""",
            {"entry": entry, "png": PNG_BASE64},
        )

        library = session.open_page("library.html", wait_until="networkidle")
        expect(library.locator(".case-card")).to_have_count(1)
        library.locator(".case-card").click()
        expect(library.locator(".detail-visual-thumb")).to_have_count(15)
        stable_before = library.evaluate(
            """() => {
              const gallery = document.querySelector('.detail-visual-gallery');
              const rail = gallery.querySelector('.detail-visual-rail');
              const detail = document.querySelector('#detail-content');
              gallery.dataset.stabilityProbe = 'same-gallery';
              rail.scrollLeft = rail.scrollWidth;
              const rect = gallery.getBoundingClientRect();
              return {
                railScrollLeft: rail.scrollLeft,
                galleryTop: rect.top,
                railTop: rail.getBoundingClientRect().top,
                stageHeight: gallery.querySelector('.detail-visual-stage').getBoundingClientRect().height,
                detailScrollTop: detail.scrollTop
              };
            }"""
        )
        for index in (14, 6, 11):
            library.locator(".detail-visual-thumb").nth(index).click()
        expect(library.locator(".detail-visual-caption")).to_contain_text("12/15")
        stable_after = library.evaluate(
            """() => {
              const gallery = document.querySelector('.detail-visual-gallery[data-stability-probe="same-gallery"]');
              const rail = gallery?.querySelector('.detail-visual-rail');
              const rect = gallery?.getBoundingClientRect();
              return {
                sameNode: Boolean(gallery),
                railScrollLeft: rail?.scrollLeft,
                galleryTop: rect?.top,
                railTop: rail?.getBoundingClientRect().top,
                stageHeight: gallery?.querySelector('.detail-visual-stage').getBoundingClientRect().height,
                detailScrollTop: document.querySelector('#detail-content').scrollTop
              };
            }"""
        )
        assert stable_after["sameNode"], stable_after
        assert abs(stable_after["railScrollLeft"] - stable_before["railScrollLeft"]) <= 1, (stable_before, stable_after)
        assert abs(stable_after["galleryTop"] - stable_before["galleryTop"]) <= 1, (stable_before, stable_after)
        assert abs(stable_after["railTop"] - stable_before["railTop"]) <= 1, (stable_before, stable_after)
        assert abs(stable_after["stageHeight"] - stable_before["stageHeight"]) <= 1, (stable_before, stable_after)
        assert abs(stable_after["detailScrollTop"] - stable_before["detailScrollTop"]) <= 1, (stable_before, stable_after)

        library.locator(".detail-visual-thumb").nth(14).click()

        assert_action_is_reachable(library, "设为主要媒体")
        assert_action_is_reachable(library, "删除此媒体")

        library.set_viewport_size({"width": 390, "height": 844})
        expect(library.locator(".detail-visual-caption")).to_be_visible()
        assert_action_is_reachable(library, "设为主要媒体")
        assert_action_is_reachable(library, "删除此媒体")

        library.get_by_role("button", name="设为主要媒体").click()
        expect(library.locator(".detail-visual-caption")).to_contain_text("主要媒体")
        state = library.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert state["entries"][0]["primaryMediaId"] == "multi-image-15"
        expect(library.locator(".case-card img[data-visual-id]")).to_have_attribute("data-visual-id", "multi-image-15")

        library.get_by_role("button", name="删除此媒体").click()
        delete_dialog = library.locator("#promptdirector-app-dialog")
        expect(delete_dialog).to_be_visible()
        delete_dialog.get_by_role("button", name="删除媒体", exact=True).click()
        expect(library.locator(".detail-visual-thumb")).to_have_count(14)
        expect(library.locator("#detail-content")).to_contain_text("切换主图后保留的案例文字。")
        state = library.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert [asset["id"] for asset in state["entries"][0]["mediaAssets"]] == [f"multi-image-{index}" for index in range(1, 15)]
        assert state["entries"][0]["primaryMediaId"] == "multi-image-1"
        expect(library.locator(".case-card img[data-visual-id]")).to_have_attribute("data-visual-id", "multi-image-1")

        print({
            "desktop_actions_reachable": True,
            "mobile_actions_reachable": True,
            "primary_media_updated": True,
            "delete_preserved_case": True,
            "rapid_selection_last_wins": "12/15",
            "visual_anchor_shift_px": 1,
        })


def image_asset(asset_id: str, captured_at: str, index: int) -> dict:
    width, height = (1600, 900) if index % 2 else (900, 1600)
    return {
        "id": asset_id,
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": width,
        "height": height,
        "capturedAt": captured_at,
        "reviewStatus": "verified",
    }


if __name__ == "__main__":
    main()
