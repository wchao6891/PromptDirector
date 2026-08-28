from __future__ import annotations

import re

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, base_entry, extension_session


CHINESE = re.compile(r"[\u3400-\u9fff]")


def assert_no_visible_chinese(locator, state: str) -> None:
    lines = sorted({line.strip() for line in locator.inner_text().splitlines() if CHINESE.search(line)})
    assert not lines, (state, lines)


def assert_panel_contains_children(panel, state: str) -> None:
    geometry = panel.evaluate(
        """node => {
          const panelRect = node.getBoundingClientRect();
          const outside = [...node.querySelectorAll('*')]
            .filter(child => {
              const style = getComputedStyle(child);
              if (style.display === 'none' || style.visibility === 'hidden' || child.getClientRects().length === 0) return false;
              const rect = child.getBoundingClientRect();
              return rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1
                || rect.top < panelRect.top - 1 || rect.bottom > panelRect.bottom + 1;
            })
            .map(child => ({tag: child.tagName, text: child.textContent.trim().slice(0, 80), rect: child.getBoundingClientRect().toJSON()}));
          return {
            outside,
            panel: panelRect.toJSON(),
            viewport: innerWidth,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
          };
        }"""
    )
    assert not geometry["outside"], (state, geometry)
    assert geometry["panel"]["left"] >= -1 and geometry["panel"]["right"] <= geometry["viewport"] + 1, (state, geometry)
    assert geometry["pageOverflow"] <= 1, (state, geometry)


