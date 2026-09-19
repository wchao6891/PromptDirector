from __future__ import annotations

from playwright.sync_api import expect
from pathlib import Path
import os

from e2e_support import base_entry, extension_session


FIXTURES = [
    ("youtube", "YouTube", "https://www.youtube.com/watch?v=abc123"),
    ("bilibili", "Bilibili", "https://www.bilibili.com/video/BV1abc"),
    ("douyin", "抖音", "https://www.douyin.com/video/123"),
    ("x", "X", "https://x.com/director/status/123"),
]


def main() -> None:
    entries = []
    for index, (provider, label, url) in enumerate(FIXTURES):
        entry = base_entry(f"reference:{provider}", f"{label} 引用", "", "content:video", index)
        entry["mediaAssets"] = [{
            "id": f"asset:{provider}",
            "kind": "video",
            "usage": "content",
            "storageMode": "reference",
            "sourceUrl": url,
            "sourceTitle": f"{label} 引用",
            "reference": {
                "url": url,
                "provider": provider,
                "playbackMode": "source",
                "metadataStatus": "partial",
            },
            "playbackCapability": "external",
            "reviewStatus": "verified",
        }]
        entry["primaryMediaId"] = f"asset:{provider}"
        entries.append(entry)

    with extension_session("prompt-director-media-reference-cards-", viewport={"width": 1280, "height": 900}) as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {"schemaVersion": 24, "entries": entries})
        library = run.open_page("library.html", wait_until="networkidle")
        expect(library.locator(".case-card")).to_have_count(len(entries))

        results = []
        for provider, label, url in FIXTURES:
            library.locator(f'.case-card[data-entry-id="reference:{provider}"]').click()
            if provider in ["youtube", "x"]:
                card = library.locator(".platform-playback-fallback")
                expect(card).to_be_visible()
                expect(card.locator(".unavailable-video-stage")).to_be_visible()
                expect(library.locator(".referenced-video-embed iframe")).to_have_count(0)
                expect(card).to_contain_text("授权并在案例库播放" if provider == "youtube" else "暂未取得可在案例库播放的视频")
                source = library.locator(".detail-visual-caption .media-reference-fallback")
                expect(source).to_have_attribute("href", url)
                results.append({"provider": provider, "state": "permission-required" if provider == "youtube" else "video-unavailable"})
            else:
                frame = library.locator(".referenced-video-embed iframe")
                expect(frame).to_be_visible()
                source = frame.get_attribute("src") or ""
                if provider == "bilibili":
                    assert source.startswith("https://player.bilibili.com/player.html?") and "bvid=BV1abc" in source, source
                elif provider == "douyin":
                    assert source.startswith("https://open.douyin.com/player/video?vid=123"), source
                expect(library.locator(".media-reference-fallback")).to_have_attribute("target", "_blank")
                results.append({"provider": provider, "state": "official-embed"})
            library.locator("#detail-close").click()
            expect(library.locator("#detail-drawer")).not_to_be_visible()

        # Exercise the permission transition without a native permission dialog.
        library.evaluate("""() => {
          window.playbackGranted = false;
          window.playbackSetupFails = false;
          chrome.permissions.contains = async () => window.playbackGranted;
          chrome.permissions.request = async () => { window.playbackGranted = true; return true; };
          chrome.declarativeNetRequest = { updateSessionRules: async () => {
            if (window.playbackSetupFails) throw new Error('simulated player rule failure');
          }};
        }""")
        youtube = library.locator('.case-card[data-entry-id="reference:youtube"]')
        youtube.click()
        library.get_by_role("button", name="授权并在案例库播放", exact=True).click()
        expect(library.locator(".referenced-video-embed iframe")).to_be_visible()
        expect(library.locator(".detail-title")).to_have_text("YouTube 引用")
        expect(library.locator(".detail-video-wrap .media-reference-fallback")).to_have_count(0)
        expect(library.locator(".detail-visual-caption .media-reference-fallback")).to_be_visible()
        library.locator("#detail-close").click()
        library.evaluate("window.playbackSetupFails = true")
        youtube.click()
        expect(library.locator(".detail-title")).to_have_text("YouTube 引用")
        expect(library.locator(".platform-playback-fallback")).to_be_visible()
        library.evaluate("window.playbackSetupFails = false")
        library.get_by_role("button", name="重试", exact=True).click()
        expect(library.locator(".referenced-video-embed iframe")).to_be_visible()
        library.locator("#detail-close").click()
        youtube.click()
        expect(library.locator(".referenced-video-embed iframe")).to_be_visible()
        expect(library.locator(".detail-title")).to_have_text("YouTube 引用")
        output = Path(os.environ.get("PD_TEST_SCREENSHOTS", "/tmp/pd-b13-player"))
        output.mkdir(parents=True, exist_ok=True)
        for theme in ["dark", "light"]:
            library.evaluate("theme => document.documentElement.dataset.theme = theme", theme)
            for width in [1280, 390]:
                library.set_viewport_size({"width": width, "height": 900})
                library.screenshot(path=str(output / f"player-{theme}-{width}.png"), animations="disabled")
                assert library.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not run.page_errors, run.page_errors
        print({"mediaPlaybackStates": results, "permissionTransition": True,
               "setupFailureKeepsDetail": True, "retryAndReopen": True, "downloadedVideoFiles": False})


if __name__ == "__main__":
    main()
