from __future__ import annotations

import base64
import hashlib
import io
import json
import tempfile
import zipfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
CATALOG_URL = "https://wchao6891.github.io/PromptDirector-Curated/catalog.json"
COVER_URL = "https://wchao6891.github.io/PromptDirector-Curated/covers/workflow.png"
PACKAGE_URL = "https://github.com/wchao6891/PromptDirector-Curated/releases/download/workflow-1.0.0/workflow.zip"


def package_fixture() -> bytes:
    entry = base_entry("curated-workflow-case", "精选工作流案例", "统一层级并保留清晰主体。", "content:prompt:image")
    package = {
        "format": "prompt-case-library",
        "version": 2,
        "entries": [entry],
        "organizerState": {
            "version": 6,
            "collections": [{
                "id": "collection:curated-workflow",
                "name": "工作流主题",
                "order": 0,
                "entryIds": [entry["id"]],
            }],
        },
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("library.json", json.dumps(package, ensure_ascii=False))
    return stream.getvalue()


def main() -> None:
    archive = package_fixture()
    catalog = {
        "format": "prompt-director-curated",
        "version": 2,
        "updatedAt": "2026-08-08T00:00:00.000Z",
        "themes": [{
            "id": "feature:workflow",
            "title": "工作流精选",
            "type": "image_prompt",
            "packageId": "workflow",
            "packageVersion": "1.0.0",
            "author": "PromptDirector Editorial",
            "license": "CC BY 4.0",
            "updatedAt": "2026-08-08T00:00:00.000Z",
            "coverUrl": COVER_URL,
            "downloadUrl": PACKAGE_URL,
            "sha256": hashlib.sha256(archive).hexdigest(),
            "caseCount": 1,
            "imageCount": 0,
            "summary": "用于验证自动更新与批量保存。",
            "order": 1,
        }],
    }
    requests = {"catalog": 0, "fail": True}
    screenshots = Path(tempfile.gettempdir())

    with extension_session("prompt-director-curated-workflow-", viewport={"width": 1440, "height": 900}) as session:
        def serve_catalog(route) -> None:
            requests["catalog"] += 1
            if requests["fail"]:
                route.fulfill(status=503, content_type="text/plain", body="temporary failure")
            else:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(catalog))

        session.context.route(CATALOG_URL, serve_catalog)
        session.context.route(COVER_URL, lambda route: route.fulfill(
            status=200,
            content_type="image/png",
            body=base64.b64decode(PNG_BASE64),
        ))
        session.context.route(f"{PACKAGE_URL}*", lambda route: route.fulfill(
            status=200,
            content_type="application/zip",
            body=archive,
        ))
        session.context.add_init_script(
            """(() => {
              if (!globalThis.chrome?.permissions) return;
              Object.defineProperty(chrome.permissions, 'contains', {value: async () => true});
              Object.defineProperty(chrome.permissions, 'request', {value: async () => true});
            })()"""
        )

        curated = session.open_page("curated.html", wait_until="domcontentloaded")
        expect(curated.locator("#curated-search, #refresh-catalog")).to_have_count(0)
        expect(curated.locator("#curated-status")).to_contain_text("503")
        expect(curated.locator("#retry-catalog")).to_be_visible()
        requests["fail"] = False
        curated.locator("#retry-catalog").click()
        expect(curated.locator("#theme-grid .theme-card")).to_have_count(1)
        expect(curated.locator("#retry-catalog")).to_be_hidden()
        curated.screenshot(path=str(screenshots / "promptdirector-step4-curated-themes.png"), full_page=True)

        curated.locator(".theme-open").click()
        expect(curated.locator("#cases-view")).to_be_visible()
        expect(curated.locator("#active-theme-title")).to_have_text("工作流精选")
        expect(curated.locator("#active-theme-count")).to_have_text("1 个精选案例")
        expect(curated.locator("#curated-grid .case-card")).to_have_count(1)
        expect(curated.locator("#save-theme")).to_have_text("全部保存")
        expect(curated.locator("#return-label")).to_have_text("返回主题")
        curated.screenshot(path=str(screenshots / "promptdirector-step4-curated-theme-detail.png"), full_page=True)

        curated.locator("#save-theme").click()
        expect(curated.locator("#save-theme")).to_have_text("已全部保存")
        expect(curated.locator("#theme-save-status")).to_contain_text("1/1 已保存")
        state = curated.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert len(state["entries"]) == 1, state

        curated.locator("#return-library").click()
        expect(curated.locator("#themes-view")).to_be_visible()
        expect(curated.locator("#return-label")).to_have_text("返回我的案例库")
        expect(curated.locator(".theme-card-actions")).to_contain_text("1/1 已保存")

        auto = session.open_page("curated.html", wait_until="networkidle")
        expect(auto.locator("#theme-grid .theme-card")).to_have_count(1)
        assert requests["catalog"] >= 3, requests

        auto.set_viewport_size({"width": 390, "height": 844})
        auto.locator(".theme-open").click()
        expect(auto.locator("#active-theme-count")).to_be_visible()
        geometry = auto.evaluate(
            """() => ({
              viewport: innerWidth,
              page: document.documentElement.scrollWidth,
              toolbarRight: document.querySelector('.theme-toolbar').getBoundingClientRect().right,
              actionRight: document.querySelector('.theme-save-actions').getBoundingClientRect().right
            })"""
        )
        assert geometry["page"] <= geometry["viewport"], geometry
        assert geometry["toolbarRight"] <= geometry["viewport"] + 1, geometry
        assert geometry["actionRight"] <= geometry["viewport"] + 1, geometry
        auto.screenshot(path=str(screenshots / "promptdirector-step4-curated-mobile.png"), full_page=True)

        auto.evaluate("""async () => {
          await chrome.storage.local.set({uiPreferences: {locale: 'en', theme: 'dark', motion: 'reduced'}});
          localStorage.setItem('promptDirectorTheme', 'dark');
          localStorage.setItem('promptDirectorMotion', 'reduced');
        }""")
        auto.reload(wait_until="networkidle")
        expect(auto.locator(".curated-header h1")).to_have_text("Curated cases")
        expect(auto.locator(".themes-heading h2")).to_have_text("Browse by edition")
        expect(auto.locator(".theme-card-actions button")).to_have_text("All saved")
        auto.locator(".theme-open").click()
        expect(auto.locator("#return-label")).to_have_text("Back to editions")
        expect(auto.locator("#active-theme-count")).to_have_text("1 curated cases")

        print({
            "automatic_catalog_requests": requests["catalog"],
            "failure_retry": True,
            "theme_enter_back": True,
            "batch_save": True,
            "mobile": geometry,
            "english_ui": True,
            "screenshots": [
                str(screenshots / "promptdirector-step4-curated-themes.png"),
                str(screenshots / "promptdirector-step4-curated-theme-detail.png"),
                str(screenshots / "promptdirector-step4-curated-mobile.png"),
            ],
        })


if __name__ == "__main__":
    main()