def main() -> None:
    entry = base_entry("english-video-case", "English video reference", "", "content:prompt:video")
    entry["mediaAssets"] = [{
        "id": "english-video",
        "kind": "video",
        "usage": "content",
        "storageMode": "reference",
        "sourceUrl": "https://www.youtube.com/watch?v=fixture",
        "sourceTitle": "English source video",
        "reviewStatus": "verified",
        "reference": {"url": "https://www.youtube.com/watch?v=fixture", "provider": "youtube", "playbackMode": "external"},
    }]
    entry["primaryMediaId"] = "english-video"
    project = {"id": "collection:english", "name": "English project", "order": 0, "entryIds": [entry["id"]], "visibility": "library"}
    import_job = {
        "version": 1,
        "items": [{
            "id": "import-job:english",
            "importBatchId": "import-job:english",
            "status": "completed",
            "createdAt": "2026-08-23T12:00:00.000Z",
            "updatedAt": "2026-08-23T12:00:01.000Z",
            "createdEntryIds": [entry["id"]],
            "items": [{
                "id": "import-item:english",
                "stagedAssetId": "staged:english",
                "status": "imported",
                "entryId": entry["id"],
            }],
        }],
    }

    with extension_session("prompt-director-english-states-", viewport={"width": 1440, "height": 900}) as session:
        setup = session.open_page("collector.html", wait_until="networkidle")
        session.seed_storage(setup, {
            "schemaVersion": 25,
            "entries": [entry],
            "organizerState": {"version": 6, "collections": [project]},
            "importJobs": import_job,
            "uiPreferences": {"locale": "en", "theme": "light", "motion": "reduced"},
            **ai_configuration_fixture(
                providers={
                    "openai": {
                        "apiKey": "english-ui-key",
                        "consent": True,
                        "models": {
                            "creativePlanning": "gpt-5-mini",
                            "imageAnalysis": "gpt-5-mini",
                            "imageGeneration": "gpt-5-mini",
                        },
                    },
                    "custom-media": {
                        "endpoint": "https://www.micuapi.ai/v1/responses",
                        "protocol": "responses",
                        "apiKey": "english-compatible-key",
                        "consent": True,
                        "models": {"imageAnalysis": "gpt-5.6-terra", "imageGeneration": "gpt-image-2"},
                        "imageGeneration": {
                            "protocol": "images_generations",
                            "endpoint": "https://www.micuapi.ai/v1/images/generations",
                            "editsEndpoint": "https://www.micuapi.ai/v1/images/edits",
                            "apiKey": "english-compatible-image-key",
                            "model": "gpt-image-2",
                        },
                    },
                },
                assignments={
                    "creativePlanning": {"providerId": "openai", "model": "gpt-5-mini"},
                    "imageAnalysis": {"providerId": "custom-media", "model": "gpt-5.6-terra"},
                    "imageGeneration": {"providerId": "custom-media", "model": "gpt-image-2"},
                },
            ),
        })
        setup.evaluate(
            """async () => {
              const skills = await import(chrome.runtime.getURL('creative-skills.js'));
              const created = skills.createCreativeSkill(skills.createCreativeSkillsState(), {
                callName: 'english-layout',
                description: 'An English-only composition method.',
                skillMarkdown: `# English layout\n\nKeep the subject hierarchy clear.`,
                source: 'generated'
              }, {id: 'skill:english', versionId: 'skill-version:english', now: '2026-08-23T12:00:00.000Z'});
              await chrome.storage.local.set({creativeSkills: created.state});
            }"""
        )

        library = session.open_page("library.html", wait_until="networkidle")

        library.locator("#add-menu > summary").click()
        library.locator("#add-quick-note").click()
        quick_note = library.locator("#promptdirector-app-dialog")
        expect(quick_note.get_by_role("heading")).to_have_text("Quick note")
        assert_no_visible_chinese(quick_note, "quick note dialog")
        quick_note.get_by_role("button", name="Cancel", exact=True).click()

        library.locator("#add-menu > summary").click()
        library.locator("#add-video-reference").click()
        video_link = library.locator("#promptdirector-app-dialog")
        expect(video_link.get_by_role("heading")).to_have_text("Add video link")
        assert_no_visible_chinese(video_link, "video link dialog")
        video_link.get_by_role("button", name="Cancel", exact=True).click()

        library.locator("#create-collection").click()
        new_project = library.locator("#promptdirector-app-dialog")
        expect(new_project.get_by_role("heading")).to_have_text("New project")
        assert_no_visible_chinese(new_project, "new project dialog")
        new_project.get_by_role("button", name="Cancel", exact=True).click()

        project_menu = library.locator(".project-row .project-menu").first
        library.set_viewport_size({"width": 390, "height": 800})
        library.locator("#toggle-filters").click()
        expect(library.locator("#filter-sidebar")).to_be_visible()
        project_menu.locator(":scope > summary").click()
        assert_no_visible_chinese(project_menu.locator(".project-menu-panel"), "project menu")
        assert_panel_contains_children(project_menu.locator(".project-menu-panel"), "project menu at 390px")
        project_menu.locator(":scope > summary").click()

        category_menu = library.locator(".content-filter-menu").first
        category_menu.locator(":scope > summary").click()
        assert_no_visible_chinese(category_menu.locator(".project-menu-panel"), "category menu")
        assert_panel_contains_children(category_menu.locator(".project-menu-panel"), "category menu at 390px")
        category_menu.locator(":scope > summary").click()

        library.set_viewport_size({"width": 1440, "height": 900})

        library.locator(f'.case-card[data-entry-id="{entry["id"]}"]').click()
        expect(library.locator("#detail-drawer")).to_have_class(re.compile(r"\bopen\b"))
        assert_no_visible_chinese(library.locator("#detail-drawer"), "case details")
        library.locator("#detail-close").click()

        library.locator("#add-menu > summary").click()
        library.locator("#add-media").click()
        expect(library.locator("#import-last-job")).to_be_visible()
        library.locator("#import-last-job").click()
        import_dialog = library.locator("#import-dialog")
        expect(import_dialog.locator("#import-job-title")).to_have_text("Import complete")
        assert_no_visible_chinese(import_dialog, "completed import job")
        library.locator("#import-close").click()

        composer = session.open_page("composer.html", wait_until="networkidle")
        composer.set_viewport_size({"width": 390, "height": 800})
        composer.locator("#composer-model-trigger").click()
        assert_no_visible_chinese(composer.locator("#composer-model-menu"), "composer model menu")
        expect(composer.locator("#composer-model-compatible-label")).to_contain_text("Micu")
        assert_panel_contains_children(composer.locator("#composer-model-menu"), "composer model menu at 390px")
        composer.locator("#composer-model-trigger").click()

        composer.set_viewport_size({"width": 1440, "height": 900})

        composer.locator("#composer-options > summary").click()
        expect(composer.locator("#composer-generation-settings")).to_be_visible()
        assert_no_visible_chinese(composer.locator("#composer-options"), "composer creation settings")
        composer.locator("#composer-options > summary").click()

        composer.locator("#composer-reference-open").click()
        composer.locator("#composer-reference-tab-skills").click()
        expect(composer.locator(".composer-skill-card")).to_have_count(1)
        assert_no_visible_chinese(composer.locator("#composer-reference-workspace"), "composer Skill references")

        print({"english_interaction_states": 10, "visible_chinese": False})


if __name__ == "__main__":
    main()
