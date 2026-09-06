from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


def main() -> None:
    entries = [base_entry(
        f"browse-{index:03d}", f"浏览参考 {index:03d}",
        f"雨夜创作参考 {index:03d}。保留画面、人物和场景。", "content:prompt:image", index % 60
    ) for index in range(180)]
    project_id = "collection:browse"
    with extension_session("prompt-director-browse-return-", viewport={"width": 1000, "height": 700}) as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {
            "schemaVersion": 28, "entries": entries,
            "organizerState": {"version": 1, "collections": [{
                "id": project_id, "name": "浏览项目", "entryIds": [entry["id"] for entry in entries[:84]],
                "parentId": None, "order": 0, "visibility": "library"
            }]}
        })
        library = session.open_page("library.html", wait_until="networkidle")
        for unassigned in [True, False]:
            if unassigned:
                library.locator("#workspace-unassigned").click()
            else:
                library.locator(f'[data-collection-id="{project_id}"] .project-filter').click()
            library.locator("#search-input").fill("雨夜")
            library.locator("#gallery-sort").select_option("title")
            # Scroll to a case beyond the first batch, not just within the initial viewport.
            while library.locator("#case-list > .case-card").count() <= 60:
                previous = library.locator("#case-list > .case-card").count()
                library.locator("#case-list > .case-card").last.scroll_into_view_if_needed()
                library.wait_for_function("count => document.querySelectorAll('#case-list > .case-card').length > count", arg=previous)
            library.locator("#case-list > .case-card").nth(60).scroll_into_view_if_needed()
            library.wait_for_function("scrollY > innerHeight")
            library.locator("#start-compose").click()
            library.wait_for_url("**/composer.html*")
            saved = library.evaluate("JSON.parse(sessionStorage.getItem('promptDirector.libraryReturn'))")
            assert saved["scrollY"] > 700, saved
            library.locator(".composer-library-exit").click()
            library.wait_for_url("**/library.html")
            expect(library.locator("#workspace-unassigned")).to_have_attribute("aria-current", "page" if unassigned else "false")
            expect(library.locator("#library-title")).to_have_text("未归项目" if unassigned else "浏览项目")
            expect(library.locator("#search-input")).to_have_value("雨夜")
            expect(library.locator("#gallery-sort")).to_have_value("title")
            library.wait_for_function("target => Math.abs(scrollY - target) <= 2", arg=saved["scrollY"])
            assert library.locator("#case-list > .case-card").count() > 24

        # A project deleted while away must resolve to the library, not a phantom project.
        library.locator("#start-compose").click()
        library.wait_for_url("**/composer.html*")
        await_result = library.evaluate("""async () => {
          const {organizerState} = await chrome.storage.local.get('organizerState');
          await chrome.storage.local.set({organizerState: {...organizerState, collections: []}});
          return true;
        }""")
        assert await_result is True
        library.locator(".composer-library-exit").click()
        library.wait_for_url("**/library.html")
        expect(library.locator("#workspace-library")).to_have_attribute("aria-current", "page")
        expect(library.locator("#workspace-unassigned")).to_have_attribute("aria-current", "false")
        expect(library.locator("#search-input")).to_have_value("雨夜")
        print({"unassigned_return": True, "project_return": True, "deep_scroll_return": True, "deleted_project_return": True})


if __name__ == "__main__":
    main()
