from __future__ import annotations

import tempfile
from pathlib import Path
import re

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
        expect(library.locator("#clear-filters, #active-filter-badge, .sidebar-filter-tools")).to_have_count(0)
        content_heading_top = library.locator(".filter-section").first.evaluate("node => node.getBoundingClientRect().top")
        project_filter = library.locator("#collection-filters .project-filter")
        project_filter.click()
        expect(project_filter).to_have_attribute("aria-pressed", "true")
        filtered_content_heading_top = library.locator(".filter-section").first.evaluate("node => node.getBoundingClientRect().top")
        assert filtered_content_heading_top == content_heading_top, {"before": content_heading_top, "after": filtered_content_heading_top}
        project_filter.click()
        expect(project_filter).to_have_attribute("aria-pressed", "false")
        expect(library.locator("#project-sort")).to_have_count(0)
        expect(library.locator(".project-row.project-ordering")).to_have_count(0)
        library.locator("#manage-project-order").click()
        expect(library.locator(".project-row.project-ordering")).to_have_count(1)
        expect(library.locator(".project-row > .project-menu")).to_be_hidden()
        expect(library.locator("#manage-project-order use")).to_have_attribute("href", re.compile(r"assets/ui-icons\.svg#icon-circle-check-big$"))
        library.locator("#manage-project-order").click()
        expect(library.locator(".project-row.project-ordering")).to_have_count(0)
        expect(library.locator(".project-row > .project-menu")).to_be_visible()

        resizer = library.locator("#sidebar-resizer")
        expect(resizer).to_be_visible()
        resizer.focus()
        resizer.press("ArrowRight")
        expect(resizer).to_have_attribute("aria-valuenow", "260")
        saved_width = library.evaluate("async () => (await chrome.storage.local.get('uiPreferences')).uiPreferences.sidebarWidth")
        assert saved_width == 260, saved_width
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
        first_card = library.locator("#case-list > .case-card").first
        hover_states = {}
        for theme in ["dark", "light"]:
            library.evaluate(
                """theme => {
                  document.documentElement.dataset.theme = theme;
                  document.documentElement.dataset.resolvedTheme = theme;
                }""",
                theme,
            )
            before_hover = first_card.evaluate(
                "node => { const rect = node.getBoundingClientRect(); return {left: rect.left, top: rect.top, width: rect.width, height: rect.height, scrollY}; }"
            )
            first_card.hover()
            after_hover = first_card.evaluate(
                """node => {
                  const rect = node.getBoundingClientRect();
                  const style = getComputedStyle(node);
                  const overlay = getComputedStyle(node, '::after');
                  return {left: rect.left, top: rect.top, width: rect.width, height: rect.height, scrollY, shadow: style.boxShadow, overlayBorder: overlay.borderTopWidth, overlayColor: overlay.borderTopColor};
                }"""
            )
            assert all(abs(after_hover[key] - before_hover[key]) <= 1 for key in ["left", "top", "width", "height", "scrollY"]), {"theme": theme, "before": before_hover, "after": after_hover}
            assert after_hover["shadow"] == "none", {"theme": theme, "after": after_hover}
            assert after_hover["overlayBorder"] == "1px", {"theme": theme, "after": after_hover}
            assert after_hover["overlayColor"] != "rgba(0, 0, 0, 0)", {"theme": theme, "after": after_hover}
            hover_states[theme] = after_hover
        library.evaluate(
            """() => {
              document.documentElement.dataset.theme = 'dark';
              document.documentElement.dataset.resolvedTheme = 'dark';
            }"""
        )
        first_card_top = library.locator("#case-list > .case-card").first.evaluate("node => node.getBoundingClientRect().top")
        library.locator("#select-cases").click()
        expect(library.locator("#result-count")).to_be_hidden()
        expect(library.locator("#gallery-view-controls")).to_be_hidden()
        expect(library.locator("#manage-project-order")).to_be_visible()
        expect(library.locator("#manage-project-order")).to_be_disabled()
        expect(library.locator("#share-count")).to_have_text("已选 0")
        expect(library.locator("#selection-selected-actions")).to_be_hidden()
        selection_first_card_top = library.locator("#case-list > .case-card").first.evaluate("node => node.getBoundingClientRect().top")
        assert abs(selection_first_card_top - first_card_top) <= 1, {"before": first_card_top, "after": selection_first_card_top}
        library.set_viewport_size({"width": 1658, "height": 900})
        library.screenshot(path=str(screenshots / "promptdirector-selection-toolbar-empty.png"))
        library.set_viewport_size({"width": 1440, "height": 900})
        library.locator("#selection-select-filtered").click()
        expect(library.locator("#selection-clear")).to_be_enabled()
        expect(library.locator("#share-count")).to_have_text("已选 2")
        expect(library.locator("#selection-select-filtered")).to_be_hidden()
        expect(library.locator("#selection-selected-actions")).to_be_visible()
        expect(library.locator("#selection-label-menu")).to_be_visible()
        expect(library.locator("#selection-project-menu")).to_be_visible()
        expect(library.locator("#selection-more-menu")).to_be_visible()
        library.locator("#case-list > .case-card").first.click()
        expect(library.locator("#share-count")).to_have_text("已选 1")
        library.locator("#selection-more-menu > summary").click()
        expect(library.locator("#selection-combine")).to_be_disabled()
        expect(library.locator("#selection-analyze")).to_be_enabled()
        expect(library.locator("#selection-trash")).to_be_enabled()
        library.locator("#selection-more-menu > summary").press("Escape")
        library.locator("#case-list > .case-card").first.click()
        expect(library.locator("#share-count")).to_have_text("已选 2")
        label_menu = library.locator("#selection-label-menu")
        label_menu.locator(":scope > summary").click()
        expect(library.locator("#selection-label-input")).to_be_visible()
        library.locator("#selection-label-input").press("Escape")
        expect(label_menu).not_to_have_attribute("open", "")
        expect(label_menu.locator(":scope > summary")).to_be_focused()
        library.locator("#selection-project-menu > summary").click()
        expect(library.locator("#selection-project-target")).to_be_visible()
        library.locator("#selection-project-target").select_option("collection:navigation")
        expect(library.locator("#selection-add-project")).to_be_enabled()
        library.locator("#selection-project-menu > summary").press("Escape")
        library.locator("#selection-more-menu > summary").click()
        expect(library.locator("#selection-combine")).to_be_enabled()
        expect(library.locator("#selection-analyze")).to_be_enabled()
        expect(library.locator("#selection-trash")).to_be_enabled()
        library.locator("#selection-more-menu > summary").press("Escape")
        library.set_viewport_size({"width": 700, "height": 900})
        compact_desktop = library.locator("#share-bar").evaluate(
            "node => { const rect = node.getBoundingClientRect(); return {left: rect.left, right: rect.right, height: rect.height, viewport: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth}; }"
        )
        assert compact_desktop["left"] >= 0 and compact_desktop["right"] <= compact_desktop["viewport"], compact_desktop
        assert compact_desktop["height"] <= 34 and compact_desktop["overflow"] is False, compact_desktop
        library.set_viewport_size({"width": 1658, "height": 900})
        cancel_metrics = library.locator("#share-cancel").evaluate(
            "node => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return {text: node.textContent, left: rect.left, right: rect.right, width: rect.width, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, flexShrink: style.flexShrink, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight}; }"
        )
        assert cancel_metrics["scrollWidth"] <= cancel_metrics["clientWidth"], cancel_metrics
        library.screenshot(path=str(screenshots / "promptdirector-selection-toolbar-active.png"))
        library.set_viewport_size({"width": 1440, "height": 900})
        library.locator("#selection-clear").click()
        expect(library.locator("#share-count")).to_have_text("已选 0")
        expect(library.locator("#selection-selected-actions")).to_be_hidden()
        expect(library.locator("#selection-select-filtered")).to_be_visible()
        expect(library.locator(".case-card.selected-for-share")).to_have_count(0)
        library.locator("#share-cancel").click()
        expect(library.locator("#manage-project-order")).to_be_enabled()
        library.locator("#select-cases").click()
        library.locator("#selection-select-filtered").click()
        library.locator("#selection-project-menu > summary").click()
        library.locator("#selection-project-target").select_option("collection:navigation")
        expect(library.locator("#selection-remove-project")).to_be_enabled()
        library.locator("#selection-remove-project").click()
        expect(library.locator("#feedback")).to_contain_text("已将 1 个案例移出项目，1 个原本不在该项目")
        expect(library.locator("#case-list > .case-card")).to_have_count(2)
        project_members = library.evaluate("async () => (await chrome.storage.local.get('organizerState')).organizerState.collections[0].entryIds")
        assert project_members == [], project_members
        library.locator("#filter-sidebar").evaluate("node => { node.scrollTop = 0; }")
        library.screenshot(path=str(screenshots / "promptdirector-step2-library-desktop.png"), full_page=True)

        library.set_viewport_size({"width": 390, "height": 844})
        expect(library.locator("#sidebar-resizer")).to_be_hidden()
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
        overflow_nodes = library.evaluate(
            """() => [...document.querySelectorAll('body *')].flatMap(node => {
              const rect = node.getBoundingClientRect();
              return rect.right > innerWidth + 1 ? [{tag: node.tagName, id: node.id, className: String(node.className), right: rect.right}] : [];
            }).slice(0, 12)"""
        )
        assert overflow is False, overflow_nodes
        library.screenshot(path=str(screenshots / "promptdirector-step2-library-mobile.png"), full_page=True)
        library.evaluate("document.querySelector('#toggle-filters').click()")
        expect(library.locator(".workspace")).to_have_class("workspace filters-collapsed")
        library.locator("#select-cases").click()
        expect(library.locator("#selection-selected-actions")).to_be_hidden()
        mobile_empty_bar = library.locator("#share-bar").evaluate(
            "node => { const rect = node.getBoundingClientRect(); return {left: rect.left, right: rect.right, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight}; }"
        )
        assert mobile_empty_bar["left"] >= 0 and mobile_empty_bar["right"] <= mobile_empty_bar["viewportWidth"], mobile_empty_bar
        assert mobile_empty_bar["bottom"] <= mobile_empty_bar["viewportHeight"], mobile_empty_bar
        library.screenshot(path=str(screenshots / "promptdirector-selection-toolbar-mobile-empty.png"))
        library.locator("#case-list > .case-card").first.click()
        expect(library.locator("#selection-selected-actions")).to_be_visible()
        expect(library.locator("#selection-select-filtered")).to_be_hidden()
        mobile_overflow = library.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert mobile_overflow is False
        library.screenshot(path=str(screenshots / "promptdirector-selection-toolbar-mobile-active.png"))
        library.locator("#share-cancel").click()

        print({
            "workspace_items": 3,
            "project_rows": 1,
            "content_rows": 6,
            "mobile_drawer": drawer,
            "mobile_overflow": overflow,
            "wall": wall,
            "hover_states": hover_states,
            "screenshots": [
                str(screenshots / "promptdirector-selection-toolbar-empty.png"),
                str(screenshots / "promptdirector-selection-toolbar-active.png"),
                str(screenshots / "promptdirector-selection-toolbar-mobile-empty.png"),
                str(screenshots / "promptdirector-selection-toolbar-mobile-active.png"),
                str(screenshots / "promptdirector-step2-library-desktop.png"),
                str(screenshots / "promptdirector-step2-library-mobile.png"),
            ],
        })


if __name__ == "__main__":
    main()
