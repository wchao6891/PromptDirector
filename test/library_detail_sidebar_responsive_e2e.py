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
          const node = selector => document.querySelector(selector);
          const rect = selector => node(selector).getBoundingClientRect();
          const shown = element => Boolean(element?.checkVisibility?.({visibilityProperty: true}))
            && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
          const drawer = rect('#detail-drawer');
          const body = rect('.detail-primary > .detail-body');
          const title = node('.detail-title');
          const titleStyle = getComputedStyle(title);
          const navigationButtons = [...document.querySelectorAll('.detail-navigation .icon-button')]
            .filter(shown).map(button => button.getBoundingClientRect());
          const toolbarButtons = [...document.querySelectorAll('.drawer-toolbar > .icon-button')]
            .filter(shown).map(button => button.getBoundingClientRect());
          const next = node('#detail-next');
          const nextRect = next.getBoundingClientRect();
          const video = node('.detail-video');
          // Only controls the user can actually see/hit; content of a closed <details> is excluded.
          const protectedControls = [...document.querySelectorAll(
            '.detail-visual-caption button, .time-notes button, .detail-body button, .detail-body summary, .detail-body a, .detail-body select, .detail-title'
          )].filter(shown).map(control => control.getBoundingClientRect());
          const overlaps = (left, right) => !(
            left.right <= right.left || left.left >= right.right ||
            left.bottom <= right.top || left.top >= right.bottom
          );
          return {
            drawerWidth: drawer.width,
            drawerRight: drawer.right,
            drawerCenterY: (drawer.top + drawer.bottom) / 2,
            contentWidth: rect("#detail-content").width,
            galleryVisible: shown(node('.detail-visual-gallery')),
            navigationVisible: shown(node('#detail-navigation')),
            videoVisible: shown(video),
            bodyWidth: body.width,
            nextRight: nextRect.right,
            nextCenterY: (nextRect.top + nextRect.bottom) / 2,
            toolbarRight: Math.max(...toolbarButtons.map(button => button.right)),
            toolbarContained: toolbarButtons.length > 0 && toolbarButtons.every(button => button.left >= drawer.left && button.right <= drawer.right),
            titleUsableWidth: title.clientWidth - Number.parseFloat(titleStyle.paddingRight || '0'),
            navigationOverlapsControls: navigationButtons.some(button => protectedControls.some(control => overlaps(button, control))),
            toolbarOverlapsControls: toolbarButtons.some(button => protectedControls.some(control => overlaps(button, control))),
            detailOverflow: node('#detail-content').scrollWidth > node('#detail-content').clientWidth,
          };
        }"""
    )


def assert_sidebar_geometry(value: dict) -> None:
    # The sidebar became an information panel (user-approved "采用信息面板方案", 2026-10-04): media gallery and
    # case navigation arrows are hidden there, cases are switched from the still-browsable grid, and the full
    # detail keeps media plus navigation. The layout-stability intent is kept: the info body fills the panel,
    # the top toolbar stays inside it and never covers any visible control, the title keeps room, no overflow.
    assert value["galleryVisible"] is False and value["videoVisible"] is False, value
    assert value["navigationVisible"] is False, value
    assert value["bodyWidth"] >= value["contentWidth"] - 2, value
    assert value["toolbarContained"] is True, value
    assert 4 <= value["drawerRight"] - value["toolbarRight"] <= 16, value
    assert value["toolbarOverlapsControls"] is False, value
    assert value["titleUsableWidth"] >= 220, value
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
        expect(library.locator(".detail-title")).to_have_text("courier-chase-multi-reference")

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
        # Media playback and case navigation are checked in full detail, where they now live.
        expect(library.locator("#detail-navigation")).to_be_visible()
        library.get_by_role("button", name="播放视频", exact=True).click()
        library.wait_for_function("() => document.querySelector('.detail-video')?.readyState >= 2")
        fullscreen = sidebar_geometry(library)
        assert fullscreen["galleryVisible"] is True and fullscreen["videoVisible"] is True, fullscreen
        assert fullscreen["navigationVisible"] is True, fullscreen
        assert 4 <= fullscreen["drawerRight"] - fullscreen["nextRight"] <= 16, fullscreen
        assert abs(fullscreen["nextCenterY"] - fullscreen["drawerCenterY"]) < 1, fullscreen
        assert fullscreen["navigationOverlapsControls"] is False, fullscreen
        assert fullscreen["titleUsableWidth"] >= 180, fullscreen
        assert fullscreen["detailOverflow"] is False, fullscreen
        fullscreen_editor = library.locator(".entry-editor-body").evaluate(
            "node => ({clientWidth: node.clientWidth, scrollWidth: node.scrollWidth})"
        )
        assert fullscreen_editor["scrollWidth"] <= fullscreen_editor["clientWidth"] + 1, fullscreen_editor
        library.locator("#detail-prev").click()  # cards are newest-first, so case B precedes A
        expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", "sidebar-video-b")
        expect(library.locator(".detail-title")).to_have_text("第二个视频案例")

        print({"sidebar_widths": len(snapshots), "snapshots": snapshots, "editor": editor, "fullscreen": fullscreen, "fullscreen_editor": fullscreen_editor, "screenshot": str(screenshot)})


if __name__ == "__main__":
    main()
