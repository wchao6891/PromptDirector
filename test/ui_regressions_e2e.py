from __future__ import annotations

import tempfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def image_entry(entry_id: str, title: str, text: str, minute: int) -> dict:
    entry = base_entry(entry_id, title, text, "content:prompt:image", minute)
    asset_id = f"{entry_id}-image"
    entry["mediaAssets"] = [{
        "id": asset_id,
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
        "capturedAt": "2026-08-05T00:00:00.000Z",
        "reviewStatus": "verified",
    }]
    entry["primaryMediaId"] = asset_id
    return entry


def main() -> None:
    project_entry = image_entry("project-private", "无提示词图片", "", 0)
    visible_entry = image_entry("library-visible", "资料库图片", "柔和自然光", 1)
    project_id = "collection:visibility-e2e"
    screenshots = Path(tempfile.gettempdir())

    with extension_session("prompt-director-ui-regressions-", viewport={"width": 1440, "height": 900}) as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entries, png, projectId}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const {applyFixedAnalysisTags, createFixedFacetCatalog} = await import(chrome.runtime.getURL('tag-taxonomy.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              const blob = new Blob([bytes], {type: 'image/png'});
              let state = {facetCatalog: createFixedFacetCatalog(), entries};
              state = applyFixedAnalysisTags(state, 'project-private', [{g: 'style.render', t: '共同质感'}], {
                source: 'deepseek_text'
              }).state;
              for (const entry of entries) await saveMediaBlob(entry.primaryMediaId, blob, {checkCapacity: false});
              await chrome.storage.local.clear();
              await chrome.storage.local.set({
                schemaVersion: 24,
                entries: state.entries,
                facetCatalog: state.facetCatalog,
                organizerState: {
                  version: 5,
                  collections: [{
                    id: projectId,
                    name: '项目隐藏验收',
                    order: 0,
                    entryIds: ['project-private'],
                    visibility: 'library',
                  }]
                }
              });
            }""",
            {"entries": [project_entry, visible_entry], "png": PNG_BASE64, "projectId": project_id},
        )

        library = session.open_page("library.html", wait_until="networkidle")
        expect(library.locator("#case-list > .case-card")).to_have_count(2)
        assert library.locator("#import-candidates").count() == 0
        assert library.get_by_text("高级工具", exact=True).count() == 0

        project_row = library.locator(".project-row", has_text="项目隐藏验收")
        project_row.locator("summary").click()
        project_row.get_by_role("button", name="仅项目可见", exact=True).click()
        expect(library.locator("#feedback")).to_contain_text("项目显示范围已更新")
        expect(library.locator("#case-list > .case-card")).to_have_count(1)
        visibility = library.evaluate(
            "async id => (await chrome.storage.local.get('organizerState')).organizerState.collections.find(item => item.id === id).visibility",
            project_id,
        )
        assert visibility == "project-only", visibility

        project_filter = library.locator(".project-filter", has_text="项目隐藏验收")
        project_filter.click()
        expect(library.locator("#case-list > .case-card")).to_have_count(1)
        selected_style = project_filter.evaluate(
            "button => ({background: getComputedStyle(button).backgroundColor, color: getComputedStyle(button).color, shadow: getComputedStyle(button).boxShadow})"
        )
        assert selected_style["background"] != "rgba(0, 0, 0, 0)", selected_style
        assert selected_style["shadow"] != "none", selected_style

        library.locator('.facet-filter[data-facet-id="style"] > summary').click()
        facet_button = library.locator('[data-facet-node-id="style.render"]')
        expect(facet_button).to_be_visible()
        library.evaluate(
            """() => {
              window.__projectNavigationNode = document.querySelector('#collection-filters').firstElementChild;
              window.__facetNavigationNode = document.querySelector('#facet-filters').firstElementChild;
            }"""
        )
        facet_button.click()
        expect(facet_button).to_have_attribute("aria-pressed", "true")
        navigation_reused = library.evaluate(
            """() => ({
              project: window.__projectNavigationNode === document.querySelector('#collection-filters').firstElementChild,
              facet: window.__facetNavigationNode === document.querySelector('#facet-filters').firstElementChild
            })"""
        )
        assert navigation_reused == {"project": True, "facet": True}, navigation_reused

        library.locator("#case-list > .case-card").click()
        expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", "project-private")
        detail_surface = library.locator(".detail-primary").evaluate(
            """primary => {
              const body = primary.querySelector('.detail-body');
              const primaryRect = primary.getBoundingClientRect();
              const bodyRect = body.getBoundingClientRect();
              return {
                primaryHeight: primaryRect.height,
                bodyHeight: bodyRect.height,
                bodyBottom: bodyRect.bottom,
                primaryBottom: primaryRect.bottom,
                bodyBackground: getComputedStyle(body).backgroundColor,
                mediaBackground: getComputedStyle(primary.querySelector('.detail-visual-gallery')).backgroundColor
              };
            }"""
        )
        assert detail_surface["bodyHeight"] >= detail_surface["primaryHeight"] - 1, detail_surface
        assert abs(detail_surface["bodyBottom"] - detail_surface["primaryBottom"]) <= 1, detail_surface
        assert detail_surface["bodyBackground"] != detail_surface["mediaBackground"], detail_surface
        expect(library.locator("#detail-prev")).to_be_disabled()
        expect(library.locator("#detail-next")).to_be_disabled()
        library.screenshot(path=str(screenshots / "promptdirector-library-detail-light.png"), full_page=True)

        composer = session.open_page("composer.html", wait_until="networkidle")
        expect(composer.locator("#composer-route")).not_to_be_visible()
        expect(composer.locator("#composer-platform")).not_to_be_visible()
        expect(composer.locator("#composer-output-language")).not_to_be_visible()
        expect(composer.locator("#composer-production-review")).not_to_be_visible()
        expect(composer.locator("#composer-thinking")).not_to_be_visible()
        expect(composer.locator("#composer-applied-skills")).to_be_hidden()
        expect(composer.locator("#composer-attachment-local")).to_be_visible()
        expect(composer.locator("#composer-reference-open")).to_be_visible()
        composer.screenshot(path=str(screenshots / "promptdirector-composer-desktop.png"), full_page=True)
        composer.locator("#composer-options > summary").click()
        expect(composer.locator("#composer-route")).to_be_visible()
        expect(composer.locator("#composer-thinking")).to_be_visible()

        composer.set_viewport_size({"width": 390, "height": 844})
        composer.locator("#composer-options").evaluate("details => { details.open = false; }")
        composer.wait_for_timeout(250)
        footer_geometry = composer.locator(".composer-input-footer").evaluate(
            """footer => {
              const rect = footer.getBoundingClientRect();
              const controls = [...footer.querySelectorAll('.composer-input-tools > *, .composer-input-actions > *')]
                .filter(node => !node.hidden && getComputedStyle(node).display !== 'none')
                .map(node => node.getBoundingClientRect());
              return {
                height: rect.height,
                overflow: controls.some(item => item.left < rect.left - 1 || item.right > rect.right + 1)
              };
            }"""
        )
        assert footer_geometry["height"] < 48, footer_geometry
        assert footer_geometry["overflow"] is False, footer_geometry
        composer.screenshot(path=str(screenshots / "promptdirector-composer-mobile.png"), full_page=True)

        icon = library.locator(".brand-mark")
        icon_metrics = icon.evaluate(
            "image => ({naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: image.getBoundingClientRect().width})"
        )
        assert icon_metrics == {"naturalWidth": 128, "naturalHeight": 128, "width": 36}, icon_metrics
        print({
            "visibility": visibility,
            "navigation_reused": navigation_reused,
            "detail_surface": detail_surface,
            "composer_mobile": footer_geometry,
            "screenshots": [
                str(screenshots / "promptdirector-library-detail-light.png"),
                str(screenshots / "promptdirector-composer-desktop.png"),
                str(screenshots / "promptdirector-composer-mobile.png"),
            ],
        })


if __name__ == "__main__":
    main()
