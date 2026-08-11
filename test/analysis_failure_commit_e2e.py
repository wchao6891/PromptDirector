from __future__ import annotations

import json

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


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
                "aiSettings": {
                    "activeProvider": "deepseek",
                    "apiKey": "failure-e2e-key",
                    "consent": True,
                    "analysisModel": "deepseek-v4-flash",
                },
            },
        )
        request_count = 0

        def mock_analysis(route) -> None:
            nonlocal request_count
            request_count += 1
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(
                    {
                        "model": "deepseek-v4-flash",
                        "choices": [{
                            "finish_reason": "stop",
                            "message": {"content": json.dumps({"tags": [
                                {"g": "invalid.path", "t": f"非法标签{index}"}
                                for index in range(6)
                            ]}, ensure_ascii=False)},
                        }],
                        "usage": {"prompt_tokens": 20, "completion_tokens": 4, "total_tokens": 24},
                    },
                    ensure_ascii=False,
                ),
            )

        session.context.route("https://api.deepseek.com/**", mock_analysis)
        library = session.open_page("library.html", wait_until="networkidle")
        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()
        library.locator("#preview-analysis-batch").click()
        library.locator("#start-analysis-batch").click()

        expect(library.locator("#batch-status-badge")).to_contain_text("上次任务")
        expect(library.locator("#analysis-batch-summary")).to_contain_text("1 失败")
        expect(library.locator("#analysis-diagnostic-events")).to_contain_text("失败结果已入任务状态")
        library.wait_for_timeout(1_500)
        assert request_count == 2, f"失败结果被重复请求了 {request_count} 次"
        print({"requests": request_count, "failed_committed_once": True})


if __name__ == "__main__":
    main()
