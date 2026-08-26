from __future__ import annotations

import tempfile
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, expect, sync_playwright

from e2e_support import launch_context


EXTENSION_DIR = Path(__file__).resolve().parents[1]
INITIAL_BATCH_SIZE = 24


def wait_for_initial_gallery_batch(page, total: int) -> int:
    cards = page.locator(".case-card")
    expect(cards.first).to_be_visible()
    count = cards.count()
    assert INITIAL_BATCH_SIZE <= count < total, count
    return count


def save_pending_classification(page) -> None:
    page.locator(".pending-classification-inline select").select_option("content:image-case")
    page.evaluate(
        """() => new Promise(resolve => requestAnimationFrame(
          () => requestAnimationFrame(resolve)
        ))"""
    )
    button = page.locator(".pending-classification-inline button")
    expect(button).to_be_enabled()
    button.click()


def make_entries() -> list[dict]:
    entries = []
    for index in range(100):
        entries.append({
            "schemaVersion": 3,
            "id": f"case-{index:03d}",
            "text": f"Prompt {index}",
            "title": f"Case {index:03d}",
            "url": f"https://example.com/cases/{index}",
            "savedAt": f"2026-07-19T10:{index // 60:02d}:{index % 60:02d}.000Z",
            "classification": {
                "pathIds": ["content:image-case"],
                "status": "confirmed",
                "source": "manual",
            },
            "tagIds": [],
            "legacyTags": [],
        })
    for index in range(3):
        entries.append({
            "schemaVersion": 3,
            "id": f"pending-{index}",
            "text": f"Pending prompt {index}",
            "title": f"Pending {index}",
            "url": f"https://example.com/pending/{index}",
            "savedAt": f"2026-07-19T12:0{index}:00.000Z",
            "classification": {
                "pathIds": [],
                "status": "needs_review",
                "source": "auto",
            },
            "tagIds": [],
            "legacyTags": [],
        })
    return entries


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="prompt-director-132-") as profile_dir:
        with sync_playwright() as playwright:
            context = launch_context(
                playwright, profile_dir,
                viewport={"width": 1280, "height": 900},
                accept_downloads=True,
                extension_dir=EXTENSION_DIR,
            )
            try:
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                extension_id = worker.url.split("/")[2]
                setup = context.new_page()
                setup.goto(f"chrome-extension://{extension_id}/collector.html")
                setup.evaluate(
                    """async (entries) => {
                      await chrome.storage.local.clear();
                      await chrome.storage.local.set({schemaVersion: 3, entries});
                    }""",
                    make_entries(),
                )

                library = context.new_page()
                library.add_init_script(
                    """() => {
                      window.__resizeObserverErrors = [];
                      addEventListener('error', (event) => {
                        if (String(event.message).includes('ResizeObserver loop')) {
                          window.__resizeObserverErrors.push(event.message);
                        }
                      });
                    }"""
                )
                library.goto(f"chrome-extension://{extension_id}/library.html")
                library.wait_for_load_state("networkidle")
                library.locator("#search-input").fill("Prompt")

                wait_for_initial_gallery_batch(library, 103)
                expect(library.locator("#load-more")).to_be_visible()
                paging = library.evaluate(
                    """() => ({
                      rendered: document.querySelectorAll('.case-card').length,
                      label: document.querySelector('#load-more').textContent
                    })"""
                )
                assert str(103 - paging["rendered"]) in paging["label"], paging
                for width in [1280, 800, 603, 390]:
                    library.set_viewport_size({"width": width, "height": 820})
                    library.reload()
                    library.wait_for_load_state("networkidle")
                    library.locator("#search-input").fill("Prompt")
                    wait_for_initial_gallery_batch(library, 103)
                    card_ids = library.locator(".case-card").evaluate_all(
                        "cards => cards.map((card) => card.dataset.entryId)"
                    )
                    assert 24 <= len(card_ids) <= 103, (width, len(card_ids))
                    assert len(card_ids) == len(set(card_ids)), (width, card_ids)
                    header = library.evaluate(
                        """() => {
                          const search = document.querySelector('.global-search').getBoundingClientRect();
                          const actions = document.querySelector('.top-actions').getBoundingClientRect();
                          return {
                            viewportWidth: innerWidth,
                            searchLeft: search.left,
                            searchRight: search.right,
                            actionsLeft: actions.left,
                            actionsRight: actions.right,
                            documentWidth: document.documentElement.scrollWidth
                          };
                        }"""
                    )
                    assert header["documentWidth"] <= header["viewportWidth"], (width, header)
                    assert header["searchLeft"] >= 10
                    assert header["searchRight"] <= header["viewportWidth"] - 10
                    assert header["actionsLeft"] >= 10
                    assert header["actionsRight"] <= header["viewportWidth"] - 10
                    library.locator("#add-menu > summary").click()
                    add_menu = library.evaluate(
                        """() => {
                          const header = document.querySelector('.topbar').getBoundingClientRect();
                          const trigger = document.querySelector('#add-menu > summary').getBoundingClientRect();
                          const panel = document.querySelector('#add-menu .package-menu-panel').getBoundingClientRect();
                          return {
                            headerBottom: header.bottom,
                            triggerLeft: trigger.left,
                            triggerRight: trigger.right,
                            panelTop: panel.top,
                            panelLeft: panel.left,
                            panelRight: panel.right,
                            panelBottom: panel.bottom,
                            viewportHeight: innerHeight,
                            viewportWidth: innerWidth
                          };
                        }"""
                    )
                    assert add_menu["triggerLeft"] >= 10, (width, add_menu)
                    assert add_menu["triggerRight"] <= add_menu["viewportWidth"] - 10, (width, add_menu)
                    assert add_menu["panelLeft"] >= 10, (width, add_menu)
                    assert add_menu["panelRight"] <= add_menu["viewportWidth"] - 10, (width, add_menu)
                    assert add_menu["panelTop"] >= add_menu["headerBottom"] - 1, (width, add_menu)
                    assert add_menu["panelBottom"] <= add_menu["viewportHeight"] - 10, (width, add_menu)
                    library.locator("#add-menu > summary").click()
                library.set_viewport_size({"width": 1280, "height": 820})
                library.reload()
                library.wait_for_load_state("networkidle")
                library.locator("#search-input").fill("Prompt")
                wait_for_initial_gallery_batch(library, 103)
                gallery_top_before_filter = library.locator(".gallery-shell").evaluate(
                    "element => element.getBoundingClientRect().top"
                )
                image_filter = library.locator("#content-filters").get_by_role("button", name="图片案例 100", exact=True)
                image_filter.click()
                expect(image_filter).to_have_attribute("aria-pressed", "true")
                gallery_top_after_filter = library.locator(".gallery-shell").evaluate(
                    "element => element.getBoundingClientRect().top"
                )
                assert abs(gallery_top_after_filter - gallery_top_before_filter) <= 1
                image_filter.click()
                expect(image_filter).to_have_attribute("aria-pressed", "false")
                library.locator("#pending-filter").check()
                expect(library.locator("#pending-filter")).to_be_checked()
                library.locator("#pending-filter").uncheck()
                expect(library.locator("#pending-filter")).not_to_be_checked()
                initial_layout = library.evaluate(
                    """() => {
                      window.__promptDirectorInitialCards = new Map();
                      return Object.fromEntries([...document.querySelectorAll('.case-card')].map((card) => {
                        const rect = card.getBoundingClientRect();
                        window.__promptDirectorInitialCards.set(card.dataset.entryId, card);
                        return [card.dataset.entryId, {
                          x: Math.round(rect.left + scrollX),
                          y: Math.round(rect.top + scrollY)
                        }];
                      }));
                    }"""
                )
                initial_count = library.locator(".case-card").count()
                library.locator("#load-more").click()
                assert library.locator(".case-card").count() > initial_count
                layout_after_append = library.evaluate(
                    """(initial) => Object.fromEntries(Object.entries(initial).map(([entryId, position]) => {
                      const card = document.querySelector(`.case-card[data-entry-id="${entryId}"]`);
                      const rect = card.getBoundingClientRect();
                      return [entryId, {
                        sameNode: window.__promptDirectorInitialCards.get(entryId) === card,
                        x: Math.round(rect.left + scrollX),
                        y: Math.round(rect.top + scrollY),
                        initialX: position.x,
                        initialY: position.y
                      }];
                    }))""",
                    initial_layout,
                )
                moved_cards = {
                    entry_id: position
                    for entry_id, position in layout_after_append.items()
                    if not position["sameNode"]
                    or abs(position["x"] - position["initialX"]) > 1
                    or abs(position["y"] - position["initialY"]) > 1
                }
                assert not moved_cards, f"existing cards moved after append: {moved_cards}"
                for _ in range(12):
                    if library.locator(".case-card").count() == 103:
                        break
                    library.mouse.wheel(0, 5000)
                    library.wait_for_timeout(80)
                expect(library.locator(".case-card")).to_have_count(103)
                expect(library.locator("#load-more")).to_be_hidden()
                library.locator(".case-card").first.evaluate(
                    "card => { card.style.paddingBottom = '240px'; }"
                )
                library.evaluate(
                    """() => new Promise((resolve) => requestAnimationFrame(
                      () => requestAnimationFrame(resolve)
                    ))"""
                )
                library.mouse.wheel(0, 1)
                library.evaluate(
                    """() => {
                      const card = document.querySelector(".case-card[data-entry-id='case-050']");
                      scrollTo(0, card.getBoundingClientRect().top + scrollY - 80);
                    }"""
                )
                library.evaluate(
                    """() => new Promise((resolve) => requestAnimationFrame(
                      () => requestAnimationFrame(resolve)
                    ))"""
                )
                visible_before_resize = library.evaluate(
                    """() => [...document.querySelectorAll('.case-card')]
                      .map((card) => ({
                        entryId: card.dataset.entryId,
                        rect: card.getBoundingClientRect(),
                        column: card.dataset.masonryColumn,
                        layoutTop: card.style.top,
                        scrollY
                      }))
                      .filter(({rect}) => rect.bottom > 0 && rect.top < innerHeight)
                    """
                )
                library.set_viewport_size({"width": 900, "height": 900})
                library.wait_for_timeout(100)
                library.wait_for_function("() => Boolean(document.querySelector('#case-list')?.dataset.masonryAnchorEntryId)")
                anchor_id = library.locator("#case-list").get_attribute("data-masonry-anchor-entry-id")
                resize_anchor = next((item for item in visible_before_resize if item["entryId"] == anchor_id), None)
                assert resize_anchor, f"masonry selected a card that was not visible before resize: {anchor_id}"
                try:
                    library.wait_for_function(
                        """({entryId, targetY}) => {
                          const card = document.querySelector(`.case-card[data-entry-id='${entryId}']`);
                          return card && Math.abs(card.getBoundingClientRect().y - targetY) <= 4;
                        }""",
                        arg={"entryId": resize_anchor["entryId"], "targetY": resize_anchor["rect"]["y"]},
                        timeout=5_000,
                    )
                except PlaywrightTimeoutError as error:
                    anchor_diagnostic = library.locator(
                        f".case-card[data-entry-id='{resize_anchor['entryId']}']"
                    ).evaluate("""card => ({
                      y: card.getBoundingClientRect().y,
                      scrollY,
                      maxScrollY: document.documentElement.scrollHeight - innerHeight,
                      containerHeight: document.querySelector('#case-list')?.getBoundingClientRect().height,
                      anchorId: document.querySelector('#case-list')?.dataset.masonryAnchorEntryId
                    })""")
                    raise AssertionError(
                        f"masonry resize anchor did not settle: target={resize_anchor}, actual={anchor_diagnostic}"
                    ) from error
                resized_anchor = library.locator(
                    f".case-card[data-entry-id='{resize_anchor['entryId']}']"
                ).evaluate("""card => ({
                  y: card.getBoundingClientRect().y,
                  column: card.dataset.masonryColumn,
                  layoutTop: card.style.top,
                  scrollY,
                  maxScrollY: document.documentElement.scrollHeight - innerHeight
                })""")
                assert abs(resized_anchor["y"] - resize_anchor["rect"]["y"]) <= 4, (
                    f"visible card was not preserved across a real column-count change: "
                    f"{resize_anchor['entryId']} {resize_anchor} -> {resized_anchor}"
                )
                library.set_viewport_size({"width": 1280, "height": 900})
                library.wait_for_timeout(100)
                library.evaluate("scrollTo(0, 0)")

                library.locator(".case-card[data-entry-id='pending-2']").click()
                save_pending_classification(library)
                expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", "pending-2")
                expect(library.locator("#detail-drawer")).to_have_class("detail-drawer open")
                library.locator("#detail-close").click()

                library.locator("#pending-filter").check()
                library.locator(".case-card").first.click()
                expect(library.locator(".pending-classification-inline")).to_be_visible()
                library.screenshot(path="/tmp/prompt-director-132-pending-inline.png")
                first_id = library.locator("#detail-drawer").get_attribute("data-entry-id")
                save_pending_classification(library)
                expect(library.locator("#detail-drawer")).not_to_have_attribute("data-entry-id", first_id)
                expect(library.locator(".pending-classification-inline")).to_be_visible()
                save_pending_classification(library)
                expect(library.locator("#detail-drawer")).not_to_have_class("open")
                expect(library.locator("#feedback")).to_contain_text("待确认已处理完")

                library.locator("#create-collection").click()
                project_dialog = library.locator("#promptdirector-app-dialog")
                expect(project_dialog).to_be_visible()
                project_dialog.locator("input").fill("Campaign 132")
                project_dialog.get_by_role("button", name="新建", exact=True).click()
                expect(library.locator("#project-selection-title")).to_contain_text("Campaign 132")
                expect(library.locator("#share-bar")).to_be_hidden()
                expect(library.locator("#gallery-heading")).to_have_class("gallery-heading project-selection-mode")
                selection_geometry = library.evaluate(
                    """() => {
                      const topbar = document.querySelector('.topbar').getBoundingClientRect();
                      const toolbar = document.querySelector('#gallery-heading').getBoundingClientRect();
                      return {topbarBottom: topbar.bottom, toolbarTop: toolbar.top};
                    }"""
                )
                assert abs(selection_geometry["toolbarTop"] - selection_geometry["topbarBottom"]) <= 1, selection_geometry
                library.screenshot(path="/tmp/prompt-director-132-project-selection.png")
                library.locator("#search-input").fill("Prompt")
                wait_for_initial_gallery_batch(library, 103)
                library.locator(".case-card[data-entry-id='case-099']").click()
                selected_position = library.locator(".case-card[data-entry-id='case-099']").evaluate(
                    "card => { const rect = card.getBoundingClientRect(); return {x: rect.x + scrollX, y: rect.y + scrollY}; }"
                )
                library.locator("#load-more").click()
                expect(library.locator(".case-card[data-entry-id='case-099']")).to_have_class(
                    "case-card share-selectable selected-for-share"
                )
                selected_position_after_append = library.locator(".case-card[data-entry-id='case-099']").evaluate(
                    "card => { const rect = card.getBoundingClientRect(); return {x: rect.x + scrollX, y: rect.y + scrollY}; }"
                )
                assert abs(selected_position_after_append["x"] - selected_position["x"]) <= 1
                assert abs(selected_position_after_append["y"] - selected_position["y"]) <= 1
                library.locator(".case-card[data-entry-id='case-098']").click()
                library.locator("#project-selection-save").click()
                expect(library.locator("#feedback")).to_contain_text("项目案例已更新")
                expect(library.locator(".case-card")).to_have_count(2)

                project_row = library.locator(".project-row", has_text="Campaign 132")
                project_row.locator("summary").click()
                project_row.get_by_role("button", name="管理案例").click()
                library.locator("#search-input").fill("Prompt")
                expect(library.locator(".case-card.selected-for-share")).to_have_count(2)
                library.locator("#project-selection-cancel").click()

                library.locator("#create-collection").click()
                empty_project_dialog = library.locator("#promptdirector-app-dialog")
                expect(empty_project_dialog).to_be_visible()
                empty_project_dialog.locator("input").fill("Empty project")
                empty_project_dialog.get_by_role("button", name="新建", exact=True).click()
                library.locator("#project-selection-save").click()
                expect(library.get_by_role("button", name="从案例库添加案例")).to_be_visible()
                library.screenshot(path="/tmp/prompt-director-132-empty-project.png")
                library.get_by_role("button", name="从案例库添加案例").click()
                expect(library.locator("#project-selection-title")).to_contain_text("Empty project")
                resize_observer_errors = library.evaluate("window.__resizeObserverErrors")
                assert not resize_observer_errors, f"ResizeObserver runtime errors: {resize_observer_errors}"

                print("library_132_e2e=passed")
            finally:
                context.close()


if __name__ == "__main__":
    main()
