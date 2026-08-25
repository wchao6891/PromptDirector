from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


EXTENSION_DIR = Path(__file__).resolve().parents[1]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="prompt-director-large-") as profile_dir:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile_dir,
                headless=True,
                channel="chromium",
                viewport={"width": 1666, "height": 900},
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
                setup.evaluate(
                    """async () => {
                      const [{createDefaultTaxonomy, SCHEMA_VERSION}, {createDefaultFacetCatalog}, {createDefaultOrganizerState}] = await Promise.all([
                        import(chrome.runtime.getURL('taxonomy.js')),
                        import(chrome.runtime.getURL('facets.js')),
                        import(chrome.runtime.getURL('organizer.js'))
                      ]);
                      const entries = Array.from({length: 6500}, (_, index) => {
                        const caseId = `large-${String(index).padStart(5, '0')}`;
                        const visualId = `visual-${caseId}`;
                        const width = 720 + (index % 5) * 120;
                        const height = 720 + (index % 7) * 150;
                        return {
                          schemaVersion: SCHEMA_VERSION,
                          id: caseId,
                          text: `Large library prompt ${index}`,
                          textRevision: index ? 1 : 2,
                          title: `Large case ${String(index).padStart(5, '0')}`,
                          url: '',
                          savedAt: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString(),
                          classification: {pathIds: ['content:image-case'], status: 'confirmed', source: 'manual'},
                          mediaAssets: [{
                            id: visualId,
                            kind: 'image',
                            usage: 'content',
                            storageMode: 'managed',
                            mimeType: 'image/webp',
                            width,
                            height,
                            byteSize: 420000
                          }],
                          primaryMediaId: visualId,
                          analysisMeta: {textRevision: 1, promptVersion: 1, model: 'existing'},
                          facetAssignments: [{
                            facetId: 'style', nodeId: `large-style-${index % 400}`,
                            source: index ? 'deepseek_text' : 'manual', status: 'confirmed'
                          }],
                          analysisCandidates: [],
                          analysisBreakdown: [],
                          customLabels: []
                        };
                      });
                      const facetCatalog = createDefaultFacetCatalog();
                      facetCatalog.nodes.push(...Array.from({length: 400}, (_, index) => ({
                        id: `large-style-${index}`, name: `Large style ${index}`, facetId: 'style',
                        parentId: 'style.render', order: index, aliases: [], patterns: [],
                        status: 'active', kind: 'detail', origin: 'manual', fixed: false, protected: false
                      })));
                      await chrome.storage.local.clear();
                      await chrome.storage.local.set({
                        schemaVersion: SCHEMA_VERSION,
                        entries,
                        taxonomy: createDefaultTaxonomy(),
                        facetCatalog,
                        organizerState: createDefaultOrganizerState(),
                        trashState: {version: 1, items: []},
                        compoundCases: [],
                        classificationRules: []
                      });
                    }"""
                )

                library = context.new_page()
                library.add_init_script(
                    r"""() => {
                      window.__resizeObserverErrors = [];
                      addEventListener('error', (event) => {
                        if (String(event.message).includes('ResizeObserver loop')) {
                          window.__resizeObserverErrors.push(event.message);
                        }
                      });
                    }"""
                )
                started = time.perf_counter()
                library.goto(f"chrome-extension://{extension_id}/library.html")
                library.wait_for_selector("body[data-library-state='ready']", timeout=10_000)
                library.wait_for_function("document.querySelectorAll('.case-card').length >= 24")
                ready_ms = round((time.perf_counter() - started) * 1000)
                assert ready_ms < 5_000, f"6500-case first usable paint took {ready_ms}ms"

                analysis_requests = []

                def mock_analysis(route) -> None:
                    analysis_requests.append(route.request.post_data_json)
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps({
                            "model": "isolated-e2e",
                            "choices": [{
                                "finish_reason": "stop",
                                "message": {"content": json.dumps({
                                    "tags": [{"g": "style.render", "t": "赛璐珞"}],
                                }, ensure_ascii=False)},
                            }],
                            "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14},
                        }, ensure_ascii=False),
                    )

                context.route("https://api.deepseek.com/**", mock_analysis)
                batch = library.evaluate(
                    """async () => {
                      const {createAnalysisBatchJob, claimAnalysisItems} = await import(chrome.runtime.getURL('analysis-batch.js'));
                      const payloadJob = await createAnalysisBatchJob([{id: 'payload-check', text: 'payload check'}], {concurrency: 20});
                      const payloadClaimed = claimAnalysisItems(payloadJob, 1, () => 'payload-claim');
                      const payloadItem = payloadClaimed.claims[0];
                      await chrome.runtime.sendMessage({
                        type: 'UPDATE_AI_PROVIDER_CONFIGURATION',
                        registry: {providers: {deepseek: {
                          apiKey: 'isolated-e2e-key',
                          consent: true,
                          models: {textTags: 'isolated-e2e'}
                        }}},
                        assignments: {textTags: {providerId: 'deepseek', model: 'isolated-e2e'}}
                      });
                      const created = await chrome.runtime.sendMessage({type: 'CREATE_ANALYSIS_BATCH'});
                      let completed = created.analysisBatchJob;
                      for (let index = 0; index < 120 && ['running', 'paused'].includes(completed.status); index += 1) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                        completed = (await chrome.runtime.sendMessage({
                          type: 'GET_ANALYSIS_BATCH_STATUS',
                          jobId: created.analysisBatchJob.id
                        })).analysisBatchJob;
                      }
                      const stored = await chrome.storage.local.get(['entries', 'facetCatalog']);
                      const savedEntry = stored.entries.find(item => item.id === 'large-00000');
                      const savedNodeIds = new Set(savedEntry.facetAssignments.filter(item => item.source === 'deepseek_text').map(item => item.nodeId));
                      return {
                        createdTotal: created.analysisBatchJob.total,
                        claimCount: payloadClaimed.claims.length,
                        claimHasEntry: Object.hasOwn(payloadItem, 'entry'),
                        claimHasCatalog: Object.hasOwn(payloadClaimed, 'facetCatalog'),
                        completedStatus: completed.status,
                        savedTag: stored.facetCatalog.nodes.some(item => savedNodeIds.has(item.id) && item.name === '赛璐珞')
                      };
                    }"""
                )
                assert batch == {
                    "createdTotal": 1,
                    "claimCount": 1,
                    "claimHasEntry": False,
                    "claimHasCatalog": False,
                    "completedStatus": "completed",
                    "savedTag": True,
                }, batch
                assert len(analysis_requests) == 1, analysis_requests

                style_facet = library.locator('.facet-filter[data-facet-id="style"]')
                style_facet.locator("summary").click()
                style_category = style_facet.locator('[data-facet-node-id="style.render"]')
                started = time.perf_counter()
                style_category.click()
                tag_filter_ms = round((time.perf_counter() - started) * 1000)
                assert style_category.get_attribute("aria-pressed") == "true"
                assert "6500" in library.locator("#result-count").inner_text()
                assert tag_filter_ms < 250, f"6500-case tag category switch took {tag_filter_ms}ms"
                style_category.click()

                browse_wall = wall_geometry(library)
                assert_wall_transition_stable(library, sample_wall_transition(library, "#select-cases"))
                assert_wall_stable(library, browse_wall, wall_geometry(library))
                assert library.locator("#result-count").is_hidden()
                assert library.locator("#gallery-view-controls").is_hidden()
                assert library.locator("#share-count").inner_text() == "已选 0"
                assert library.locator("#selection-select-filtered").inner_text() == "全选当前（6500）"
                assert_wall_transition_stable(library, sample_wall_transition(library, "#share-cancel"))
                assert_wall_stable(library, browse_wall, wall_geometry(library))
                assert_wall_transition_stable(library, sample_wall_transition(library, "#select-cases"))
                assert_wall_stable(library, browse_wall, wall_geometry(library))
                library.locator("#selection-select-filtered").click()
                assert library.locator("#share-count").inner_text() == "已选 6500"
                assert library.locator("#selection-clear").is_enabled()
                library.set_viewport_size({"width": 390, "height": 844})
                library.wait_for_function(
                    "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth",
                    timeout=2_000,
                )
                selection_mobile = library.evaluate(
                    """() => {
                      const bar = document.querySelector('#share-bar').getBoundingClientRect();
                      const count = document.querySelector('#share-count').getBoundingClientRect();
                      return {
                        barLeft: bar.left,
                        barRight: bar.right,
                        countTop: count.top,
                        countBottom: count.bottom,
                        viewport: innerWidth,
                        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                        overflowWidth: document.documentElement.scrollWidth,
                        offenders: [...document.querySelectorAll('body *')].filter((element) => {
                          const rect = element.getBoundingClientRect();
                          return rect.right > innerWidth + 0.5 || rect.left < -0.5;
                        }).slice(0, 8).map((element) => ({
                          id: element.id,
                          className: String(element.className || ''),
                          left: element.getBoundingClientRect().left,
                          right: element.getBoundingClientRect().right
                        }))
                      };
                    }"""
                )
                assert selection_mobile["barLeft"] >= 0 and selection_mobile["barRight"] <= selection_mobile["viewport"], selection_mobile
                assert selection_mobile["overflow"] is False, selection_mobile
                library.set_viewport_size({"width": 1666, "height": 900})
                library.locator("#selection-clear").click()
                assert library.locator("#share-count").inner_text() == "已选 0"
                library.locator("#share-cancel").click()
                settle_layout(library)
                post_resize_wall = wall_geometry(library)
                assert_columns_fill_width(library)
                library.locator("#select-cases").click()
                settle_layout(library)
                assert_wall_stable(library, post_resize_wall, wall_geometry(library))
                library.locator("#share-cancel").click()
                settle_layout(library)
                assert_wall_stable(library, post_resize_wall, wall_geometry(library))

                for width in (1666, 1440, 900, 640, 390):
                    library.set_viewport_size({"width": width, "height": 900 if width > 390 else 844})
                    settle_layout(library)
                    assert_columns_fill_width(library)
                library.set_viewport_size({"width": 1666, "height": 900})
                settle_layout(library)
                before_toggle = library.evaluate("document.querySelectorAll('.case-card').length")
                library.locator("#toggle-filters").click()
                library.wait_for_timeout(260)
                assert_columns_fill_width(library)
                assert library.evaluate("document.querySelectorAll('.case-card').length") >= before_toggle

                stable_positions = library.evaluate(
                    """() => Object.fromEntries([...document.querySelectorAll('.case-card')].slice(0, 12).map((card) => {
                      const rect = card.getBoundingClientRect();
                      return [card.dataset.entryId, {x: Math.round(rect.left + scrollX), y: Math.round(rect.top + scrollY)}];
                    }))"""
                )
                before_scroll = library.evaluate("document.querySelectorAll('.case-card').length")
                scroll_distance = library.evaluate(
                    """() => document.querySelector('#load-sentinel').getBoundingClientRect().top - innerHeight / 2"""
                )
                library.mouse.wheel(0, scroll_distance)
                try:
                    library.wait_for_function(
                        "before => document.querySelectorAll('.case-card').length > before",
                        arg=before_scroll,
                        timeout=5_000,
                    )
                except PlaywrightTimeoutError as error:
                    diagnostic = library.evaluate(
                        """() => {
                          const sentinel = document.querySelector('#load-sentinel').getBoundingClientRect();
                          const list = document.querySelector('#case-list').getBoundingClientRect();
                          return {
                            rendered: document.querySelectorAll('.case-card').length,
                            scrollY,
                            scrollHeight: document.documentElement.scrollHeight,
                            innerHeight,
                            sentinelTop: sentinel.top,
                            listBottom: list.bottom
                          };
                        }"""
                    )
                    raise AssertionError(f"gallery did not append near its loading edge: {diagnostic}") from error
                library.wait_for_function(
                    "document.querySelector('#load-sentinel').getBoundingClientRect().top >= innerHeight",
                    timeout=5_000,
                )
                after_positions = library.evaluate(
                    """() => Object.fromEntries([...document.querySelectorAll('.case-card')].slice(0, 12).map((card) => {
                      const rect = card.getBoundingClientRect();
                      return [card.dataset.entryId, {x: Math.round(rect.left + scrollX), y: Math.round(rect.top + scrollY)}];
                    }))"""
                )
                assert stable_positions == after_positions, "existing cards moved while later batches were appended"
                assert not library.evaluate("window.__resizeObserverErrors")
                print(f"large_library_e2e=passed ready_ms={ready_ms} tag_filter_ms={tag_filter_ms} rendered={library.evaluate('document.querySelectorAll(\".case-card\").length')}")
            finally:
                context.close()


