from __future__ import annotations

import tempfile
import base64
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


def video_entry(entry_id: str, title: str, minute: int) -> dict:
    entry = base_entry(entry_id, title, "验证侧栏详情缩放时的媒体导航与编辑布局。", "content:prompt:video", minute)
    asset_id = f"{entry_id}-video"
    entry["mediaAssets"] = [{
        "id": asset_id,
        "kind": "video",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "video/mp4",
        "sourceTitle": f"{title}.mp4",
        "sourceFormat": "mp4",
        "byteSize": 4,
        "width": 1280,
        "height": 720,
        "durationMs": 30_000,
        "capturedAt": "2026-08-08T00:00:00.000Z",
        "reviewStatus": "verified",
    }]
    entry["primaryMediaId"] = asset_id
    return entry


def sidebar_geometry(page) -> dict:
    return page.evaluate(
        """() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect();
          const drawer = rect('#detail-drawer');
          const gallery = rect('.detail-visual-gallery');
          const body = rect('.detail-primary > .detail-body');
          const item = rect('.detail-visual-item');
          const video = rect('.detail-video');
          const title = document.querySelector('.detail-title');
          const titleStyle = getComputedStyle(title);
          const navigationButtons = [...document.querySelectorAll('.detail-navigation .icon-button')]
            .map(button => button.getBoundingClientRect());
          const next = rect('#detail-next');
          const protectedControls = [...document.querySelectorAll(
            '.detail-visual-caption button, .time-notes button, .detail-body button, .detail-body summary'
          )].filter(control => {
            const style = getComputedStyle(control);
            const controlRect = control.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && controlRect.width > 0 && controlRect.height > 0;
          }).map(control => control.getBoundingClientRect());
          const overlaps = (left, right) => !(
            left.right <= right.left || left.left >= right.right ||
            left.bottom <= right.top || left.top >= right.bottom
          );
          return {
            drawerWidth: drawer.width,
            drawerRight: drawer.right,
            drawerCenterY: (drawer.top + drawer.bottom) / 2,
            contentWidth: rect("#detail-content").width,
            galleryWidth: gallery.width,
            bodyWidth: body.width,
            itemRight: item.right,
            nextRight: next.right,
            nextCenterY: (next.top + next.bottom) / 2,
            videoTop: video.top,
            videoBottom: video.bottom,
            titleUsableWidth: title.clientWidth - Number.parseFloat(titleStyle.paddingRight || '0'),
            navigationOverlapsControls: navigationButtons.some(button => protectedControls.some(control => overlaps(button, control))),
            detailOverflow: document.querySelector('#detail-content').scrollWidth > document.querySelector('#detail-content').clientWidth,
          };
        }"""
    )


def assert_sidebar_geometry(value: dict) -> None:
    assert value["bodyWidth"] >= value["contentWidth"] - 2, value
    assert value["galleryWidth"] >= value["contentWidth"] - 2, value
    assert 4 <= value["drawerRight"] - value["nextRight"] <= 16, value
    assert abs(value["nextCenterY"] - value["drawerCenterY"]) < 1, value
    assert value["titleUsableWidth"] >= 220, value
    assert value["navigationOverlapsControls"] is False, value
    assert value["detailOverflow"] is False, value


def main() -> None:
    entries = [
        video_entry("sidebar-video-a", "courier-chase-multi-reference", 1),
        video_entry("sidebar-video-b", "第二个视频案例", 2),
    ]
    with extension_session(
        "prompt-director-detail-sidebar-responsive-",
        viewport={"width": 1280, "height": 850},
    ) as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entries, encoded}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const playable = new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], {type: 'video/mp4'});
              await chrome.storage.local.clear();
              await chrome.storage.local.set({
                schemaVersion: 28,
                entries,
                uiPreferences: {
                  locale: 'zh-CN', theme: 'light', motion: 'reduced',
                  detailMode: 'sidebar', detailSidebarWidth: 1200
                }
              });
              for (const entry of entries) await saveMediaBlob(entry.primaryMediaId, playable, {checkCapacity: false});
            }""",
            {"entries": entries, "encoded": base64.b64encode((Path(__file__).parent / "fixtures/zhipu-local-video-smoke.mp4").read_bytes()).decode()},
        )

        library = session.open_page("library.html", wait_until="networkidle")
        library.locator('.case-card[data-entry-id="sidebar-video-a"]').click()
        expect(library.locator("#detail-drawer")).to_have_attribute("data-detail-mode", "sidebar")
        expect(library.locator("#detail-navigation")).to_be_visible()
        library.wait_for_function("() => document.querySelector('.detail-video')?.readyState>=2")

        snapshots = []
        screenshot = Path(tempfile.gettempdir()) / "promptdirector-detail-sidebar-responsive.png"
        for width in [1280, 1120, 1000, 920]:
            library.set_viewport_size({"width": width, "height": 850})
            library.wait_for_timeout(100)
            snapshot = sidebar_geometry(library)
            assert_sidebar_geometry(snapshot)
            snapshots.append(snapshot)
            if width == 1120:
                library.screenshot(path=str(screenshot), full_page=True)

        library.locator(".entry-editor-inline > summary").click()
        expect(library.locator(".entry-editor-body")).to_be_visible()
        editor = library.locator(".entry-editor-body").evaluate(
            """node => ({
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
              rowWidths: [...node.querySelectorAll('.entry-edit-row, .entry-tag-add')]
                .map(row => ({clientWidth: row.clientWidth, scrollWidth: row.scrollWidth}))
            })"""
        )
        assert editor["scrollWidth"] <= editor["clientWidth"] + 1, editor
        assert all(row["scrollWidth"] <= row["clientWidth"] + 1 for row in editor["rowWidths"]), editor

        library.locator("#detail-mode-toggle").click()
        expect(library.locator("#detail-drawer")).to_have_attribute("data-detail-mode", "fullscreen")
        fullscreen = sidebar_geometry(library)
        assert 4 <= fullscreen["drawerRight"] - fullscreen["nextRight"] <= 16, fullscreen
        assert abs(fullscreen["nextCenterY"] - fullscreen["drawerCenterY"]) < 1, fullscreen
        assert fullscreen["titleUsableWidth"] >= 180, fullscreen
        fullscreen_editor = library.locator(".entry-editor-body").evaluate(
            "node => ({clientWidth: node.clientWidth, scrollWidth: node.scrollWidth})"
        )
        assert fullscreen_editor["scrollWidth"] <= fullscreen_editor["clientWidth"] + 1, fullscreen_editor

        print({"sidebar_widths": len(snapshots), "snapshots": snapshots, "editor": editor, "fullscreen": fullscreen, "fullscreen_editor": fullscreen_editor, "screenshot": str(screenshot)})


if __name__ == "__main__":
    main()
