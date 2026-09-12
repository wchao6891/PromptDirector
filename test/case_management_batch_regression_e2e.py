from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


def organizer_members(page) -> dict[str, list[str]]:
    return page.evaluate(
        """async () => Object.fromEntries(
          ((await chrome.storage.local.get('organizerState')).organizerState.collections || [])
            .map(collection => [collection.name, collection.entryIds])
        )"""
    )


def sweep(page, first, second) -> None:
    first_box = first.bounding_box()
    second_box = second.bounding_box()
    assert first_box and second_box
    first_point = (
        first_box["x"] + first_box["width"] / 2,
        first_box["y"] + first_box["height"] / 2,
    )
    second_point = (
        second_box["x"] + second_box["width"] / 2,
        second_box["y"] + second_box["height"] / 2,
    )
    page.mouse.move(*first_point)
    page.mouse.down()
    page.mouse.move(*second_point, steps=5)
    page.mouse.move(*first_point, steps=3)
    page.mouse.move(*second_point, steps=3)
    page.mouse.up()


def select_target(page, project_id: str) -> None:
    page.locator("#selection-project-menu > summary").click()
    page.locator("#selection-project-target").select_option(project_id)


def main() -> None:
    entries = [
        base_entry(
            f"batch-case-{index}",
            f"批量管理案例 {index}",
            f"用于验证拖动选择与项目移动的提示词 {index}",
            "content:prompt:text",
            index,
        )
        for index in range(10)
    ]
    source_id = "collection:source"
    retained_id = "collection:retained"
    target_id = "collection:target"
    organizer = {
        "version": 7,
        "collections": [
            {
                "id": source_id,
                "name": "来源项目",
                "order": 0,
                "entryIds": ["batch-case-0", "batch-case-1", "batch-case-2", "batch-case-3"],
                "visibility": "library",
            },
            {
                "id": retained_id,
                "name": "保留项目",
                "order": 1,
                "entryIds": ["batch-case-0", "batch-case-1", "batch-case-2", "batch-case-3", "batch-case-4"],
                "visibility": "library",
            },
            {
                "id": target_id,
                "name": "目标项目",
                "order": 2,
                "entryIds": ["batch-case-4"],
                "visibility": "library",
            },
        ],
    }

    with extension_session(
        "prompt-director-case-management-batch-",
        viewport={"width": 1280, "height": 760},
    ) as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {
            "schemaVersion": 28,
            "entries": entries,
            "organizerState": organizer,
            "uiPreferences": {"locale": "zh-CN", "theme": "dark", "motion": "reduced"},
        })
        library = session.open_page("library.html", wait_until="networkidle")
        expect(library.locator("#case-list > .case-card")).to_have_count(10)

        library.locator(".project-filter", has_text="来源项目").click()
        expect(library.locator("#case-list > .case-card")).to_have_count(4)
        library.locator("#select-cases").click()
        cards = library.locator("#case-list > .case-card")
        sweep(library, cards.nth(0), cards.nth(1))
        expect(library.locator(".case-card.selected-for-share")).to_have_count(2)
        expect(library.locator("#share-count")).to_have_text("已选 2")
        first_selection = library.locator(".case-card.selected-for-share").evaluate_all(
            "cards => cards.map(card => card.dataset.entryId)"
        )

        select_target(library, target_id)
        project_panel = library.locator(".selection-project-panel")
        panel_geometry = project_panel.evaluate(
            """panel => ({
              width: panel.getBoundingClientRect().width,
              overflow: panel.scrollWidth > panel.clientWidth,
              buttons: [...panel.querySelectorAll('.selection-project-actions button')]
                .filter(button => getComputedStyle(button).display !== 'none')
                .map(button => ({clientWidth: button.clientWidth, scrollWidth: button.scrollWidth}))
            })"""
        )
        assert panel_geometry["width"] >= 360, panel_geometry
        assert panel_geometry["overflow"] is False, panel_geometry
        assert len(panel_geometry["buttons"]) == 3, panel_geometry
        assert all(button["scrollWidth"] <= button["clientWidth"] for button in panel_geometry["buttons"]), panel_geometry
        library.locator("#selection-add-project").click()
        expect(library.locator("#feedback")).to_contain_text("加入项目")
        after_add = organizer_members(library)
        assert after_add["来源项目"] == ["batch-case-0", "batch-case-1", "batch-case-2", "batch-case-3"], after_add
        assert after_add["保留项目"] == ["batch-case-0", "batch-case-1", "batch-case-2", "batch-case-3", "batch-case-4"], after_add
        assert after_add["目标项目"] == ["batch-case-4", *first_selection], after_add

        library.locator("#select-cases").click()
        for entry_id in first_selection:
            library.locator(f'.case-card[data-entry-id="{entry_id}"]').click()
        select_target(library, target_id)
        library.locator("#selection-move-project").click()
        expect(library.locator("#feedback")).to_contain_text("移动到项目")
        after_move = organizer_members(library)
        remaining_source = [entry_id for entry_id in organizer["collections"][0]["entryIds"] if entry_id not in first_selection]
        assert after_move["来源项目"] == remaining_source, after_move
        assert after_move["保留项目"] == ["batch-case-0", "batch-case-1", "batch-case-2", "batch-case-3", "batch-case-4"], after_move
        assert after_move["目标项目"] == ["batch-case-4", *first_selection], after_move

        expect(library.locator("#case-list > .case-card")).to_have_count(2)
        library.locator("#select-cases").click()
        remaining_cards = library.locator("#case-list > .case-card")
        sweep(library, remaining_cards.nth(0), remaining_cards.nth(1))
        second_selection = library.locator(".case-card.selected-for-share").evaluate_all(
            "cards => cards.map(card => card.dataset.entryId)"
        )
        library.locator("#selection-project-menu > summary").click()
        library.locator("#selection-new-project").click()
        create_dialog = library.locator("#promptdirector-app-dialog")
        expect(create_dialog).to_be_visible()
        create_dialog.locator("input").fill("新建移动项目")
        create_dialog.get_by_role("button", name="新建并移动", exact=True).click()
        expect(library.locator("#feedback")).to_contain_text("已新建项目")
        after_create = organizer_members(library)
        assert after_create["来源项目"] == [], after_create
        assert after_create["新建移动项目"] == second_selection, after_create
        assert after_create["保留项目"] == ["batch-case-0", "batch-case-1", "batch-case-2", "batch-case-3", "batch-case-4"], after_create

        library.locator("#workspace-library").click()
        expect(library.locator("#case-list > .case-card")).to_have_count(10)
        library.locator("#select-cases").click()
        library.locator('.case-card[data-entry-id="batch-case-5"]').click()
        select_target(library, target_id)
        aggregate_panel = library.locator(".selection-project-panel")
        aggregate_geometry = aggregate_panel.evaluate(
            """panel => ({
              width: panel.getBoundingClientRect().width,
              overflow: panel.scrollWidth > panel.clientWidth,
              visibleActions: [...panel.querySelectorAll('.selection-project-actions button')]
                .filter(button => getComputedStyle(button).display !== 'none').length
            })"""
        )
        assert aggregate_geometry["width"] >= 360, aggregate_geometry
        assert aggregate_geometry["overflow"] is False, aggregate_geometry
        assert aggregate_geometry["visibleActions"] == 1, aggregate_geometry

        before_failure = organizer_members(library)
        library.evaluate(
            """() => {
              window.__caseManagementSendMessage = chrome.runtime.sendMessage;
              chrome.runtime.sendMessage = (message, ...rest) => message?.type === 'BATCH_SET_PROJECT'
                ? Promise.resolve({ok: false, message: '模拟项目写入失败'})
                : window.__caseManagementSendMessage.call(chrome.runtime, message, ...rest);
            }"""
        )
        library.locator("#selection-add-project").click()
        expect(library.locator("#feedback")).to_contain_text("模拟项目写入失败")
        assert organizer_members(library) == before_failure
        library.evaluate("() => { chrome.runtime.sendMessage = window.__caseManagementSendMessage; }")

        if not library.locator("#selection-clear").is_visible():
            library.locator("#selection-more-menu > summary").click()
        library.locator("#selection-clear").click()
        first = library.locator("#case-list > .case-card").first
        first_box = first.bounding_box()
        assert first_box
        pointer = {
            "pointerId": 81,
            "pointerType": "mouse",
            "button": 0,
            "clientX": first_box["x"] + first_box["width"] / 2,
            "clientY": first_box["y"] + first_box["height"] / 2,
        }
        first.dispatch_event("pointerdown", pointer)
        expect(library.locator(".case-card.selected-for-share")).to_have_count(1)
        first.dispatch_event(
            "pointercancel",
            pointer,
        )
        expect(library.locator("#case-list")).not_to_have_class("is-selection-sweeping")
        expect(library.locator(".case-card.selected-for-share")).to_have_count(1)
        last = library.locator("#case-list > .case-card").last
        last.scroll_into_view_if_needed()
        last.click()
        expect(library.locator(".case-card.selected-for-share")).to_have_count(2)
        expect(library.locator("#share-count")).to_have_text("已选 2")

        print({
            "sweep_select_and_cancel": True,
            "batch_add": after_add,
            "batch_move": after_move,
            "create_and_move": after_create,
            "aggregate_count": 10,
            "failed_write_unchanged": True,
            "project_panel": panel_geometry,
            "aggregate_panel": aggregate_geometry,
        })


if __name__ == "__main__":
    main()
