from __future__ import annotations

import os
import base64
from pathlib import Path

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
        "byteSize": (Path(__file__).parent / "fixtures/detail-portrait-smoke.mp4").stat().st_size,
        "width": 180,
        "height": 320,
        "durationMs": 1_000,
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
    entry["videoAnalyses"] = [{
        "id": "current-reconstruction", "assetId": "video-layout-b", "mode": "visual-reconstruction",
        "requestId": "completed-attempt", "contractVersion": "visual-v3-1", "analysisScope": "visual",
        "includeTags": True, "finishReason": "stop",
        "reconstructionPrompt": "## 镜头\n主体向右移动，镜头保持稳定。\n<script>window.unsafeVideoOutput = true</script>", "tags": [{"g": "camera.motion", "t": "固定镜头"}],
        "uncertainties": ["遮挡区域无法确认"], "createdAt": "2026-08-08T00:01:00.000Z",
    }]

    with extension_session(
        "prompt-director-video-detail-layout-",
        viewport={"width": 1440, "height": 900},
    ) as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entry, encoded}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const video = new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], {type: 'video/mp4'});
              await saveMediaBlob('video-layout-a', video, {checkCapacity: false});
              await saveMediaBlob('video-layout-b', video, {checkCapacity: false});
              await chrome.storage.local.clear();
              await chrome.storage.local.set({schemaVersion: 24, entries: [entry]});
            }""",
            {"entry": entry, "encoded": base64.b64encode((Path(__file__).parent / "fixtures/detail-portrait-smoke.mp4").read_bytes()).decode()},
        )

        library = session.open_page("library.html", wait_until="networkidle")
        expect(library.locator(".case-card")).to_have_count(1)
        # Offline synthetic portrait fixture, generated with ffmpeg testsrc2.
        expect(library.locator(".case-video-link-cover")).to_have_count(0)
        library.locator(".case-card").click()
        expect(library.locator(".detail-visual-thumb")).to_have_count(2)
        library.locator(".detail-visual-thumb").nth(1).click()
        expect(library.locator(".detail-video")).to_be_visible()
        library.wait_for_function("() => {const v=document.querySelector('.detail-video');return v.readyState>=2 && v.videoHeight>v.videoWidth}")
        expect(library.get_by_role("button", name="设为主要")).to_be_visible()
        expect(library.get_by_role("button", name="此媒体移入回收站", exact=True)).to_be_visible()
        expect(library.get_by_role("button", name="逆推视频提示词", exact=True)).to_have_count(1)
        expect(library.locator('.detail-analysis-menu, .video-analysis-history')).to_have_count(0)
        result = library.locator('.video-reconstruction-current')
        expect(result.locator('.video-reconstruction-text h2')).to_have_text('镜头')
        expect(result.locator('.video-reconstruction-text script')).to_have_count(0)
        assert library.evaluate('window.unsafeVideoOutput !== true')
        expect(result.locator('textarea')).to_be_hidden()
        result.get_by_role('button', name='编辑 AI 逆推提示词', exact=True).click()
        result.locator('textarea').fill('已人工校正：主体向右移动，镜头保持稳定。')
        result.get_by_role('button', name='保存', exact=True).click()
        expect(result.locator('.video-reconstruction-text')).to_have_text('已人工校正：主体向右移动，镜头保持稳定。')
        expect(result.locator('textarea')).to_be_hidden()
        stored = library.evaluate("async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).entries[0]")
        assert stored['text'] == entry['text']
        assert len(stored['videoAnalyses']) == 1
        evidence_dir = os.environ.get('PROMPTDIRECTOR_LAB_EVIDENCE_DIR')
        if evidence_dir:
            Path(evidence_dir).mkdir(parents=True, exist_ok=True)
            library.screenshot(path=str(Path(evidence_dir) / 'video-detail-desktop.png'))

        desktop = layout_snapshot(library)
        assert desktop["safetyBand"] == 1, desktop
        assert desktop["captionTop"] >= desktop["videoBottom"], desktop
        assert desktop["labelFontSize"] == 11, desktop
        assert desktop["buttonHeights"] and min(desktop["buttonHeights"]) >= 36, desktop
        assert all(size == 12 for size in desktop["buttonFontSizes"]), desktop
        assert not desktop["buttonsOverlap"], desktop

        library.set_viewport_size({"width": 390, "height": 844})
        expect(library.locator(".detail-visual-caption")).to_be_visible()
        mobile = layout_snapshot(library)
        assert mobile["safetyBand"] == 1, mobile
        assert mobile["captionTop"] >= mobile["videoBottom"], mobile
        assert mobile["buttonHeights"] and min(mobile["buttonHeights"]) >= 44, mobile
        assert not mobile["buttonsOverlap"], mobile
        assert mobile["galleryHeight"] < mobile["viewportHeight"] * 2, mobile
        result.scroll_into_view_if_needed()
        assert library.evaluate('document.documentElement.scrollWidth <= innerWidth'), '390px 页面横向溢出'
        assert result.evaluate('(node) => node.scrollWidth <= node.clientWidth'), '390px 逆推结果横向溢出'
        if evidence_dir:
            library.screenshot(path=str(Path(evidence_dir) / 'video-detail-390.png'))

        print({
            "desktop": desktop,
            "mobile": mobile,
            "dangerActionSeparated": library.get_by_role("button", name="此媒体移入回收站").evaluate(
                "button => button.classList.contains('button-danger-secondary')"
            ),
        })
        # Keep damaged-file recovery coverage separate from playable geometry.
        broken = base_entry("broken-video-layout", "损坏视频回归", "", "content:prompt:video")
        broken["mediaAssets"] = [{"id": "broken-video-media", "kind": "video", "usage": "content", "storageMode": "managed", "mimeType": "video/mp4"}]
        broken["primaryMediaId"] = "broken-video-media"
        setup.evaluate("""async entry => {
          const {saveMediaBlob}=await import(chrome.runtime.getURL('media-store.js'));
          await saveMediaBlob(entry.primaryMediaId,new Blob([new Uint8Array([0,0,0,0])],{type:'video/mp4'}),{checkCapacity:false});
          const {entries}=await chrome.storage.local.get('entries');
          await chrome.storage.local.set({entries:[...entries,entry]});
        }""", broken)
        library.reload(wait_until="networkidle")
        damaged_card = library.locator('.case-card[data-entry-id="broken-video-layout"]')
        expect(damaged_card).to_contain_text("封面暂不可用，打开查看视频", timeout=35000)
        damaged_card.click()
        expect(library.locator('.media-playback-error')).to_be_visible()
        expect(library.locator('.detail-video')).to_be_hidden()
        print({"damagedVideoReportsFailure": True})


if __name__ == "__main__":
    main()
