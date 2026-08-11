from __future__ import annotations

from playwright.sync_api import expect

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
            if provider == "youtube":
                card = library.locator(".platform-playback-fallback")
                expect(card).to_be_visible()
                expect(card).to_contain_text("授权并在案例库播放")
                source = card.locator("a", has_text="打开来源")
                expect(source).to_have_attribute("href", url)
                results.append({"provider": provider, "state": "permission-required"})
            else:
                frame = library.locator(".referenced-video-embed iframe")
                expect(frame).to_be_visible()
                source = frame.get_attribute("src") or ""
                if provider == "bilibili":
                    assert source.startswith("https://player.bilibili.com/player.html?") and "bvid=BV1abc" in source, source
                elif provider == "douyin":
                    assert source.startswith("https://open.douyin.com/player/video?vid=123"), source
                else:
                    assert source == "https://platform.twitter.com/embed/Tweet.html?id=123&dnt=true", source
                expect(library.locator(".media-reference-fallback")).to_have_attribute("target", "_blank")
                results.append({"provider": provider, "state": "official-embed"})
            library.locator("#detail-close").click()
            expect(library.locator("#detail-drawer")).not_to_be_visible()

        print({"mediaPlaybackStates": results, "downloadedVideoFiles": False})


if __name__ == "__main__":
    main()
