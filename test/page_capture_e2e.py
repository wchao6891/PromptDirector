from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import extension_session


ARTICLE = b"""<!doctype html><html><head>
<title>Controllable capture fixture</title>
<meta property="og:title" content="Controllable capture fixture">
<meta name="author" content="Fixture Author">
<script type="application/ld+json">{"@type":"Article","headline":"Controllable capture fixture","image":{"contentUrl":"/asset-area-preview.png","width":1200,"height":800}}</script>
</head><body>
<header><img class="site-logo" src="/logo.png" style="width:40px;height:40px"><button><img class="button-icon" src="/icon.png" style="width:24px;height:24px"></button></header>
<main><article>
<h1>Controllable capture fixture</h1>
<p>This article contains enough deliberate editorial text to exercise the real injected page capture path. The scanner must produce a preview before anything is stored, and the reader must remain in control of the article text and every media item.</p>
<p>A second paragraph includes <a href="/evidence">evidence</a> and makes the article boundary unambiguous while keeping navigation, logos, avatars, buttons and advertising outside the saved content.</p>
<picture><source media="(min-width: 1px)" srcset="/hero-picture-800.png 800w, /hero-picture-2000.png 2000w" sizes="400px">
<img alt="Primary artwork" src="/hero-400.png" srcset="/hero-400.png 400w, /hero-1600.png 1600w" sizes="400px" style="display:block;width:720px;height:480px"></picture>
<img alt="Secondary artwork" src="/secondary-640.png" srcset="/secondary-640.png 640w, /secondary-1280.png 1280w" sizes="400px" style="display:block;width:640px;height:420px">
<img alt="Deferred artwork" src="/placeholder.png" data-src="/deferred-original.png" style="display:block;width:600px;height:400px">
<img alt="Animated process" src="/animation.gif" style="display:block;width:480px;height:320px">
<video aria-label="Process film" controls poster="/video-poster.png" src="/film.mp4" style="display:block;width:640px;height:360px"></video>
<iframe src="/ordinary-resource-frame" title="Not a video"></iframe>
</article></main>
<section id="appendix"><h2>Production appendix</h2><p>This deliberately separate appendix contains the downloadable production notes that the reader may choose to add to the captured article.</p><a download href="/production-brief.pdf">Production brief PDF</a><a download href="/unsafe-package.zip">Packaged Skill archive</a></section>
<aside aria-label="advertisement"><img class="advert" src="/ad.png" style="width:500px;height:300px"></aside>
</body></html>"""

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360f8cfc000000301010018dd8db10000000049454e44ae426082"
)

GIF = bytes.fromhex(
    "47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b"
)

PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"
FIXTURE_ORIGIN = "https://wchao6891.github.io"


def list_page(page: int) -> bytes:
    first = 1 if page == 1 else 3
    cards = "".join(
        f'''<div class="work-card"><a href="/work/{index}"><h2>List Work {index}</h2></a>
        <h3>Prompt</h3><p>Creative prompt for list work {index}.</p>
        <img alt="List artwork {index}" src="/list-image-{index}.png" style="display:block;width:320px;height:320px"></div>'''
        for index in range(first, first + 2)
    )
    next_link = '<a rel="next" href="/promptdirector-list?page=2">Next</a>' if page == 1 else ""
    return f"<!doctype html><html><head><title>Prompt list</title></head><body><main>{cards}</main><nav aria-label=\"pagination\">{next_link}</nav></body></html>".encode()


