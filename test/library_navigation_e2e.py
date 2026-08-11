from __future__ import annotations

import tempfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def visual_entry(entry_id: str, title: str, content_id: str, minute: int) -> dict:
    entry = base_entry(entry_id, title, f"{title} prompt", content_id, minute)
    asset_id = f"{entry_id}-image"
    entry["mediaAssets"] = [{
        "id": asset_id,
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
        "capturedAt": "2026-08-08T00:00:00.000Z",
        "reviewStatus": "verified",
    }]
    entry["primaryMediaId"] = asset_id
    return entry


def main() -> None:
    entries = [
        visual_entry("nav-image", "图片导航案例", "content:prompt:image", 0),
        visual_entry("nav-video", "视频导航案例", "content:prompt:video", 1),
    ]
    screenshots = Path(tempfile.gettempdir())

    with extension_session("prompt-director-library-navigation-", viewport={"width": 1440, "height": 900}) as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entries, png}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              const blob = new Blob([bytes], {type: 'image/png'});
              await chrome.storage.local.clear();
              await chrome.storage.local.set({
                schemaVersion: 25,
                entries,
                uiPreferences: {locale: 'zh-CN', theme: 'dark', motion: 'system'},
                organizerState: {
                  version: 5,
                  collections: [{id: 'collection:navigation', name: '导航验收项目', order: 0, entryIds: ['nav-image'], visibility: 'library'}]
                }
              });
              for (const entry of entries) await saveMediaBlob(entry.primaryMediaId, blob, {checkCapacity: false});
            }""",
            {"entries": entries, "png": PNG_BASE64},
        )

        library = session.open_page("library.html", wait_until="networkidle")
        expect(library.locator("#case-list > .case-card")).to_have_count(2)
        expect(library.locator('.top-actions > #open-curated, .top-actions > #open-skills')).to_have_count(0)
        expect(library.locator(".workspace-navigation > button")).to_have_count(3)
        expect(library.locator("#workspace-library")).to_have_attribute("aria-current", "page")
        expect(library.locator('input[type="search"]')).to_have_count(1)
        expect(library.locator("#collection-filters .project-filter")).to_have_count(1)
        expect(library.locator("#collection-filters .project-filter-name")).to_have_text("导航验收项目")
        expect(library.locator("#collection-filters .project-filter-count")).to_have_text("1")
        expect(library.locator("#content-filters .content-filter-option")).to_have_count(6)
        expect(library.locator("#content-filters")).not_to_contain_text("全部")
        expect(library.locator("#facet-filters .facet-filter-body .filter-option", has_text="全部")).to_have_count(0)

        style = library.locator('.facet-filter[data-facet-id="style"]')
        style.locator(":scope > summary").click()
        facet_row = style.locator('[data-facet-node-id="style.render"]')
        expect(facet_row.locator(".facet-option-check")).to_be_visible()
        facet_row.click()
        expect(facet_row).to_have_attribute("aria-pressed", "true")
        facet_row.click()
        expect(facet_row).to_have_attribute("aria-pressed", "false")

        primary_color = library.locator("#start-compose").evaluate("node => getComputedStyle(node).backgroundColor")
        add_color = library.locator("#add-menu > summary").evaluate("node => getComputedStyle(node).backgroundColor")
        assert primary_color != add_color, {"primary": primary_color, "add": add_color}
        wall = library.evaluate(
            """() => ({
              gap: getComputedStyle(document.querySelector('#case-list')).getPropertyValue('--masonry-gap').trim(),
              cardRadius: getComputedStyle(document.querySelector('#case-list .case-card')).borderRadius
            })"""
        )
        assert wall == {"gap": "2px", "cardRadius": "2px"}, wall
        library.locator("#filter-sidebar").evaluate("node => { node.scrollTop = 0; }")
        library.screenshot(path=str(screenshots / "promptdirector-step2-library-desktop.png"), full_page=True)

        library.set_viewport_size({"width": 390, "height": 844})
        expect(library.locator(".workspace")).to_have_class("workspace filters-collapsed")
        library.wait_for_function(
            """() => new Promise((resolve) => requestAnimationFrame(
              () => requestAnimationFrame(() => resolve(
                document.querySelector('.workspace')?.classList.contains('filters-collapsed')
              ))
            ))"""
        )
        library.locator("#toggle-filters").click()
        expect(library.locator(".workspace")).to_have_class("workspace")
        library.wait_for_function(
            """() => {
              const drawer = document.querySelector('#filter-sidebar')?.getBoundingClientRect();
              return drawer && drawer.left >= -1 && drawer.right <= innerWidth + 1;
            }"""
        )
        drawer = library.locator("#filter-sidebar").evaluate(
            """node => {
              const rect = node.getBoundingClientRect();
              return {left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth};
            }"""
        )
        assert drawer["left"] >= -1 and drawer["right"] <= drawer["viewport"] + 1, drawer
        library.locator('[data-content-filter-id="content:prompt:image"]').click()
        expect(library.locator("#case-list > .case-card")).to_have_count(1)
        overflow = library.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert overflow is False
        library.screenshot(path=str(screenshots / "promptdirector-step2-library-mobile.png"), full_page=True)

        print({
            "workspace_items": 3,
            "project_rows": 1,
            "content_rows": 6,
            "mobile_drawer": drawer,
            "mobile_overflow": overflow,
            "wall": wall,
            "screenshots": [
                str(screenshots / "promptdirector-step2-library-desktop.png"),
                str(screenshots / "promptdirector-step2-library-mobile.png"),
            ],
        })


if __name__ == "__main__":
    main()
