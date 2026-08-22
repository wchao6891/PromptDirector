from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import struct
import tempfile
import zipfile
import zlib
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BYTES = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
CATALOG_URL = "https://wchao6891.github.io/PromptDirector-Curated/catalog.json"
METRICS_URL = "https://wchao6891.github.io/PromptDirector-Curated/metrics.json"
COVER_URL = "https://wchao6891.github.io/PromptDirector-Curated/covers/workflow.png"
PREVIEW_URL = "https://wchao6891.github.io/PromptDirector-Curated/previews/workflow/preview.json"
PREVIEW_IMAGE_URL = "https://wchao6891.github.io/PromptDirector-Curated/previews/workflow/case.webp"
PORTRAIT_IMAGE_URL = "https://wchao6891.github.io/PromptDirector-Curated/previews/workflow/portrait.webp"
PACKAGE_URL = "https://github.com/wchao6891/PromptDirector-Curated/releases/download/workflow-1.0.0/workflow.zip"
PUBLIC_DEEP_LINK = "https://wchao6891.github.io/PromptDirector-Curated/?pack=feature%3Aworkflow"


def png_bytes(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    rows = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return signature + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def package_fixture() -> bytes:
    entry = base_entry("curated-workflow-case", "精选工作流案例", "统一层级并保留清晰主体。", "content:prompt:image")
    portrait = base_entry("curated-portrait-case", "竖版工作流案例", "保留竖版构图和主体比例。", "content:prompt:image")
    package = {
        "format": "prompt-case-library",
        "version": 3,
        "entries": [entry, portrait],
        "organizerState": {
            "version": 6,
            "collections": [{
                "id": "collection:curated-workflow",
                "name": "工作流主题",
                "order": 0,
                "entryIds": [entry["id"], portrait["id"]],
            }],
        },
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("library.json", json.dumps(package, ensure_ascii=False))
    return stream.getvalue()


def main() -> None:
    archive = package_fixture()
    item = {
        "id": "feature:workflow",
        "title": "工作流精选",
        "type": "image_prompt",
        "packageId": "workflow",
        "packageVersion": "1.0.0",
        "authorId": "author-editorial",
        "author": "PromptDirector 编辑精选",
        "license": "权利归原作者",
        "rightsStatus": "verified_authorized",
        "rightsReviewUrl": "https://wchao6891.github.io/PromptDirector-Curated/reviews/workflow.json",
        "updatedAt": "2026-08-08T00:00:00.000Z",
        "coverUrl": COVER_URL,
        "previewUrl": PREVIEW_URL,
        "downloadUrl": PACKAGE_URL,
        "sha256": hashlib.sha256(archive).hexdigest(),
        "archiveBytes": len(archive),
        "caseCount": 2,
        "imageCount": 0,
        "videoCount": 0,
        "summary": "目录摘要不应显示在详情中。",
        "order": 1,
    }
    catalog = {
        "format": "prompt-director-curated",
        "version": 2,
        "updatedAt": "2026-08-08T00:00:00.000Z",
        "themes": [item],
    }
    preview = {
        "format": "prompt-director-curated-preview",
        "version": 1,
        "catalogId": item["id"],
        "packageId": item["packageId"],
        "packageVersion": item["packageVersion"],
        "entries": [
            {
                "id": "curated-workflow-case",
                "title": "精选工作流案例",
                "text": "统一层级并保留清晰主体。",
                "author": "原作者",
                "rights": "权利归原作者",
                "sourceUrl": "https://example.com/workflow-case",
                "mediaKind": "image",
                "previewImageUrl": PREVIEW_IMAGE_URL,
                "width": 1200,
                "height": 900,
            },
            {
                "id": "curated-portrait-case",
                "title": "竖版工作流案例",
                "text": "保留竖版构图和主体比例。",
                "author": "竖版作者",
                "rights": "权利归原作者",
                "sourceUrl": "https://example.com/portrait-case",
                "mediaKind": "image",
                "previewImageUrl": PORTRAIT_IMAGE_URL,
                "width": 900,
                "height": 1350,
            },
        ],
    }
    metrics = {
        "format": "prompt-director-curated-metrics",
        "version": 1,
        "updatedAt": "2026-08-08T01:00:00.000Z",
        "downloads": {item["id"]: 7},
    }
    requests = {"catalog": 0, "fail": True}
    screenshots = Path(tempfile.gettempdir())

    with extension_session("prompt-director-curated-workflow-", viewport={"width": 1440, "height": 1000}) as session:
        def serve_catalog(route) -> None:
            requests["catalog"] += 1
            if requests["fail"]:
                route.fulfill(status=503, content_type="text/plain", body="temporary failure")
            else:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(catalog))

        session.context.route(CATALOG_URL, serve_catalog)
        session.context.route(METRICS_URL, lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(metrics)
        ))
        session.context.route(PREVIEW_URL, lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(preview)
        ))
        session.context.route(COVER_URL, lambda route: route.fulfill(
            status=200, content_type="image/png", body=PNG_BYTES
        ))
        session.context.route(PREVIEW_IMAGE_URL, lambda route: route.fulfill(
            status=200, content_type="image/png", body=png_bytes(1200, 900, (36, 52, 68))
        ))
        session.context.route(PORTRAIT_IMAGE_URL, lambda route: route.fulfill(
            status=200, content_type="image/png", body=png_bytes(900, 1350, (68, 52, 36))
        ))
        session.context.route(f"{PACKAGE_URL}*", lambda route: route.fulfill(
            status=200, content_type="application/zip", body=archive
        ))
        curated = session.open_page("curated.html", wait_until="domcontentloaded")
        expect(curated.locator("#curated-status")).to_contain_text("503")
        expect(curated.locator("#retry-catalog")).to_be_visible()
        requests["fail"] = False
        curated.locator("#retry-catalog").click()
        expect(curated.locator(".pack-grid .pack-card")).to_have_count(1)
        expect(curated.locator("#sort-downloads")).to_be_enabled()
        sort_style = curated.locator("#sort-menu").evaluate(
            """node => ({
              appearance: getComputedStyle(node).appearance,
              supported: CSS.supports('appearance: base-select'),
              background: getComputedStyle(node).backgroundColor
            })"""
        )
        assert sort_style["supported"] is True, sort_style
        assert sort_style["appearance"] == "base-select", sort_style
        assert sort_style["background"] not in {"rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"}, sort_style
        curated.locator("#sort-menu").select_option("latest")
        expect(curated.locator("#sort-menu")).to_have_value("latest")
        expect(curated.locator("#filter-popover")).to_be_hidden()
        expect(curated.locator(".pack-card h2")).to_have_text("工作流精选")
        expect(curated.locator(".pack-card .pack-meta")).to_contain_text("PromptDirector 编辑精选")
        curated.screenshot(path=str(screenshots / "promptdirector-curated-pack-wall.png"), full_page=True)

        curated.locator(".pack-card").click()
        expect(curated.locator("#detail-dialog")).to_be_visible()
        expect(curated.locator(".detail-info h1")).to_have_text("工作流精选")
        expect(curated.locator(".detail-meta")).to_contain_text("2 个案例")
        expect(curated.locator(".detail-actions button")).to_have_count(3)
        expect(curated.locator(".download-action")).to_have_text("保存整包")
        expect(curated.locator(".follow-action")).to_have_text("关注")
        expect(curated.locator(".detail-actions button").nth(2)).to_have_text("复制链接")
        expect(curated.locator(".case-list .case-card")).to_have_count(2)
        expect(curated.locator(".case-card h3, .case-card .case-copy, .case-actions")).to_have_count(0)
        geometry = curated.locator(".case-card").evaluate_all(
            "cards => cards.map(card => ({width: card.offsetWidth, height: card.offsetHeight}))"
        )
        assert geometry[0]["height"] < geometry[1]["height"], geometry
        expect(curated.locator("text=目录摘要不应显示在详情中。")).to_have_count(0)
        expect(curated.locator("text=版本")).to_have_count(0)
        expect(curated.locator("text=更新日期")).to_have_count(0)
        expect(curated.locator("text=以此创作")).to_have_count(0)

        before_follow = curated.evaluate("""() => {
          document.querySelector('.case-card').dataset.renderIdentity = 'kept';
          document.querySelector('#detail-dialog').scrollTop = 120;
          return document.querySelector('#detail-dialog').scrollTop;
        }""")
        curated.locator(".follow-action").click()
        expect(curated.locator(".follow-action")).to_have_text("已关注")
        assert curated.locator('.case-card[data-render-identity="kept"]').count() == 1
        assert curated.locator("#detail-dialog").evaluate("dialog => dialog.scrollTop") == before_follow
        following = curated.evaluate("async () => (await chrome.storage.local.get('curatedFollowingAuthors')).curatedFollowingAuthors")
        assert following == ["author-editorial"], following

        curated.locator(".detail-actions button").nth(2).click()
        copied_link = curated.evaluate("() => navigator.clipboard.readText()")
        assert copied_link == PUBLIC_DEEP_LINK, copied_link

        curated.locator(".case-card").first.click()
        expect(curated.locator("#case-detail-drawer")).to_have_class("case-detail-drawer open")
        expect(curated.locator(".case-detail-heading h2")).to_have_text("精选工作流案例")
        expect(curated.locator(".case-detail-heading p")).to_have_text("原作者")
        expect(curated.locator(".case-detail-prompt")).to_have_text("统一层级并保留清晰主体。")
        expect(curated.locator(".case-detail-source a")).to_have_attribute("href", "https://example.com/workflow-case")
        assert curated.locator("#detail-content").get_attribute("inert") == ""
        assert curated.locator("#detail-close").get_attribute("inert") == ""
        landscape = curated.locator(".case-detail-figure img").evaluate(
            "img => ({natural: img.naturalWidth / img.naturalHeight, rendered: img.getBoundingClientRect().width / img.getBoundingClientRect().height})"
        )
        assert abs(landscape["natural"] - 4 / 3) < 0.01, landscape
        assert abs(landscape["rendered"] - landscape["natural"]) < 0.01, landscape

        curated.locator("#case-detail-next").click()
        expect(curated.locator(".case-detail-heading h2")).to_have_text("竖版工作流案例")
        curated.wait_for_function(
            """() => {
              const image = document.querySelector('.case-detail-figure img');
              return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
            }"""
        )
        portrait = curated.locator(".case-detail-figure img").evaluate(
            "img => ({natural: img.naturalWidth / img.naturalHeight, rendered: img.getBoundingClientRect().width / img.getBoundingClientRect().height})"
        )
        assert abs(portrait["natural"] - 2 / 3) < 0.01, portrait
        assert abs(portrait["rendered"] - portrait["natural"]) < 0.01, portrait
        curated.locator("#case-detail-prev").click()

        curated.locator(".case-detail-actions .button-secondary").click()
        copied_prompt = curated.evaluate("() => navigator.clipboard.readText()")
        assert copied_prompt == "统一层级并保留清晰主体。", copied_prompt
        expect(curated.locator(".case-detail-actions .button-secondary")).to_have_text("已复制")

        curated.locator(".case-save-action").click()
        expect(curated).to_have_url(re.compile(r"/library\.html(?:\?.*)?$"))
        expect(curated.locator("#detail-drawer")).to_have_class(re.compile(r"\bopen\b"))
        state = curated.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert len(state["entries"]) == 1, state
        source_key = curated.evaluate(
            """async (entry) => {
              const {curatedSourceKey} = await import(chrome.runtime.getURL('curated-catalog.js'));
              return curatedSourceKey(entry);
            }""",
            state["entries"][0],
        )
        assert source_key == "workflow:curated-workflow-case", source_key

        curated.screenshot(path=str(screenshots / "promptdirector-curated-case-detail.png"), full_page=False)
        curated.evaluate("location.assign(chrome.runtime.getURL('curated.html'))")
        expect(curated.locator(".pack-card")).to_have_count(1)
        curated.locator(".pack-card").click()
        curated.locator(".download-action").click()
        expect(curated.locator("#pack-save-dialog")).to_be_visible()
        expect(curated.locator(".pack-save-meta")).to_contain_text("2 个案例")
        curated.locator(".pack-save-confirm").click()
        expect(curated).to_have_url(re.compile(r"/library\.html(?:\?.*)?$"))
        expect(curated.locator('.project-filter[aria-label^="工作流精选 "]')).to_have_attribute("aria-pressed", "true")
        state = curated.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert len(state["entries"]) == 2, state
        assert state["organizerState"]["collections"][0]["id"] == "curated-project:workflow", state
        curated.evaluate("location.assign(chrome.runtime.getURL('curated.html'))")
        expect(curated.locator(".pack-card")).to_have_count(1)
        curated.locator(".pack-card").click()
        curated.screenshot(path=str(screenshots / "promptdirector-curated-pack-detail.png"), full_page=False)
        curated.keyboard.press("Escape")
        expect(curated.locator("#detail-dialog")).not_to_be_visible()
        expect(curated.locator(".pack-card")).to_be_focused()

        curated.locator("#curated-search").fill("清晰主体")
        expect(curated.locator(".pack-card")).to_have_count(1)
        curated.locator("#filter-button").click()
        curated.locator('#filter-popover input[value="followed"]').check()
        expect(curated.locator(".pack-card")).to_have_count(1)

        curated.set_viewport_size({"width": 820, "height": 650})
        curated.locator(".pack-card").click()
        medium_geometry = curated.evaluate(
            """() => ({viewport: innerWidth, page: document.documentElement.scrollWidth,
              info: document.querySelector('.detail-info').getBoundingClientRect().width})"""
        )
        assert medium_geometry["page"] <= medium_geometry["viewport"], medium_geometry
        assert 360 <= medium_geometry["info"] <= 450, medium_geometry
        curated.keyboard.press("Escape")

        curated.set_viewport_size({"width": 390, "height": 844})
        curated.locator(".pack-card").click()
        expect(curated.locator(".detail-info")).to_be_visible()
        geometry = curated.evaluate(
            """() => ({viewport: innerWidth, page: document.documentElement.scrollWidth,
              detail: document.querySelector('.detail-surface').getBoundingClientRect().right})"""
        )
        assert geometry["page"] <= geometry["viewport"], geometry
        assert geometry["detail"] <= geometry["viewport"] + 1, geometry
        curated.screenshot(path=str(screenshots / "promptdirector-curated-mobile.png"), full_page=False)

        curated.keyboard.press("Escape")
        curated.evaluate("""async () => {
          await chrome.storage.local.set({uiPreferences: {locale: 'en', theme: 'dark', motion: 'reduced'}});
          localStorage.setItem('promptDirectorTheme', 'dark');
          localStorage.setItem('promptDirectorMotion', 'reduced');
        }""")
        curated.reload(wait_until="networkidle")
        expect(curated.locator(".curated-header h1")).to_have_text("Curated cases")
        expect(curated.locator("#curated-search")).to_have_attribute("placeholder", "Search packs or cases")
        expect(curated.locator("#return-library")).to_have_text("Back to library")

        print({
            "catalog_retry": requests["catalog"],
            "pack_detail": True,
            "single_save": True,
            "verified_pack_save": True,
            "follow_local": following,
            "copy_deep_link": copied_link,
            "medium": medium_geometry,
            "mobile": geometry,
            "english_ui": True,
        })


if __name__ == "__main__":
    main()
