from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def image_asset(asset_id: str) -> dict:
    return {
        "id": asset_id,
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
        "capturedAt": "2026-08-04T00:00:00.000Z",
        "reviewStatus": "verified",
    }


def make_entries(count: int = 61) -> list[dict]:
    entries = []
    for index in range(count):
        entry = base_entry(
            f"discovery-{index:03d}",
            f"相似案例 {index:03d}",
            f"共同视觉语言下的独立创作提示词 {index:03d}",
            "content:prompt:image",
            index % 60,
        )
        asset_id = f"discovery-image-{index:03d}"
        entry["mediaAssets"] = [image_asset(asset_id)]
        entry["primaryMediaId"] = asset_id
        entries.append(entry)
    return entries


def main() -> None:
    entries = make_entries()
    with extension_session(
        "prompt-director-discovery-",
        viewport={"width": 1440, "height": 900},
    ) as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entries, png}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const {applyFixedAnalysisTags, createFixedFacetCatalog} = await import(chrome.runtime.getURL('tag-taxonomy.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              const blob = new Blob([bytes], {type: 'image/png'});
              let state = {facetCatalog: createFixedFacetCatalog(), entries};
              for (const entry of entries) {
                await saveMediaBlob(entry.primaryMediaId, blob, {checkCapacity: false});
                state = applyFixedAnalysisTags(state, entry.id, [{g: 'style.render', t: '共同质感'}], {
                  source: 'deepseek_text'
                }).state;
              }
              await chrome.storage.local.clear();
              await chrome.storage.local.set({
                schemaVersion: 24,
                entries: state.entries,
                facetCatalog: state.facetCatalog
              });
            }""",
            {"entries": entries, "png": PNG_BASE64},
        )

        session.context.add_init_script(
            """window.__resizeObserverErrors = [];
            addEventListener('error', event => {
              if (String(event.message).includes('ResizeObserver loop')) {
                window.__resizeObserverErrors.push(event.message);
              }
            });"""
        )
        library = session.open_page("library.html", wait_until="networkidle")
        library.locator("#ui-theme").evaluate(
            """select => {
              select.value = 'dark';
              select.dispatchEvent(new Event('change', {bubbles: true}));
            }"""
        )
        expect(library.locator("html")).to_have_attribute("data-theme", "dark")

        home_cards = library.locator("#case-list > .case-card")
        expect(home_cards).to_have_count(24)
        assert home_cards.evaluate_all("cards => cards.every(card => !card.innerText.trim())")
        home_wall_style = library.locator("#case-list").evaluate(
            "element => ({gap: getComputedStyle(element).getPropertyValue('--masonry-gap').trim(), radius: getComputedStyle(element.firstElementChild).borderRadius})"
        )
        assert home_wall_style == {"gap": "2px", "radius": "2px"}, home_wall_style

        initial_entry_id = library.locator("#case-list > .case-card").first.get_attribute("data-entry-id")
        library.locator("#case-list > .case-card").first.click()
        expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", initial_entry_id)
        expect(library.locator(".detail-primary")).to_be_visible()
        expect(library.locator("#detail-navigation")).to_be_in_viewport()
        detail_geometry = library.locator(".detail-primary").evaluate(
            """primary => {
              const primaryRect = primary.getBoundingClientRect();
              const titleRect = primary.querySelector('.detail-body h2').getBoundingClientRect();
              const navigationRect = primary.querySelector('#detail-navigation').getBoundingClientRect();
              return {
                titleOffset: titleRect.top - primaryRect.top,
                navigationInsidePrimary: navigationRect.top >= primaryRect.top && navigationRect.bottom <= primaryRect.bottom
              };
            }"""
        )
        assert detail_geometry["titleOffset"] < 40, detail_geometry
        assert detail_geometry["navigationInsidePrimary"], detail_geometry
        expect(library.locator("#detail-prev")).to_be_disabled()
        expect(library.locator("#detail-next")).to_be_enabled()
        next_hit = library.locator("#detail-next").evaluate(
            """button => {
              const rect = button.getBoundingClientRect();
              return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('#detail-next') === button;
            }"""
        )
        assert next_hit
        library.locator("#detail-next").click()
        expect(library.locator("#detail-drawer")).not_to_have_attribute("data-entry-id", initial_entry_id)
        second_entry_id = library.locator("#detail-drawer").get_attribute("data-entry-id")
        assert second_entry_id != initial_entry_id
        library.locator("#detail-prev").click()
        expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", initial_entry_id)
        similar = library.locator(".detail-discovery-grid .local-discovery-item")
        expect(similar).to_have_count(24)
        assert similar.evaluate_all("cards => cards.every(card => !card.innerText.trim())")
        discovery_style = library.locator(".detail-discovery-grid").evaluate(
            "element => ({gap: getComputedStyle(element).getPropertyValue('--masonry-gap').trim(), radius: getComputedStyle(element.firstElementChild).borderRadius})"
        )
        assert discovery_style == {"gap": "2px", "radius": "2px"}, discovery_style
        initial_loaded = library.locator(".detail-discovery-grid img[src]").count()
        assert initial_loaded < 24, initial_loaded

        library.locator("#detail-content").evaluate("element => { element.scrollTop = element.scrollHeight; }")
        expect(library.locator("#detail-navigation")).not_to_be_in_viewport()
        expect(similar).not_to_have_count(24, timeout=10_000)
        incremental_count = similar.count()
        assert 24 < incremental_count <= 60, incremental_count
        expect(library.locator(".detail-discovery-grid img[src]").first).to_be_attached()

        target = similar.nth(30)
        target.scroll_into_view_if_needed()
        target.click()
        expect(library.locator("#detail-drawer")).not_to_have_attribute("data-entry-id", initial_entry_id)
        expect(similar).to_have_count(24)
        assert library.locator("#detail-content").evaluate("element => element.scrollTop") <= 1

        active_entry_id = library.locator("#detail-drawer").get_attribute("data-entry-id")
        page_count = len(session.context.pages)
        library.get_by_role("button", name="以此创作").click()
        expect(library).to_have_url(re.compile(r"composer\.html"))
        assert len(session.context.pages) == page_count
        query = parse_qs(urlparse(library.url).query)
        assert query == {
            "references": [active_entry_id],
            "asset": ["discovery-image-028"],
            "type": ["image"]
        }, query
        library.go_back(wait_until="domcontentloaded")
        expect(library).to_have_url(re.compile(r"library\.html"))
        expect(library.locator("#case-list > .case-card")).to_have_count(24)
        library.locator("#case-list > .case-card").first.click()
        expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", initial_entry_id)

        library.set_viewport_size({"width": 390, "height": 844})
        expect(library.locator(".detail-primary")).to_be_visible()
        library.locator("#detail-content").evaluate(
            "element => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
        )
        overflow = library.locator("#detail-content").evaluate(
            """element => ({
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              offenders: [...element.querySelectorAll('*')].flatMap(node => {
                const rect = node.getBoundingClientRect();
                return rect.right > element.getBoundingClientRect().right + 1
                  ? [{tag: node.tagName, className: node.className, left: rect.left, right: rect.right, width: rect.width}]
                  : [];
              }).slice(0, 12)
            })"""
        )
        assert overflow["scrollWidth"] <= overflow["clientWidth"], overflow
        mobile_entry_id = library.locator("#detail-drawer").get_attribute("data-entry-id")
        library.locator("#detail-next").click()
        expect(library.locator("#detail-drawer")).not_to_have_attribute("data-entry-id", mobile_entry_id)
        library.locator("#detail-prev").click()
        expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", mobile_entry_id)
        library.locator("#ui-theme").evaluate(
            """select => {
              select.value = 'light';
              select.dispatchEvent(new Event('change', {bubbles: true}));
            }"""
        )
        expect(library.locator("html")).to_have_attribute("data-theme", "light")
        resize_observer_errors = library.evaluate("window.__resizeObserverErrors")
        assert resize_observer_errors == [], resize_observer_errors

        print({
            "initial_discovery_batch": 24,
            "incremental_discovery_count": incremental_count,
            "media_lazy_loaded": True,
            "similar_switch_resets_scroll": True,
            "single_reference_composer": True,
            "navigation_clicks": "desktop_and_mobile",
            "pure_media_wall_gap": "2px",
            "desktop_and_mobile": True,
            "light_and_dark": True,
            "resize_observer_errors": 0,
        })


if __name__ == "__main__":
    main()
