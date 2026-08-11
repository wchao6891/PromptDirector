from __future__ import annotations

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
                      const [{createDefaultTaxonomy}, {createDefaultFacetCatalog}, {createDefaultOrganizerState}] = await Promise.all([
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
                          schemaVersion: 22,
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
                            source: 'manual', status: 'confirmed'
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
                        schemaVersion: 22,
                        entries,
                        taxonomy: createDefaultTaxonomy(),
                        facetCatalog,
                        organizerState: createDefaultOrganizerState(),
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

                batch = library.evaluate(
                    """async () => {
                      await chrome.runtime.sendMessage({
                        type: 'UPDATE_AI_SETTINGS',
                        settings: {apiKey: 'isolated-e2e-key', consent: true}
                      });
                      const created = await chrome.runtime.sendMessage({type: 'CREATE_ANALYSIS_BATCH'});
                      const claimed = await chrome.runtime.sendMessage({
                        type: 'CLAIM_ANALYSIS_ITEMS',
                        jobId: created.analysisBatchJob.id
                      });
                      const item = claimed.claims[0];
                      const committed = await chrome.runtime.sendMessage({
                        type: 'COMMIT_ANALYSIS_ITEMS',
                        jobId: created.analysisBatchJob.id,
                        results: [{
                          entryId: item.entryId,
                          claimId: item.claimId,
                          textRevision: item.textRevision,
                          tags: [{g: 'style.render', t: '赛璐珞'}],
                          usage: {},
                          model: 'isolated-e2e'
                        }]
                      });
                      return {
                        createdTotal: created.analysisBatchJob.total,
                        claimCount: claimed.claims.length,
                        claimHasEntry: Object.hasOwn(item, 'entry'),
                        claimHasCatalog: Object.hasOwn(claimed, 'facetCatalog'),
                        completedStatus: committed.analysisBatchJob.status
                      };
                    }"""
                )
                assert batch == {
                    "createdTotal": 1,
                    "claimCount": 1,
                    "claimHasEntry": False,
                    "claimHasCatalog": False,
                    "completedStatus": "completed",
                }, batch

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

                assert_columns_fill_width(library)
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
          const right = Math.max(...cards.map((card) => card.getBoundingClientRect().right));
          return {
            expected: Math.max(1, Math.floor((rect.width + gap) / (minimum + gap))),
            actual: lefts.length,
            rightGap: Math.round(rect.right - right)
          };
        }"""
    )
    assert geometry["actual"] == geometry["expected"], geometry
    assert abs(geometry["rightGap"]) <= 2, geometry


if __name__ == "__main__":
    main()