def main() -> None:
    with extension_session("prompt-director-page-capture-") as run:
        fixture_url = f"{FIXTURE_ORIGIN}/promptdirector-capture-fixture"
        def route_fixture(route) -> None:
            request_url = route.request.url
            if request_url.endswith("/deferred-original.png"):
                route.fulfill(status=403, body=b"expired", content_type="text/plain")
                return
            if request_url.endswith("/animation.gif"):
                route.fulfill(status=200, body=GIF, content_type="image/gif")
                return
            if request_url.endswith("/production-brief.pdf"):
                route.fulfill(status=200, body=PDF, content_type="application/pdf")
                return
            if request_url.endswith("/unsafe-package.zip"):
                route.fulfill(status=200, body=b"PK\x03\x04unsafe", content_type="application/zip")
                return
            if "/promptdirector-list" in request_url:
                route.fulfill(status=200, body=list_page(2 if "page=2" in request_url else 1), content_type="text/html; charset=utf-8")
                return
            route.fulfill(
                status=200,
                body=ARTICLE if request_url == fixture_url else PNG,
                content_type="text/html; charset=utf-8" if request_url == fixture_url else "image/png",
            )

        run.context.route(f"{FIXTURE_ORIGIN}/**", route_fixture)
        collector = run.open_page("collector.html", wait_until="networkidle")
        run.seed_storage(collector, {
            "schemaVersion": 24,
            "entries": [],
            "capturePermissionOnboarding": {
                "version": 1,
                "acknowledgedAt": "2026-08-22T00:00:00.000Z",
                "clipboardIncluded": True,
            },
        })
        fixture = run.context.new_page()
        fixture.goto(fixture_url, wait_until="networkidle")
        fixture.bring_to_front()

        collector.evaluate("() => document.querySelector('#start-page-capture').click()")
        expect(collector.locator("#page-capture")).to_be_visible(timeout=8000)
        expect(collector.locator(".page-capture-item")).to_have_count(2)
        media_labels = collector.locator(".page-capture-article-media").all_text_contents()
        media_sources = collector.locator(".page-capture-article-media img").evaluate_all("nodes => nodes.map(node => node.src)")
        assert len(media_labels) == 5, {"labels": media_labels, "sources": media_sources}
        assert media_sources[0].endswith("/hero-picture-2000.png"), {"labels": media_labels, "sources": media_sources}
        assert "候选 2000px" in media_labels[0] and "picture 响应图" in media_labels[0], media_labels
        assert media_sources[1].endswith("/secondary-1280.png"), {"labels": media_labels, "sources": media_sources}
        assert "候选 1280px" in media_labels[1], media_labels
        assert "延迟加载原图" in media_labels[2], media_labels
        expect(collector.locator(".page-capture-article-media").nth(2).locator(".page-capture-media-preview")).to_contain_text("预览不可用")
        assert any(source.endswith("/animation.gif") for source in media_sources), media_sources
        assert "视频引用" in " ".join(media_labels), media_labels
        assert not any(source.endswith("/video-poster.png") for source in media_sources[:-1]), media_sources
        expect(collector.locator(".page-capture-item.confirmed")).to_have_count(0)
        assert collector.evaluate("() => chrome.storage.local.get('entries').then(({entries}) => entries.length)") == 0
        expect(collector.locator("#page-capture-save")).to_be_disabled()

        collector.locator(".page-capture-article-media").first.click()
        expect(collector.locator("#page-capture-media-viewer")).to_be_visible()
        expect(collector.locator("#page-capture-media-stage img")).to_be_visible()
        expect(collector.locator("#page-capture-media-position")).to_have_text("媒体 2 / 6")
        collector.locator("#page-capture-media-next").click()
        expect(collector.locator("#page-capture-media-position")).to_have_text("媒体 3 / 6")
        collector.locator("#page-capture-media-close").click()

        collector.locator(".page-capture-inspect").first.click()
        expect(fixture.locator("#promptdirector-page-capture-region-preview")).to_be_visible(timeout=8000)
        collector.locator(".page-capture-confirm").first.click()
        expect(collector.locator(".page-capture-item.confirmed")).to_have_count(1)
        expect(collector.locator("#page-capture-media-review")).to_be_visible()
        expect(collector.locator("#page-capture-media-review-list .page-capture-media-review-item")).to_have_count(6)
        expect(collector.locator(".page-capture-media-review-group")).to_contain_text("可能遗漏媒体（1）")
        expect(collector.locator("#page-capture-save")).to_have_text("保存案例 · 含 5 项媒体")
        expect(collector.locator("#page-capture-save")).to_be_enabled()
        collector.locator("#page-capture-add-region").click()
        fixture.bring_to_front()
        expect(fixture.locator("#promptdirector-page-capture-region-editor")).to_be_visible(timeout=8000)
        fixture.locator("#appendix").evaluate("element => element.click()")
        fixture.get_by_role("button", name="完成").click()
        confirmed_article = collector.locator(".page-capture-item.confirmed .page-capture-article")
        expect(confirmed_article).to_contain_text("downloadable production notes", timeout=8000)
        collector.locator("#page-capture-exclude-region").click()
        fixture.bring_to_front()
        fixture.locator("article p").nth(1).click()
        fixture.get_by_role("button", name="完成").click()
        expect(confirmed_article).not_to_contain_text("A second paragraph", timeout=8000)
        collector.locator("#page-capture-undo-region").click()
        expect(confirmed_article).to_contain_text("A second paragraph")
        collector.locator("#page-capture-exclude-region").click()
        fixture.bring_to_front()
        fixture.locator("article p").nth(1).click()
        fixture.get_by_role("button", name="完成").click()
        expect(confirmed_article).not_to_contain_text("A second paragraph", timeout=8000)
        expect(collector.locator("#page-capture-media-review-list .page-capture-media-review-item")).to_have_count(7)
        expect(collector.locator("#page-capture-save")).to_have_text("保存案例 · 含 6 项媒体")
        expect(collector.locator("#page-capture-save")).to_be_enabled()
        collector.locator("#page-capture-save").click()
        expect(collector.locator("#page-capture")).to_be_hidden(timeout=8000)
        expect(fixture.locator("#promptdirector-page-capture-region-preview")).to_have_count(0)
        expect(fixture.locator("[data-promptdirector-capture-region]")).to_have_count(0)
        media_saved = collector.evaluate("() => chrome.storage.local.get('entries').then(({entries}) => entries)")
        assert len(media_saved) == 1 and len(media_saved[0].get("mediaAssets", [])) == 6, media_saved
        assert "real injected page capture path" in media_saved[0]["text"], media_saved[0]
        assert "A second paragraph" not in media_saved[0]["text"], media_saved[0]
        assert "downloadable production notes" in media_saved[0]["text"], media_saved[0]
        block_kinds = [block["kind"] for block in media_saved[0]["articleDocument"]["blocks"]]
        assert block_kinds.count("image") == 4, media_saved[0]
        assert block_kinds.count("video") == 1, media_saved[0]
        assert block_kinds.count("document") == 1, media_saved[0]
        assert block_kinds.count("link") == 1, media_saved[0]
        assert any(asset["sourceUrl"].endswith("/placeholder.png") for asset in media_saved[0]["mediaAssets"]), media_saved[0]
        assert any(asset.get("mimeType") == "image/gif" and asset["sourceUrl"].endswith("/animation.gif") for asset in media_saved[0]["mediaAssets"]), media_saved[0]
        assert any(asset.get("kind") == "video" and asset["sourceUrl"].endswith("/film.mp4") for asset in media_saved[0]["mediaAssets"]), media_saved[0]
        assert any(asset.get("kind") == "document" and asset.get("mimeType") == "application/pdf" for asset in media_saved[0]["mediaAssets"]), media_saved[0]
        assert not any(asset.get("sourceUrl", "").endswith("/unsafe-package.zip") for asset in media_saved[0]["mediaAssets"]), media_saved[0]
        assert media_saved[0]["sourceFacts"]["captureScope"] == "document", media_saved[0]
        assert media_saved[0]["sourceFacts"]["extractionMethod"] == "page", media_saved[0]
        library = run.open_page("library.html", wait_until="networkidle")
        expect(library.locator(".case-card")).to_have_count(1, timeout=8000)
        library.locator(".case-card").click()
        expect(library.locator(".article-document-reader")).to_be_visible(timeout=8000)
        expect(library.locator(".article-document-reader")).to_contain_text("downloadable production notes")
        expect(library.locator(".article-document-reader")).not_to_contain_text("A second paragraph")
        expect(library.locator(".article-document-reader .article-document-image")).to_have_count(4)
        expect(library.locator(".unplaced-media-section")).to_have_count(0)
        expect(library.get_by_text("单独查看文章媒体")).to_have_count(0)
        expect(library.locator(".article-document-reader")).to_contain_text("本地副本已保存在案例媒体中")
        expect(library.locator(".article-document-reader")).to_contain_text("Packaged Skill archive")
        library.close()

        collector.evaluate("() => chrome.storage.local.set({entries: []})")
        fixture.evaluate("""() => {
            const paragraph = document.querySelector('article p');
            const range = document.createRange();
            range.selectNodeContents(paragraph);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }""")
        fixture.bring_to_front()
        collector.evaluate("() => document.querySelector('#start-page-capture').click()")
        expect(collector.locator("#page-capture")).to_be_visible(timeout=8000)
        expect(collector.locator(".page-capture-item > header small")).to_contain_text("原网页选区")
        expect(collector.locator(".page-capture-article p")).to_have_count(1)
        collector.locator(".page-capture-confirm").click()
        expect(collector.locator("#page-capture-save")).to_have_text("只保存正文")
        collector.locator("#page-capture-save").click()
        expect(collector.locator("#page-capture")).to_be_hidden(timeout=8000)
        selected_saved = collector.evaluate("() => chrome.storage.local.get('entries').then(({entries}) => entries)")
        assert len(selected_saved) == 1, selected_saved
        assert "real injected page capture path" in selected_saved[0]["text"], selected_saved[0]
        assert "A second paragraph" not in selected_saved[0]["text"], selected_saved[0]
        assert len(selected_saved[0].get("mediaAssets", [])) == 0, selected_saved[0]
        assert selected_saved[0]["sourceFacts"]["captureScope"] == "selection", selected_saved[0]

        collector.evaluate("() => chrome.storage.local.set({entries: []})")
        list_url = f"{FIXTURE_ORIGIN}/promptdirector-list?page=1"
        fixture.goto(list_url, wait_until="networkidle")
        fixture.bring_to_front()
        collector.evaluate("() => document.querySelector('#start-page-capture').click()")
        expect(collector.locator("#page-capture")).to_be_visible(timeout=8000)
        expect(collector.locator(".page-capture-item")).to_have_count(2)
        collector.locator(".page-capture-confirm").first.click()
        collector.locator("#page-capture-scan").click()
        collector.locator("#page-capture-target-count").fill("3")
        collector.locator("#page-capture-list-run").click()
        expect(collector.locator("#page-capture-list-result")).to_be_visible(timeout=15000)
        expect(collector.locator(".page-capture-item")).to_have_count(3)
        expect(collector.locator(".page-capture-item.confirmed")).to_have_count(3)
        expect(collector.locator("#page-capture-save")).to_be_disabled()
        collector.locator("#page-capture-save-mode").select_option("multiple")
        expect(collector.locator("#page-capture-save")).to_be_enabled()
        collector.locator("#page-capture-save").click()
        expect(collector.locator("#page-capture")).to_be_hidden(timeout=10000)
        multiple_saved = collector.evaluate("() => chrome.storage.local.get('entries').then(({entries}) => entries)")
        assert len(multiple_saved) == 3, multiple_saved
        assert fixture.url == list_url, fixture.url

        collector.evaluate("() => chrome.storage.local.set({entries: []})")
        fixture.bring_to_front()
        collector.evaluate("() => document.querySelector('#start-page-capture').click()")
        expect(collector.locator(".page-capture-item")).to_have_count(2)
        collector.locator(".page-capture-confirm").first.click()
        collector.locator("#page-capture-scan").click()
        collector.locator("#page-capture-target-count").fill("3")
        collector.locator("#page-capture-list-run").click()
        expect(collector.locator("#page-capture-list-result")).to_be_visible(timeout=15000)
        collector.locator("#page-capture-save-mode").select_option("combined")
        collector.locator("#page-capture-combined-title").fill("Combined list inspiration")
        collector.locator("#page-capture-combined-title").press("Tab")
        collector.locator("#page-capture-save").click()
        expect(collector.locator("#page-capture")).to_be_hidden(timeout=10000)
        combined_saved = collector.evaluate("() => chrome.storage.local.get('entries').then(({entries}) => entries)")
        assert len(combined_saved) == 1, combined_saved
        assert combined_saved[0]["title"] == "Combined list inspiration", combined_saved[0]
        assert len(combined_saved[0].get("mediaAssets", [])) == 3, combined_saved[0]
        assert {asset.get("originalWorkUrl") for asset in combined_saved[0]["mediaAssets"]} == {
            f"{FIXTURE_ORIGIN}/work/1", f"{FIXTURE_ORIGIN}/work/2", f"{FIXTURE_ORIGIN}/work/3"
        }, combined_saved[0]
        print({"previewCandidates": 2, "mediaViewerItems": 5, "confirmedSubjects": 1, "savedWholeCaseMedia": 6, "savedLiveSelectionMedia": 0, "paginatedCases": 3, "combinedCases": 1, "clearedPageMarkers": 1})


if __name__ == "__main__":
    main()
