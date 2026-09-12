from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, base_entry, extension_session, wait_for_async_condition


def main() -> None:
    entry = base_entry(
        "invalid-analysis-result",
        "连续非法标签",
        "雾中庭院，中央构图，柔和逆光。",
        "content:prompt:image",
    )
    with extension_session("prompt-director-analysis-failure-") as session:
        setup = session.open_page("collector.html")
        session.seed_storage(
            setup,
            {
                "schemaVersion": 24,
                "entries": [entry],
                "uiPreferences": {"analysisDiagnostics": True},
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
        }""", False)
        library = session.open_page("library.html", wait_until="networkidle")
        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()
        library.locator("#preview-analysis-batch").click()
        before = library.evaluate("() => chrome.runtime.sendMessage({type:'GET_STATE'})")
        library.locator("#start-analysis-batch").click()
        expect(library.locator("#promptdirector-app-dialog")).to_contain_text("API 费用")
        assert worker.evaluate("analysisFixtureCalls") == 0
        library.locator("#promptdirector-app-dialog").get_by_role("button", name="确认付费", exact=True).click()

        result = wait_for_async_condition(library, """async () => {
          const s = await chrome.runtime.sendMessage({type:'GET_STATE'});
          return s.analysisBatchJob && !['running','paused'].includes(s.analysisBatchJob.status) ? s : null;
        }""")
        expect(library.locator("#analysis-batch-summary")).to_contain_text("完成 0/1 · 失败 1")
        assert result["analysisBatchJob"]["counts"]["failed"] == 1
        assert result["analysisBatchJob"]["requestAttempts"] == 1
        assert result["analysisBatchJob"]["outputCorrectionRequests"] == 1
        assert result["entries"] == before["entries"], "非法结果不得改写案例"
        assert result["facetCatalog"] == before["facetCatalog"], "非法结果不得改写正式标签库"
        library.reload(wait_until="networkidle")
        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()
        expect(library.locator("#analysis-batch-summary")).to_contain_text("完成 0/1 · 失败 1")
        library.wait_for_timeout(1_500)
        assert worker.evaluate("analysisFixtureCalls") == 2, "重新打开页面不得自动重试付费请求"
        library.locator("#retry-analysis-failures").click()
        expect(library.locator("#promptdirector-app-dialog")).to_contain_text("API 费用")
        library.locator("#promptdirector-app-dialog").get_by_role("button", name="取消", exact=True).click()
        assert worker.evaluate("analysisFixtureCalls") == 2
        print({"requests": 2, "invalid_results_unchanged": True, "failed_committed_once": True, "retry_cancel_zero_requests": True})


if __name__ == "__main__":
    main()
