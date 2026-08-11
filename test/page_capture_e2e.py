from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import extension_session


ARTICLE = b"""<!doctype html><html><head>
<title>Controllable capture fixture</title>
<meta property="og:title" content="Controllable capture fixture">
<meta name="author" content="Fixture Author">
</head><body>
<header><img class="site-logo" src="/logo.png" style="width:40px;height:40px"><button><img class="button-icon" src="/icon.png" style="width:24px;height:24px"></button></header>
<main><article>
<h1>Controllable capture fixture</h1>
<p>This article contains enough deliberate editorial text to exercise the real injected page capture path. The scanner must produce a preview before anything is stored, and the reader must remain in control of the article text and every media item.</p>
<p>A second paragraph makes the article boundary unambiguous while keeping navigation, logos, avatars, buttons and advertising outside the saved content.</p>
<img alt="Primary artwork" src="/hero.png" style="display:block;width:720px;height:480px">
<img alt="Secondary artwork" src="/secondary.png" style="display:block;width:640px;height:420px">
</article></main>
<aside aria-label="advertisement"><img class="advert" src="/ad.png" style="width:500px;height:300px"></aside>
</body></html>"""

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360f8cfc000000301010018dd8db10000000049454e44ae426082"
)


def main() -> None:
    with extension_session("prompt-director-page-capture-") as run:
        fixture_url = "https://api.deepseek.com/promptdirector-capture-fixture"
        run.context.route(
            "https://api.deepseek.com/**",
            lambda route: route.fulfill(
                status=200,
                body=ARTICLE if route.request.url == fixture_url else PNG,
                content_type="text/html; charset=utf-8" if route.request.url == fixture_url else "image/png",
            ),
        )
        collector = run.open_page("collector.html", wait_until="networkidle")
        run.seed_storage(collector, {"schemaVersion": 24, "entries": []})
        fixture = run.context.new_page()
        fixture.goto(fixture_url, wait_until="networkidle")
        fixture.bring_to_front()

        collector.evaluate("() => document.querySelector('#start-page-capture').click()")
        expect(collector.locator("#page-capture")).to_be_visible(timeout=8000)
        expect(collector.locator(".page-capture-item")).to_have_count(1)
        media_labels = collector.locator(".page-capture-media").all_text_contents()
        media_sources = collector.locator(".page-capture-media img").evaluate_all("nodes => nodes.map(node => node.src)")
        assert len(media_labels) == 2, {"labels": media_labels, "sources": media_sources}
        expect(collector.locator(".page-capture-component input:checked")).to_have_count(0)
        assert collector.evaluate("() => chrome.storage.local.get('entries').then(({entries}) => entries.length)") == 0
        expect(collector.locator("#page-capture-save")).to_be_disabled()

        collector.locator(".page-capture-text input").check()
        expect(collector.locator("#page-capture-save")).to_be_enabled()
        collector.locator(".page-capture-media input").first.check()
        collector.locator("#page-capture-clear").click()
        expect(collector.locator(".page-capture-component input:checked")).to_have_count(0)
        collector.locator("#page-capture-select-text").click()
        expect(collector.locator(".page-capture-text input")).to_be_checked()
        expect(collector.locator(".page-capture-media input:checked")).to_have_count(0)

        collector.locator("#page-capture-save").click()
        expect(collector.locator("#page-capture")).to_be_hidden(timeout=8000)
        saved = collector.evaluate("() => chrome.storage.local.get('entries').then(({entries}) => entries)")
        assert len(saved) == 1, saved
        assert "real injected page capture path" in saved[0]["text"], saved[0]
        assert not saved[0].get("mediaAssets"), saved[0]
        print({"previewCandidates": 1, "selectableImages": 2, "savedAfterConfirmation": 1})


if __name__ == "__main__":
    main()
