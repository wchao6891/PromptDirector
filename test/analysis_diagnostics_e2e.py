from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


def main() -> None:
    extension_version = json.loads((Path(__file__).resolve().parents[1] / "manifest.json").read_text())["version"]
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
                "aiSettings": {
                    "activeProvider": "deepseek",
                    "apiKey": "diagnostic-e2e-key",
                    "consent": True,
                    "analysisModel": "deepseek-v4-flash",
                },
            },
        )

        request_count = 0

        def mock_analysis(route) -> None:
            nonlocal request_count
            request_count += 1
            tags = [] if request_count == 1 else [{"g": "style.render", "t": "赛璐珞"}]
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(
                    {
                        "model": "deepseek-v4-flash",
                        "choices": [
                            {
                                "finish_reason": "stop",
                                "message": {"content": json.dumps({"tags": tags}, ensure_ascii=False)},
                            }
                        ],
                        "usage": {
                            "prompt_tokens": 20,
                            "completion_tokens": 4,
                            "total_tokens": 24,
                        },
                    },
                    ensure_ascii=False,
                ),
            )

        session.context.route("https://api.deepseek.com/**", mock_analysis)
        library = session.open_page("library.html", wait_until="networkidle")
        library.wait_for_timeout(500)
        assert not session.page_errors, f"资料库初始化失败：{session.page_errors}"
        expect(library.locator("body")).to_have_attribute("data-library-state", "ready")
        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()

        expect(library.locator("#analysis-diagnostics")).to_be_hidden()
        library.locator('[data-settings-tab="ai"]').click()
        library.locator(".ai-advanced-settings > summary").click()
        library.locator("#show-analysis-diagnostics").check()
        library.locator('[data-settings-tab="tasks"]').click()
        expect(library.locator("#analysis-diagnostics")).to_be_visible()

        expect(library.locator("#analysis-runtime-version")).to_contain_text(f"PromptDirector {extension_version}")
        expect(library.locator("#analysis-runtime-version")).to_contain_text("Analysis v9")
        library.locator("#preview-analysis-batch").click()
        library.locator("#start-analysis-batch").click()

        expect(library.locator("#batch-status-badge")).to_contain_text("上次任务")
        expect(library.locator("#analysis-diagnostic-events")).to_contain_text("首次请求开始")
        expect(library.locator("#analysis-diagnostic-events")).to_contain_text("首次响应：0 个标签")
        expect(library.locator("#analysis-diagnostic-events")).to_contain_text("标签校验失败")
        expect(library.locator("#analysis-diagnostic-events")).to_contain_text("纠错请求开始")
        expect(library.locator("#analysis-diagnostic-events")).to_contain_text("纠错响应：1 个标签")
        expect(library.locator("#analysis-diagnostic-events")).to_contain_text("提交完成")
        assert request_count == 2
        print({"requests": request_count, "diagnostics_default_hidden": True, "diagnostic_chain": True})


if __name__ == "__main__":
    main()
