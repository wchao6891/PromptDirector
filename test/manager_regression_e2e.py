from __future__ import annotations

import tempfile
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from e2e_support import launch_context


EXTENSION_DIR = Path(__file__).resolve().parents[1]
NODE_COUNT = int(os.environ.get("MANAGER_NODE_COUNT", "275"))


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="prompt-manager-regression-") as profile_dir:
        with sync_playwright() as playwright:
            context = launch_context(
                playwright, profile_dir,
                viewport={"width": 1280, "height": 800},
                accept_downloads=True,
                extension_dir=EXTENSION_DIR,
            )
            try:
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                extension_id = worker.url.split("/")[2]
                page = context.new_page()
                page_errors = []
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.goto(f"chrome-extension://{extension_id}/library.html")
                expect(page.locator("#result-count")).to_have_text("0 个案例", timeout=1500)
                page.evaluate(
                    """async (nodeCount) => {
                      const {SCHEMA_VERSION, createDefaultTaxonomy} = await import(chrome.runtime.getURL('taxonomy.js'));
                      const {createFixedFacetCatalog} = await import(chrome.runtime.getURL('tag-taxonomy.js'));
                      const entries = Array.from({length: 43}, (_, index) => ({
                        schemaVersion: SCHEMA_VERSION,
                        id: `case-${index}`,
                        title: `Case ${index}`,
                        text: `tracking shot ${index}`,
                        url: `https://example.com/${index}`,
                        savedAt: '2026-07-19T00:00:00.000Z',
                        classification: {pathIds: ['content:prompt:image'], status: 'confirmed', source: 'manual'},
                        facetAssignments: [{
                          facetId: 'camera', nodeId: `detail:camera.lens:e2e-${index % nodeCount}`,
                          status: 'confirmed', source: 'manual'
                        }]
                      }));
                      const nodes = Array.from({length: nodeCount}, (_, index) => ({
                        id: `detail:camera.lens:e2e-${index}`,
                        name: `Camera tag ${index}`,
                        facetId: 'camera',
                        parentId: 'camera.lens',
                        order: index,
                        aliases: [], patterns: [], status: 'active',
                        kind: 'detail', origin: 'manual', fixed: false
                      }));
                      const facetCatalog = createFixedFacetCatalog();
                      facetCatalog.nodes.push(...nodes);
                      facetCatalog.revision += nodes.length;
                      await chrome.storage.local.set({
                        schemaVersion: SCHEMA_VERSION,
                        entries,
                        compoundCases: [],
                        taxonomy: createDefaultTaxonomy(),
                        classificationRules: [],
                        organizerState: {collections: []},
                        facetCatalog
                      });
                    }""",
                    NODE_COUNT,
                )
                page.reload()
                page.wait_for_load_state("networkidle")
                expect(page.locator("#result-count")).to_have_text("43 个案例", timeout=1500)
                started = page.evaluate("performance.now()")
                page.locator("#manage-facets").click(timeout=1500)
                page.locator("#manager-dialog").wait_for(state="visible", timeout=1500)
                elapsed = page.evaluate("performance.now()") - started
                assert page.locator("#manager-close").is_enabled()
                assert elapsed < 1200, f"整理词库打开耗时 {elapsed:.0f}ms"
                page.get_by_role("button", name="标签导航", exact=True).click()
                page.locator("#vocabulary-facet").select_option("camera")
                migrated_node_count = page.locator(".vocabulary-children .vocabulary-node").count()
                assert migrated_node_count == NODE_COUNT, f"镜头维度迁移后有 {migrated_node_count}/{NODE_COUNT} 个三级标签"
                edit_started = page.evaluate("performance.now()")
                page.locator(".vocabulary-node summary").first.click(timeout=1000)
                page.locator(".vocabulary-node .node-actions").first.wait_for(state="visible", timeout=1000)
                edit_elapsed = page.evaluate("performance.now()") - edit_started
                assert edit_elapsed < 800, f"标签编辑器展开耗时 {edit_elapsed:.0f}ms"
                assert not page_errors, f"分类管理页发生运行时错误: {page_errors}"
                print(f"manager_regression=passed open_ms={elapsed:.0f} edit_ms={edit_elapsed:.0f}")
            finally:
                context.close()


if __name__ == "__main__":
    main()
