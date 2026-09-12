from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, base_entry, extension_session, wait_for_async_condition


def main() -> None:
    extension_version = json.loads((Path(__file__).resolve().parents[1] / "extension" / "manifest.json").read_text())["version"]
    entry = base_entry(
        "diagnostic-analysis",
        "诊断分析",
        "雾中庭院，中央构图，柔和逆光。",
        "content:prompt:image",
    )
    with extension_session("prompt-director-analysis-diagnostics-") as session:
        setup = session.open_page("collector.html")
        session.seed_storage(
            setup,
            {
                "schemaVersion": 24,
                "entries": [entry],
                **ai_configuration_fixture(
                    providers={"deepseek": {"apiKey": "analysis-fixture-key", "consent": True,
                        "models": {"textTags": "deepseek-v4-flash"}}},
                    assignments={"textTags": {"providerId": "deepseek", "model": "deepseek-v4-flash"}},
                ),
            },
        )

        worker = session.context.service_workers[0]
        worker.evaluate("""corrected => {
          globalThis.analysisFixtureCalls = 0;
          const realFetch = globalThis.fetch;
          globalThis.fetch = async (...args) => {
            if (!String(args[0]).includes('api.deepseek.com')) return realFetch(...args);
            if (!String(args[0]).includes('chat/completions')) return new Response(JSON.stringify({data:[]}));
            analysisFixtureCalls++;
            const {facetCatalog} = await chrome.storage.local.get('facetCatalog');
            const tags = corrected && analysisFixtureCalls > 1
              ? facetCatalog.nodes.filter(n => !n.parentId && n.status !== 'archived').slice(0,6).map(n => ({g:n.id,t:''}))
              : [{g:'invalid.path',t:'非法测试标签'}];
            return new Response(JSON.stringify({model:'deepseek-v4-flash',
              choices:[{finish_reason:'stop',message:{content:JSON.stringify({tags})}}],
              usage:{prompt_tokens:20,completion_tokens:4,total_tokens:24}}),
              {status:200,headers:{'Content-Type':'application/json'}});
          };
        }""", True)
        library = session.open_page("library.html", wait_until="networkidle")
        library.wait_for_timeout(500)
        assert not session.page_errors, f"资料库初始化失败：{session.page_errors}"
        expect(library.locator("body")).to_have_attribute("data-library-state", "ready")
        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()

        expect(library.locator("#analysis-diagnostics")).to_be_hidden()
        library.locator(".task-diagnostics > summary").click()
        library.locator("#show-analysis-diagnostics").check()
        library.locator('[data-settings-tab="tasks"]').click()
        expect(library.locator("#analysis-diagnostics")).to_be_visible()

        expect(library.locator("#analysis-runtime-version")).to_contain_text(f"PromptDirector {extension_version}")
        prompt_version = library.evaluate("async () => (await import('./deepseek.js')).ANALYSIS_PROMPT_VERSION")
        expect(library.locator("#analysis-runtime-version")).to_contain_text(f"Analysis v{prompt_version}")
        library.locator("#preview-analysis-batch").click()
        library.locator("#start-analysis-batch").click()
        expect(library.locator("#promptdirector-app-dialog")).to_contain_text("API 费用")
        assert worker.evaluate("analysisFixtureCalls") == 0
        library.locator("#promptdirector-app-dialog").get_by_role("button", name="确认付费", exact=True).click()

        result = wait_for_async_condition(library, """async () => {
          const s = await chrome.runtime.sendMessage({type:'GET_STATE'});
          return s.analysisBatchJob?.status === 'completed' ? s : null;
        }""")
        expect(library.locator("#batch-status-badge")).to_contain_text("已完成")
        expect(library.locator("#analysis-batch-details")).to_contain_text("模型请求 2 次")
        expect(library.locator("#analysis-batch-details")).to_contain_text("结构补全 1 次")
        job = result["analysisBatchJob"]
        assert job["counts"]["succeeded"] == 1 and job["counts"]["failed"] == 0
        assert job["requestAttempts"] == 1 and job["outputCorrectionRequests"] == 1
        assert result["entries"][0].get("analysisMeta"), result["entries"][0]
        assert worker.evaluate("analysisFixtureCalls") == 2
        # Persisted queue diagnostics survive reopening instead of relying on page-local events.
        library.reload(wait_until="networkidle")
        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()
        library.locator(".task-diagnostics > summary").click()
        expect(library.locator("#show-analysis-diagnostics")).to_be_checked()
        expect(library.locator("#analysis-batch-details")).to_contain_text("模型请求 2 次")
        assert worker.evaluate("analysisFixtureCalls") == 2
        print({"requests": 2, "diagnostics_default_hidden": True, "persisted_correction_diagnostics": True})


if __name__ == "__main__":
    main()
