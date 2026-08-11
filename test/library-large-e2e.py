from __future__ import annotations

import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


EXTENSION_DIR = Path(__file__).resolve().parents[1]
ENTRY_COUNT = 6_000


def make_entries() -> list[dict]:
    return [
        {
            "schemaVersion": 22,
            "id": f"large-case-{index:05d}",
            "text": "",
            "title": f"Imported image {index:05d}.webp",
            "url": "",
            "savedAt": f"2026-08-01T{index % 24:02d}:{index % 60:02d}:{index % 60:02d}.000Z",
            "classification": {
                "pathIds": ["content:image-case"],
                "status": "confirmed",
                "source": "local_import",
                "reason": "local image",
                "classifierVersion": 3,
            },
            "mediaAssets": ([None] if index % 257 == 0 else []) + [
                {
                    "id": f"large-asset-{index:05d}",
                    "kind": "image",
                    "usage": "content",
                    "storageMode": "managed",
                    "mimeType": "image/webp",
                    "byteSize": 360_000,
                    "width": 1280,
                    "height": 720,
                    "sourceTitle": f"Imported image {index:05d}.webp",
                    "capturedAt": "2026-08-01T10:00:00.000Z",
                    "playbackCapability": "unknown",
                    "reviewStatus": "verified",
                }
            ],
            "primaryMediaId": f"large-asset-{index:05d}",
            "timeNotes": [],
            "customLabels": [],
            "facetAssignments": [{
                "facetId": "facet:large",
                "nodeId": f"node:{index % 400}",
                "source": "manual",
                "status": "confirmed",
            }],
            "analysisCandidates": [],
            "analysisBreakdown": [],
            "rejectedCandidateKeys": [],
            "negativeTerms": [],
            "legacyFacetCandidates": [],
            "analysisPending": False,
        }
        for index in range(ENTRY_COUNT)
    ]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="prompt-director-large-") as profile_dir:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile_dir,
                headless=True,
                channel="chromium",
                viewport={"width": 1280, "height": 900},
                args=[
                    f"--disable-extensions-except={EXTENSION_DIR}",
                    f"--load-extension={EXTENSION_DIR}",
                ],
            )
            try:
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                extension_id = worker.url.split("/")[2]
                setup = context.new_page()
                setup.goto(f"chrome-extension://{extension_id}/collector.html")
                setup.evaluate("async () => { await chrome.storage.local.clear(); await chrome.runtime.sendMessage({type: 'GET_STATE'}); }")
                entries = make_entries()
                setup.evaluate(
                    """async ({entries}) => {
                      const facetCatalog = {
                        version: 2,
                        revision: 1,
                        facets: [{
                          id: 'facet:large', name: 'Large vocabulary', color: '#65736d',
                          order: 0, aliases: [], status: 'active'
                        }],
                        nodes: Array.from({length: 400}, (_, index) => ({
                          id: `node:${index}`, name: `Tag ${index}`, facetId: 'facet:large',
                          parentId: null, order: index, aliases: [], patterns: [], status: 'active'
                        }))
                      };
                      await chrome.storage.local.set({
                        entries,
                        facetCatalog,
                        organizerState: {
                          version: 4,
                          collections: [{
                            id: 'collection:large',
                            name: 'Large import',
                            order: 0,
                            entryIds: entries.map((entry) => entry.id),
                          }]
                        }
                      });
                    }""",
                    {"entries": entries},
                )

                library = context.new_page()
                page_errors: list[str] = []
                library.on("pageerror", lambda error: page_errors.append(
                    f"{error}\n{getattr(error, 'stack', '')}"
                ))
                started = time.perf_counter()
                library.goto(f"chrome-extension://{extension_id}/library.html", wait_until="domcontentloaded")
                try:
                    library.locator("body[data-library-state='ready']").wait_for(timeout=10_000)
                except Exception as error:
                    raise AssertionError(f"library never became ready; page errors: {page_errors}") from error
                first_ready_ms = (time.perf_counter() - started) * 1000
                initial_card_ids = library.locator(".case-card").evaluate_all(
                    "cards => cards.map((card) => card.dataset.entryId)"
                )
                assert 24 <= len(initial_card_ids) <= 96, len(initial_card_ids)
                assert len(initial_card_ids) == len(set(initial_card_ids)), initial_card_ids

                library.locator("#open-settings").click()
                library.locator('[data-settings-tab="tasks"]').click()
                started = time.perf_counter()
                library.locator("#preview-analysis-batch").click()
                library.locator("#analysis-batch-summary").filter(has_text="没有需要分析的案例").wait_for(timeout=60_000)
                text_preview_ms = (time.perf_counter() - started) * 1000
                library.locator("#settings-close").click()

                project = library.locator("#collection-filters .project-filter").filter(has_text="Large import")
                started = time.perf_counter()
                project.click()
                expect(project).to_have_attribute("aria-pressed", "true")
                expect(library.locator("#active-filter-badge")).to_have_text("筛选 1")
                project_switch_ms = (time.perf_counter() - started) * 1000

                project_menu = library.locator("#collection-filters details.project-menu")
                project_menu.locator("summary").click()
                started = time.perf_counter()
                project_menu.get_by_role("button", name="批量分析画面").click()
                library.locator("#project-selection-title").filter(has_text="批量分析画面").wait_for(timeout=60_000)
                expect(library.locator("#project-selection-count")).to_contain_text("已选 0")
                vision_selection_ms = (time.perf_counter() - started) * 1000
                assert library.locator("#project-selection-save").is_disabled()

                library.locator(".case-card").first.click()

                started = time.perf_counter()
                library.locator("#project-selection-save").click()
                library.locator("#vision-batch-dialog").wait_for(state="visible", timeout=60_000)
                vision_preview_ms = (time.perf_counter() - started) * 1000

                print({
                    "first_ready_ms": round(first_ready_ms, 1),
                    "project_switch_ms": round(project_switch_ms, 1),
                    "text_preview_ms": round(text_preview_ms, 1),
                    "vision_selection_ms": round(vision_selection_ms, 1),
                    "vision_preview_ms": round(vision_preview_ms, 1),
                })

                assert first_ready_ms < 1_000, f"6000-case first paint took {first_ready_ms:.1f}ms"
                assert project_switch_ms < 250, f"6000-case project switch took {project_switch_ms:.1f}ms"
                assert text_preview_ms < 500, f"6000-case incremental text preview took {text_preview_ms:.1f}ms"
                assert vision_selection_ms < 250, f"6000-case vision selection took {vision_selection_ms:.1f}ms"
                assert vision_preview_ms < 500, f"6000-case vision preview took {vision_preview_ms:.1f}ms"
            finally:
                context.close()


if __name__ == "__main__":
    main()