def assert_columns_fill_width(page) -> None:
    geometry = page.evaluate(
        """() => {
          const container = document.querySelector('#case-list');
          const styles = getComputedStyle(container);
          const rect = container.getBoundingClientRect();
          const minimum = parseFloat(styles.getPropertyValue('--masonry-card-min-width'));
          const gap = parseFloat(styles.getPropertyValue('--masonry-gap'));
          const cards = [...container.querySelectorAll(':scope > .case-card')];
          const lefts = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left)))].sort((a, b) => a - b);
          const left = Math.min(...cards.map((card) => card.getBoundingClientRect().left));
          const right = Math.max(...cards.map((card) => card.getBoundingClientRect().right));
          return {
            expected: Math.max(1, Math.floor((rect.width + gap) / (minimum + gap))),
            actual: lefts.length,
            leftGap: rect.left - left,
            rightGap: rect.right - right,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            outOfBounds: cards.some(card => {
              const cardRect = card.getBoundingClientRect();
              return cardRect.left < rect.left - 1 || cardRect.right > rect.right + 1;
            })
          };
        }"""
    )
    assert geometry["actual"] == geometry["expected"], geometry
    assert abs(geometry["leftGap"]) <= 1 and abs(geometry["rightGap"]) <= 1, geometry
    assert geometry["overflow"] is False and geometry["outOfBounds"] is False, geometry


