from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, extension_session


def main() -> None:
    with extension_session("prompt-director-active-turn-", viewport={"width": 1280, "height": 900}) as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "composerSessions": [],
            **ai_configuration_fixture(
                providers={
                    "deepseek": {
                        "apiKey": "deepseek-e2e-key",
                        "consent": True,
                        "models": {"creativePlanning": "deepseek-v4-flash"},
                    },
                },
                assignments={
                    "creativePlanning": {"providerId": "deepseek", "model": "deepseek-v4-flash"},
                },
            ),
        })
        unexpected_requests: list[str] = []
        run.context.route("https://api.deepseek.com/**", lambda route: (
            unexpected_requests.append(route.request.url), route.abort("failed")
        ))
        composer = run.open_page("composer.html", wait_until="networkidle")
        composer.evaluate(
            """() => {
              const nativeFetch = window.fetch.bind(window);
              window.fetch = async (url, options = {}) => {
                if (!String(url).startsWith('https://api.deepseek.com/')) return nativeFetch(url, options);
                const stored = await chrome.storage.local.get('e2eComposerRequestCount');
                await chrome.storage.local.set({e2eComposerRequestCount: Number(stored.e2eComposerRequestCount || 0) + 1});
                const encoder = new TextEncoder();
                const visible = JSON.stringify({route: 'compose', status: 'ready'}) + '\\n已收到但尚未完成的提示词正文';
                const stream = new ReadableStream({
                  start(controller) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      model: 'deepseek-v4-flash',
                      choices: [{delta: {content: visible}, finish_reason: null}]
                    })}\\n\\n`));
                  }
                });
                return new Response(stream, {status: 200, headers: {'content-type': 'text/event-stream'}});
              };
            }"""
        )

        composer.locator("#composer-instruction").fill("生成一个不会在刷新后自动重发的提示词")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-streaming-caret")).to_have_text("已收到但尚未完成的提示词正文")
        composer.wait_for_function(
            """async () => {
              const sessionId = new URL(location.href).searchParams.get('session');
              const response = await chrome.runtime.sendMessage({type: 'GET_COMPOSER_SESSION', sessionId});
              return response?.session?.activeTurn?.partialText === '已收到但尚未完成的提示词正文';
            }"""
        )
        session_id = composer.evaluate("() => new URL(location.href).searchParams.get('session')")
        composer.reload(wait_until="networkidle")

        expect(composer.locator(".composer-streaming-caret")).to_have_text("已收到但尚未完成的提示词正文")
        expect(composer.locator(".composer-message.failure")).to_contain_text("不会自动重试")
        recovered = composer.evaluate(
            """async (sessionId) => {
              const response = await chrome.runtime.sendMessage({type: 'GET_COMPOSER_SESSION', sessionId});
              const stored = await chrome.storage.local.get('e2eComposerRequestCount');
              return {activeTurn: response.session.activeTurn, requestCount: stored.e2eComposerRequestCount};
            }""",
            session_id,
        )
        assert recovered["activeTurn"]["status"] == "interrupted", recovered
        assert recovered["requestCount"] == 1, recovered
        assert unexpected_requests == [], unexpected_requests

        composer.get_by_role("button", name="重试本轮", exact=True).click()
        dialog = composer.locator("dialog[open]")
        expect(dialog).to_contain_text("可能再次计费")
        dialog.get_by_role("button", name="取消", exact=True).click()
        assert unexpected_requests == [], unexpected_requests

        print({
            "partialTextRecovered": True,
            "status": recovered["activeTurn"]["status"],
            "automaticResends": 0,
            "paidRetryWarning": True,
        })


if __name__ == "__main__":
    main()
