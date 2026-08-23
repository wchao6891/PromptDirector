from __future__ import annotations

import re

from playwright.sync_api import expect

from e2e_support import extension_session


PRODUCT_PAGES = (
    "library.html",
    "composer.html",
    "skills.html",
    "curated.html",
    "curated-skills.html",
    "collector.html",
)
CHINESE = re.compile(r"[\u3400-\u9fff]")


def assert_no_visible_chinese(locator, state: str) -> None:
    lines = sorted({line.strip() for line in locator.inner_text().splitlines() if CHINESE.search(line)})
    assert not lines, (state, lines)


def main() -> None:
    with extension_session("prompt-director-brand-i18n-", viewport={"width": 390, "height": 844}) as session:
        setup = session.open_page("collector.html", wait_until="networkidle")
        session.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [],
            "settings": {"libraryTitle": "视觉创作灵感库"},
            "uiPreferences": {"locale": "en", "theme": "dark", "motion": "reduced"},
        })
        setup.close()

        visible_chinese = {}
        for path in PRODUCT_PAGES:
            page = session.open_page(path, wait_until="networkidle")
            expect(page.locator("html")).to_have_attribute("lang", "en")
            if path == "composer.html":
                page.locator("#composer-shell").evaluate("node => node.classList.add('nav-open')")
                page.wait_for_timeout(250)
            brand = page.locator(".product-brand").first
            expect(brand).to_be_visible()
            expect(brand.locator(".product-brand-name")).to_have_text("PromptDirector")
            expect(brand.locator(".product-brand-tagline")).to_have_text("Visual Inspiration Library")
            metrics = brand.evaluate(
                """node => {
                  const rect = node.getBoundingClientRect();
                  const name = node.querySelector('.product-brand-name');
                  const tagline = node.querySelector('.product-brand-tagline');
                  return {
                    left: rect.left,
                    right: rect.right,
                    viewport: innerWidth,
                    nameWhiteSpace: getComputedStyle(name).whiteSpace,
                    taglineWhiteSpace: getComputedStyle(tagline).whiteSpace,
                    nameHeight: name.getBoundingClientRect().height,
                    taglineHeight: tagline.getBoundingClientRect().height,
                    nameLineHeight: parseFloat(getComputedStyle(name).lineHeight),
                    taglineLineHeight: parseFloat(getComputedStyle(tagline).lineHeight),
                    nameClientWidth: name.clientWidth,
                    nameScrollWidth: name.scrollWidth,
                    taglineClientWidth: tagline.clientWidth,
                    taglineScrollWidth: tagline.scrollWidth,
                  };
                }"""
            )
            assert metrics["left"] >= 0 and metrics["right"] <= metrics["viewport"] + 1, (path, metrics)
            assert metrics["nameWhiteSpace"] == "nowrap" and metrics["taglineWhiteSpace"] == "nowrap", (path, metrics)
            assert metrics["nameHeight"] <= metrics["nameLineHeight"] + 1, (path, metrics)
            assert metrics["taglineHeight"] <= metrics["taglineLineHeight"] + 1, (path, metrics)
            assert metrics["nameScrollWidth"] <= metrics["nameClientWidth"] + 1, (path, metrics)
            assert metrics["taglineScrollWidth"] <= metrics["taglineClientWidth"] + 1, (path, metrics)
            if path in {"library.html", "composer.html", "skills.html", "collector.html"}:
                matches = sorted({line.strip() for line in page.locator("body").inner_text().splitlines() if CHINESE.search(line)})
                if matches:
                    visible_chinese[path] = matches
            page.close()

        assert not visible_chinese, visible_chinese

        collector = session.open_page("collector.html", wait_until="networkidle")
        collector.set_viewport_size({"width": 372, "height": 800})
        collector.evaluate(
            """async () => chrome.runtime.sendMessage({
              type: 'UPDATE_CAPTURE_DRAFT',
              draft: {
                title: 'English draft',
                fragments: [{id: 'fragment-en', text: 'A captured paragraph.', sourceUrl: 'https://fixture.invalid/source', sourceTitle: 'English source'}],
                visuals: []
              }
            })"""
        )
        collector.reload(wait_until="networkidle")
        expect(collector.locator("#content-summary")).to_have_text("1 text excerpt")
        expect(collector.locator("#save-draft")).to_have_text("Save case")
        expect(collector.locator("#capture-collection option").first).to_have_text("No project")
        assert_no_visible_chinese(collector.locator("body"), "collector text draft at 372px")
        assert collector.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")

        worker = session.context.service_workers[0]
        worker.evaluate("() => chrome.runtime.sendMessage({type: 'REGION_CAPTURE_CHANGED', sessionId: 'region-en', phase: 'selecting'})")
        expect(collector.locator("#region-capture-status")).to_be_visible()
        expect(collector.locator("#region-capture-title")).to_have_text("Region capture is active. Drag on the page to select an area; press Esc to cancel.")
        assert_no_visible_chinese(collector.locator("#region-capture-status"), "collector region state")
        worker.evaluate("() => chrome.runtime.sendMessage({type: 'REGION_CAPTURE_CHANGED', sessionId: 'region-en', phase: 'cancelled'})")

        collector.locator("#discard-draft").click()
        dialog = collector.locator("#promptdirector-app-dialog")
        expect(dialog.get_by_role("heading")).to_have_text("Clear unsaved content?")
        assert_no_visible_chinese(dialog, "collector clear dialog")
        dialog.get_by_role("button", name="Clear", exact=True).click()
        expect(collector.locator("#feedback")).to_have_text("Unsaved content cleared")
        collector.close()

        for width in (320, 390, 640, 1440):
            curated = session.open_page("curated.html", wait_until="networkidle")
            curated.set_viewport_size({"width": width, "height": 800})
            metrics = curated.evaluate(
                """() => {
                  const header = document.querySelector('.curated-header').getBoundingClientRect();
                  const controls = [...document.querySelectorAll('.curated-header-tools, .curated-header-tools > *, .page-back-action')]
                    .filter(node => getComputedStyle(node).display !== 'none')
                    .map(node => ({name: node.className, rect: node.getBoundingClientRect().toJSON()}));
                  return {
                    header: header.toJSON(), controls,
                    viewport: innerWidth,
                    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
                  };
                }"""
            )
            assert metrics["overflow"] <= 1, (width, metrics)
            for control in metrics["controls"]:
                rect = control["rect"]
                assert rect["left"] >= metrics["header"]["left"] - 1, (width, control, metrics)
                assert rect["right"] <= metrics["header"]["right"] + 1, (width, control, metrics)
            curated.close()

        print({"brand_pages": len(PRODUCT_PAGES), "viewport": 390, "collector_dynamic_states": 3, "curated_widths": 4, "visible_chinese": False})


if __name__ == "__main__":
    main()
