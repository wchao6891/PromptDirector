from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


def video_asset(asset_id: str, captured_at: str) -> dict:
    return {
        "id": asset_id,
        "kind": "video",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "video/mp4",
        "sourceTitle": f"{asset_id}.mp4",
        "sourceFormat": "mp4",
        "byteSize": 4,
        "width": 720,
        "height": 1280,
        "durationMs": 10_000,
        "playbackCapability": "external",
        "capturedAt": captured_at,
        "reviewStatus": "verified",
    }


def layout_snapshot(page) -> dict:
    return page.locator(".detail-visual-gallery.is-video-detail").evaluate(
        """gallery => {
          const video = gallery.querySelector('.detail-video');
          const caption = gallery.querySelector('.detail-visual-caption');
          const label = caption?.querySelector(':scope > span:first-child');
          const buttons = [...(caption?.querySelectorAll('button') ?? [])];
          const videoRect = video.getBoundingClientRect();
          const captionRect = caption.getBoundingClientRect();
          const styles = caption ? getComputedStyle(caption) : null;
          return {
            videoBottom: videoRect.bottom,
            captionTop: captionRect.top,
            safetyBand: Number.parseFloat(styles?.borderTopWidth || '0'),
            labelFontSize: Number.parseFloat(label ? getComputedStyle(label).fontSize : '0'),
            buttonHeights: buttons.map(button => button.getBoundingClientRect().height),
            buttonFontSizes: buttons.map(button => Number.parseFloat(getComputedStyle(button).fontSize)),
            buttonsOverlap: buttons.some((button, index) => {
              const current = button.getBoundingClientRect();
              return buttons.slice(index + 1).some(other => {
                const next = other.getBoundingClientRect();
                return current.left < next.right && current.right > next.left
                  && current.top < next.bottom && current.bottom > next.top;
              });
            }),
            galleryHeight: gallery.getBoundingClientRect().height,
            viewportHeight: innerHeight,
          };
        }"""
    )


def main() -> None:
    entry = base_entry(
        "video-layout-case",
        "竖屏视频详情",
        "验证播放器与媒体操作不会互相误触。",
        "content:prompt:video",
        1,
    )
    entry["mediaAssets"] = [
        video_asset("video-layout-a", "2026-08-08T00:00:00.000Z"),
        video_asset("video-layout-b", "2026-08-08T00:00:01.000Z"),
    ]
    entry["primaryMediaId"] = "video-layout-a"

    with extension_session(
        "prompt-director-video-detail-layout-",
        viewport={"width": 1440, "height": 900},
    ) as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async entry => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const placeholder = new Blob([new Uint8Array([0, 0, 0, 0])], {type: 'video/mp4'});
              await saveMediaBlob('video-layout-a', placeholder, {checkCapacity: false});
              await saveMediaBlob('video-layout-b', placeholder, {checkCapacity: false});
              await chrome.storage.local.clear();
              await chrome.storage.local.set({schemaVersion: 24, entries: [entry]});
            }""",
            entry,
        )

        library = session.open_page("library.html", wait_until="networkidle")
        expect(library.locator(".case-card")).to_have_count(1)
        expect(library.locator(".case-local-video-cover")).to_contain_text("本地视频 · MP4")
        expect(library.locator(".case-local-video-cover")).to_contain_text("浏览器无法预览，打开详情可用系统播放器")
        expect(library.locator(".case-video-link-cover")).to_have_count(0)
        library.locator(".case-card").click()
        expect(library.locator(".detail-visual-thumb")).to_have_count(2)
        library.locator(".detail-visual-thumb").nth(1).click()
        expect(library.locator(".detail-video")).to_be_visible()
        expect(library.get_by_role("button", name="设为主要媒体")).to_be_visible()
        expect(library.get_by_role("button", name="此媒体移入回收站")).to_be_visible()

        desktop = layout_snapshot(library)
        assert desktop["safetyBand"] >= 16, desktop
        assert desktop["captionTop"] >= desktop["videoBottom"], desktop
        assert desktop["labelFontSize"] == 11, desktop
        assert desktop["buttonHeights"] and min(desktop["buttonHeights"]) >= 36, desktop
        assert all(size == 12 for size in desktop["buttonFontSizes"]), desktop
        assert not desktop["buttonsOverlap"], desktop

        library.set_viewport_size({"width": 390, "height": 844})
        expect(library.locator(".detail-visual-caption")).to_be_visible()
        mobile = layout_snapshot(library)
        assert mobile["safetyBand"] >= 16, mobile
        assert mobile["captionTop"] >= mobile["videoBottom"], mobile
        assert mobile["buttonHeights"] and min(mobile["buttonHeights"]) >= 44, mobile
        assert not mobile["buttonsOverlap"], mobile
        assert mobile["galleryHeight"] < mobile["viewportHeight"] * 2, mobile

        print({
            "desktop": desktop,
            "mobile": mobile,
            "dangerActionSeparated": library.get_by_role("button", name="此媒体移入回收站").evaluate(
                "button => button.classList.contains('button-danger-secondary')"
            ),
        })


if __name__ == "__main__":
    main()