def settle_layout(page) -> None:
    page.evaluate(
        """() => new Promise(resolve => requestAnimationFrame(
          () => requestAnimationFrame(() => resolve())
        ))"""
    )


def sample_wall_transition(page, selector: str) -> list[dict]:
    return page.evaluate(
        """selector => new Promise(resolve => {
          const capture = () => ({
            scrollY,
            cards: Object.fromEntries([...document.querySelectorAll('#case-list > .case-card')].map(card => {
              const rect = card.getBoundingClientRect();
              return [card.dataset.entryId, {left: rect.left, top: rect.top, width: rect.width}];
            }))
          });
          const samples = [capture()];
          document.querySelector(selector).click();
          samples.push(capture());
          requestAnimationFrame(() => {
            samples.push(capture());
            requestAnimationFrame(() => {
              samples.push(capture());
              resolve(samples);
            });
          });
        })""",
        selector,
    )


def assert_wall_transition_stable(page, samples: list[dict]) -> None:
    reference = samples[0]
    for current in samples[1:]:
        assert abs(current["scrollY"] - reference["scrollY"]) <= 1, samples
        shared = reference["cards"].keys() & current["cards"].keys()
        assert shared, samples
        drift = [
            current["cards"][entry_id][key] - reference["cards"][entry_id][key]
            for entry_id in shared
            for key in ("left", "top", "width")
        ]
        assert max(abs(delta) for delta in drift) <= 1, samples
    assert_columns_fill_width(page)


def wall_geometry(page) -> dict:
    return page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll('#case-list > .case-card')].map(card => {
          const rect = card.getBoundingClientRect();
          return [card.dataset.entryId, {left: rect.left, top: rect.top, width: rect.width}];
        }))"""
    )


def assert_wall_stable(page, reference: dict, current: dict) -> None:
    shared = reference.keys() & current.keys()
    assert shared, {"reference": reference, "current": current}
    drift = {
        entry_id: {
            key: current[entry_id][key] - reference[entry_id][key]
            for key in ("left", "top", "width")
        }
        for entry_id in shared
    }
    assert max(abs(delta) for values in drift.values() for delta in values.values()) <= 1, drift
    assert_columns_fill_width(page)


if __name__ == "__main__":
    main()
