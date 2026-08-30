from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, base_entry, extension_session


GENERATED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


class CreativeServiceHandler(BaseHTTPRequestHandler):
    requests: list[dict] = []
    release_image = Event()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.cors_headers()
        self.end_headers()

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        self.requests.append({
            "path": self.path,
            "body": body,
            "content_type": self.headers.get("content-type", ""),
            "authorization": self.headers.get("authorization", ""),
        })
        if self.path.endswith("/images/edits") or self.path.endswith("/images/generations"):
            self.release_image.wait(timeout=10)
            return self.reply({"model": "local-image-test", "data": [{"b64_json": GENERATED_PNG}]})
        payload = json.loads(body or b"{}")
        planning = payload.get("text", {}).get("format", {}).get("type") == "json_object"
        output_text = json.dumps({
            "route": "compose",
            "status": "ready",
            "suggestedTitle": "后台离页生图",
            "instruction": "保持两张参考图各自职责，创建最终图片。",
            "question": None,
            "librarySearch": None,
        }, ensure_ascii=False) if planning else "后台离页生图提示词"
        self.reply({
            "model": "local-vision-test",
            "output_text": output_text,
            "usage": {"input_tokens": 12, "output_tokens": 6, "total_tokens": 18},
        })

    def cors_headers(self) -> None:
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "authorization, content-type")
        self.send_header("access-control-allow-methods", "POST, OPTIONS")

    def reply(self, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(200)
        self.cors_headers()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, _format: str, *_args) -> None:
        return


def select_composer_setting(page, selector: str, value: str) -> None:
    page.locator("#composer-options summary").click()
    page.locator(selector).select_option(value)
    page.locator("#composer-options summary").click()


def current_session(page) -> dict:
    return page.evaluate(
        """async () => {
          const sessionId = new URL(location.href).searchParams.get('session');
          return (await chrome.runtime.sendMessage({type: 'GET_COMPOSER_SESSION', sessionId})).session;
        }"""
    )


def completed_session(page) -> dict:
    page.wait_for_function(
        """async () => {
          const sessionId = new URL(location.href).searchParams.get('session');
          const response = await chrome.runtime.sendMessage({type: 'GET_COMPOSER_SESSION', sessionId});
          return response?.ok === true && response.session?.activeTurn == null;
        }""",
        timeout=10_000,
    )
    return current_session(page)


def main() -> None:
    local_service = ThreadingHTTPServer(("127.0.0.1", 0), CreativeServiceHandler)
    Thread(target=local_service.serve_forever, daemon=True).start()
    local_origin = f"http://127.0.0.1:{local_service.server_port}"
    entry = base_entry("composer-reference", "精选场景案例", "柔和逆光，低饱和，前后景层次清晰。", "content:prompt:image")
    jimeng_character = base_entry("jimeng-character", "即梦角色", "黑色短发角色，银灰机能服，冷静表情。", "content:prompt:image")
    entry["mediaAssets"] = [{"id": "composition-image", "kind": "image", "usage": "content", "storageMode": "managed", "mimeType": "image/png", "width": 1, "height": 1, "byteSize": 68}]
    entry["primaryMediaId"] = "composition-image"
    jimeng_character["mediaAssets"] = [{"id": "character-image", "kind": "image", "usage": "content", "storageMode": "managed", "mimeType": "image/png", "width": 1, "height": 1, "byteSize": 68}]
    jimeng_character["primaryMediaId"] = "character-image"
    retrieved_case = base_entry("retrieval-case", "内部案例标题", "雾夜角色穿银色披风，轮廓清晰。", "content:prompt:image")
    retrieved_guide = base_entry("retrieval-guide", "内部教程标题", "雾夜角色布光教程：先确定轮廓光，再控制环境雾。", "content:tutorial")
    with extension_session("prompt-director-composer-") as session:
        setup = session.open_page("collector.html")
        session.seed_storage(
            setup,
            {
                "schemaVersion": 24,
                "entries": [entry, jimeng_character, retrieved_case, retrieved_guide],
                **ai_configuration_fixture(
                    providers={
                        "deepseek": {
                            "apiKey": "e2e-local-key",
                            "consent": True,
                            "models": {"creativePlanning": "deepseek-v4-flash"},
                        },
                        "openai": {
                            "apiKey": "openai-e2e-key",
                            "consent": True,
                            "models": {
                                "creativePlanning": "gpt-5-mini",
                                "imageAnalysis": "gpt-5-mini",
                                "imageGeneration": "gpt-5-mini",
                            },
                        },
                        "custom-media": {
                            "protocol": "responses",
                            "endpoint": f"{local_origin}/v1/responses",
                            "apiKey": "micu-chat-e2e-key",
                            "consent": True,
                            "models": {
                                "imageAnalysis": "gpt-5.4-mini",
                                "imageGeneration": "gpt-image-2",
                            },
                            "imageGeneration": {
                                "protocol": "images_generations",
                                "endpoint": f"{local_origin}/v1/images/generations",
                                "editsEndpoint": f"{local_origin}/v1/images/edits",
                                "apiKey": "micu-image-e2e-key",
                                "model": "gpt-image-2",
                                "size": "1536x1024",
                            },
                        },
                    },
                    assignments={
                        "creativePlanning": {"providerId": "deepseek", "model": "deepseek-v4-flash"},
                        "imageAnalysis": {"providerId": "openai", "model": "gpt-5-mini"},
                        "imageGeneration": {"providerId": "openai", "model": "gpt-5-mini"},
                    },
                ),
            },
        )
        setup.evaluate(
            """async () => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
              const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
              const blob = new Blob([bytes], {type: 'image/png'});
              await saveMediaBlob('composition-image', blob, {checkCapacity: false});
              await saveMediaBlob('character-image', blob, {checkCapacity: false});
            }"""
        )
        composer = session.open_page("composer.html")
        composer.locator("#composer-reference-open").click()
        composer.locator(".composer-case-option", has_text="精选场景案例").locator("input").check()
        composer.locator(".composer-case-option", has_text="即梦角色").locator("input").check()
        composer.locator("#composer-reference-apply").click()
        expect(composer.locator("#composer-reference-count")).to_have_text("2")

        requests: list[dict] = []
        fail_first = {"value": True}

        def mock_deepseek(route) -> None:
            payload = route.request.post_data_json
            requests.append(payload)
            if fail_first["value"]:
                fail_first["value"] = False
                route.abort("connectionfailed")
                return
            if payload.get("stream"):
                execution_payload = json.loads(payload["messages"][-1]["content"])
                execution_route = execution_payload.get("route", "compose")
                user_text = json.dumps(execution_payload.get("messages", []), ensure_ascii=False)
                latest_user_text = next(
                    (item.get("content", "") for item in reversed(execution_payload.get("messages", [])) if item.get("role") == "user"),
                    "",
                )
                if execution_route == "auto":
                    resolved_route = "analyze_materials" if "分析资料" in user_text else "compose"
                else:
                    resolved_route = execution_route
                if "是否检索本地资料" in latest_user_text:
                    streamed_text = "是否检索本地资料补充雾夜角色细节？你可以回复：检索，或不检索直接生成。"
                elif "协议降级测试" in latest_user_text:
                    streamed_text = "自动模式降级为普通回答。"
                elif resolved_route == "analyze_materials":
                    streamed_text = "资料分析结果：当前资料使用柔和逆光。"
                elif resolved_route == "chat":
                    streamed_text = "**普通对话回答**\n\n- 这个概念强调维度归属。"
                elif execution_payload.get("outputLanguage") == "en":
                    streamed_text = "An eastern courtyard in soft backlight."
                elif execution_payload.get("targetType") == "video":
                    streamed_text = "人物从庭院门口走入逆光，镜头跟随至廊下停住。"
                else:
                    streamed_text = "东方庭院，柔和逆光。"
                if execution_route == "auto" and "协议降级测试" not in latest_user_text:
                    status = "needs_clarification" if "是否检索本地资料" in latest_user_text else "ready"
                    streamed_text = json.dumps({"route": resolved_route, "status": status}, ensure_ascii=False) + "\n" + streamed_text
                route.fulfill(
                    status=200,
                    content_type="text/event-stream",
                    body=(
                        f'data: {json.dumps({"model": "deepseek-v4-flash", "choices": [{"delta": {"content": streamed_text}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28}}, ensure_ascii=False)}\n\n'
                        "data: [DONE]\n\n"
                    ),
                )
                return
            request_payload = json.loads(payload["messages"][-1]["content"])
            references = request_payload["references"]
            user_text = json.dumps(request_payload.get("messages", []), ensure_ascii=False)
            latest_user_text = next(
                (item.get("content", "") for item in reversed(request_payload.get("messages", [])) if item.get("role") == "user"),
                "",
            )
            route_mode = request_payload.get("routeMode", "auto")
            planned_route = route_mode if route_mode != "auto" else (
                "analyze_materials" if "分析资料" in user_text else "compose"
            )
            assert isinstance(references, list)
            if "是否检索本地资料" in latest_user_text:
                planner_result = {
                    "route": planned_route,
                    "status": "needs_clarification",
                    "suggestedTitle": "",
                    "instruction": "",
                    "question": {
                        "text": "是否检索本地资料补充雾夜角色细节？",
                        "recommendedAnswer": "检索本地资料",
                        "options": ["检索本地资料", "不检索，直接生成"],
                    },
                    "librarySearch": None,
                }
            elif "私人资料" in latest_user_text or "检索本地资料" in latest_user_text:
                search_query = "完全不存在" if "不存在" in latest_user_text else "雾夜角色"
                planner_result = {
                    "route": planned_route,
                    "status": "ready",
                    "suggestedTitle": "雾夜角色",
                    "instruction": "保留手选参考，只把检索案例和教程作为补充。",
                    "question": None,
                    "librarySearch": {"query": search_query, "contentRoles": ["case", "guide"]},
                }
            elif "规划缺字段测试" in latest_user_text:
                planner_result = {"route": planned_route, "status": "ready"}
            else:
                planner_result = {
                    "route": planned_route,
                    "status": "ready",
                    "suggestedTitle": "东方庭院逆光",
                    "instruction": "保留参考1的柔和逆光和层次，按用户要求生成东方庭院。",
                    "question": None,
                    "librarySearch": None,
                }
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "model": "deepseek-v4-flash",
                    "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(planner_result, ensure_ascii=False)}}],
                }, ensure_ascii=False),
            )

        composer.route("https://api.deepseek.com/**", mock_deepseek)
        composer.locator("#composer-instruction").fill("保留参考1的场景和镜头，只用参考2替换人物外观与服装")
        composer.locator("#composer-action").click()
        expect(composer.get_by_role("button", name="重试本轮", exact=True)).to_be_visible()
        composer.get_by_role("button", name="重试本轮", exact=True).click()
        expect(composer.get_by_role("dialog")).to_contain_text("上一次请求可能已经被服务商接收")
        composer.get_by_role("button", name="继续重试", exact=True).click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_have_text("东方庭院，柔和逆光。")
        assert len(requests) == 2
        assert completed_session(composer)["activeTurn"] is None
        sent = json.dumps(requests, ensure_ascii=False)
        assert "精选场景案例" not in sent
        assert "即梦角色" not in sent
        assert "fixture.invalid" not in sent
        assert "柔和逆光，低饱和" in sent
        assert "黑色短发角色，银灰机能服" in sent
        execution_payload = json.loads(requests[-1]["messages"][-1]["content"])
        assert len(execution_payload["references"]) == 2
        assert "dimensionUses" not in json.dumps(requests[-1], ensure_ascii=False)
        composer.locator("#composer-options summary").click()
        composer.locator("#composer-assembly-open").click()
        expect(composer.locator(".composer-assembly-layer")).to_have_count(7)
        expect(composer.locator("#composer-assembly-content")).to_contain_text("精选场景案例")
        composer.locator("#composer-assembly-close").click()

        composer.locator("#composer-new").click()
        composer.evaluate(
            """() => {
              window.__promptDirectorNativeFetch = window.fetch;
              window.fetch = (url, options = {}) => new Promise((resolve, reject) => {
                let timer;
                const abort = () => {
                  clearTimeout(timer);
                  reject(new DOMException('aborted', 'AbortError'));
                };
                if (options.signal?.aborted) return abort();
                options.signal?.addEventListener('abort', abort, {once: true});
                timer = setTimeout(() => window.__promptDirectorNativeFetch(url, options).then(resolve, reject), 800);
              });
            }"""
        )
        composer.locator("#composer-instruction").fill("停止规划测试")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.status")).to_contain_text("正在生成")
        expect(composer.locator("#composer-action")).to_have_attribute("data-state", "stop")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.status")).to_contain_text("已停止，本次不完整输出没有保存")
        composer.evaluate("() => { window.fetch = window.__promptDirectorNativeFetch; delete window.__promptDirectorNativeFetch; }")

        composer.locator("#composer-new").click()
        composer.evaluate(
            """() => {
              window.__promptDirectorNativeFetch = window.fetch;
              let requestCount = 0;
              window.fetch = (url, options = {}) => {
                requestCount += 1;
                if (requestCount === 1) return Promise.reject(new TypeError('stream offline'));
                return window.__promptDirectorNativeFetch(url, options);
              };
            }"""
        )
        composer.locator("#composer-instruction").fill("流式中断后复用规划")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.failure")).to_contain_text("本轮内容已保留")
        requests_before_stream_retry = len(requests)
        composer.evaluate("() => { window.fetch = window.__promptDirectorNativeFetch; delete window.__promptDirectorNativeFetch; }")
        composer.get_by_role("button", name="重试本轮", exact=True).click()
        expect(composer.get_by_role("dialog")).to_contain_text("上一次请求可能已经被服务商接收")
        composer.get_by_role("button", name="继续重试", exact=True).click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_have_text("东方庭院，柔和逆光。")
        assert len(requests) == requests_before_stream_retry + 1
        assert composer.locator(".composer-message.user", has_text="流式中断后复用规划").count() == 1

        composer.locator("#composer-new").click()
        select_composer_setting(composer, "#composer-route", "auto")
        composer.locator("#composer-instruction").fill("分析资料中的光线差异")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.analysis .composer-message-text")).to_contain_text("资料分析结果")
        assert composer.locator(".composer-message.assistant").count() == 1
        assert composer.locator(".composer-message.plan").count() == 0
        assert composer.locator(".composer-message.prompt").count() == 0

        composer.locator("#composer-new").click()
        select_composer_setting(composer, "#composer-route", "chat")
        composer.locator("#composer-options summary").click()
        expect(composer.locator("#composer-production-review")).to_be_disabled()
        composer.locator("#composer-options summary").click()
        composer.locator("#composer-instruction").fill("解释这个概念")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.chat .composer-message-text")).to_contain_text("普通对话回答")
        expect(composer.locator(".composer-message.chat .markdown-reader strong")).to_have_text("普通对话回答")
        expect(composer.locator(".composer-message.chat .markdown-reader li")).to_have_text("这个概念强调维度归属。")
        assert composer.locator(".composer-message.assistant").count() == 1
        assert composer.locator(".composer-message.plan").count() == 0

        composer.locator("#composer-new").click()
        select_composer_setting(composer, "#composer-route", "compose")
        select_composer_setting(composer, "#composer-output-language", "en")
        composer.locator("#composer-instruction").fill("生成东方庭院")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_have_text("An eastern courtyard in soft backlight.")

        composer.locator("#composer-new").click()
        composer.locator(".composer-type-switch label", has_text="视频").click()
        select_composer_setting(composer, "#composer-route", "compose")
        select_composer_setting(composer, "#composer-output-language", "zh-CN")
        composer.locator("#composer-instruction").fill("生成庭院人物行走视频")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_contain_text("镜头跟随")
        video_execution = json.loads(requests[-1]["messages"][-1]["content"])
        assert video_execution["instruction"] == "生成庭院人物行走视频"

        composer.locator("#composer-new").click()
        composer.locator(".composer-type-switch label", has_text="图片").click()
        select_composer_setting(composer, "#composer-route", "auto")
        composer.locator("#composer-instruction").fill("是否检索本地资料")
        question_requests_before = len(requests)
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.question")).to_have_count(1)
        expect(composer.locator(".composer-message.question")).to_contain_text("是否检索本地资料")
        expect(composer.locator(".composer-question-options button")).to_have_count(0)
        assert composer.locator(".composer-message.user", has_text="是否检索本地资料").count() == 1
        assert len(requests) == question_requests_before + 1
        composer.locator("#composer-instruction").fill("不检索，直接生成")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_have_text("东方庭院，柔和逆光。")

        composer.locator("#composer-new").click()
        retrieval_requests_before = len(requests)
        composer.locator("#composer-library-search").click()
        expect(composer.locator("#composer-library-search")).to_have_attribute("aria-pressed", "true")
        composer.locator("#composer-instruction").fill("用私人资料补充雾夜角色")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_have_text("东方庭院，柔和逆光。")
        assert len(requests) == retrieval_requests_before + 1
        retrieval_payload = json.loads(requests[-1]["messages"][-1]["content"])
        assert len(retrieval_payload["retrievedSources"]) == 2, retrieval_payload
        assert "雾夜角色穿银色披风" in json.dumps(retrieval_payload, ensure_ascii=False)
        retrieval_session = completed_session(composer)
        assert retrieval_session["retrievalSnapshot"]["status"] == "completed", retrieval_session
        assert retrieval_session["retrievalSnapshot"]["sourceCount"] == 2, retrieval_session
        assert retrieval_session["assemblySnapshot"]["status"] == "completed", retrieval_session
        assert retrieval_session["assemblySnapshot"]["userRequest"] == "用私人资料补充雾夜角色", retrieval_session
        assert retrieval_session["assemblySnapshot"]["actual"]["status"] == "completed", retrieval_session
        assert retrieval_session["assemblySnapshot"]["actual"]["model"] == "deepseek-v4-flash", retrieval_session
        expect(composer.locator("#composer-library-search")).to_have_attribute("aria-pressed", "false")
        composer.locator("#composer-options summary").click()
        composer.locator("#composer-assembly-open").click()
        expect(composer.locator(".composer-assembly-layer")).to_have_count(7)
        expect(composer.locator("#composer-assembly-content")).to_contain_text("本轮用户请求")
        expect(composer.locator("#composer-assembly-content")).to_contain_text("用私人资料补充雾夜角色")
        expect(composer.locator("#composer-assembly-content")).to_contain_text("采用 2 条来源")
        expect(composer.locator("#composer-assembly-content")).to_contain_text("预计 1 次模型请求")
        expect(composer.locator("#composer-assembly-content")).to_contain_text("实际终态：completed")
        composer.locator("#composer-assembly-close").click()

        composer.locator("#composer-new").click()
        composer.locator("#composer-instruction").fill("协议降级测试")
        degraded_requests_before = len(requests)
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.chat .composer-message-text")).to_have_text("自动模式降级为普通回答。")
        assert len(requests) == degraded_requests_before + 1
        degraded_session = completed_session(composer)
        assert any(event["status"] == "degraded" for event in degraded_session["diagnosticEvents"]), degraded_session

        openai_requests: list[dict] = []
        generated_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

        def mock_openai(route) -> None:
            payload = route.request.post_data_json
            if payload is None:
                route.continue_()
                return
            openai_requests.append(payload)
            if payload.get("tools"):
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({
                        "model": "gpt-5-mini",
                        "output": [{"type": "image_generation_call", "result": generated_png}],
                        "usage": {"input_tokens": 30, "output_tokens": 10, "total_tokens": 40},
                    }),
                )
                return
            if payload.get("text", {}).get("format", {}).get("type") == "json_object":
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({
                        "model": "gpt-5-mini",
                        "output_text": json.dumps({
                            "route": "compose",
                            "status": "ready",
                            "suggestedTitle": "三人长焦构图",
                            "instruction": "参考1负责三人构图、前景虚化和中间女性聚焦，参考2只负责风格。",
                        }, ensure_ascii=False),
                    }, ensure_ascii=False),
                )
                return
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "model": "gpt-5-mini",
                    "output_text": json.dumps({"route": "compose", "status": "ready"}, ensure_ascii=False)
                    + "\n三人电影级长焦构图，中间女性清晰聚焦，前景两人明显虚化，银灰机能服与低饱和柔光。",
                    "usage": {"input_tokens": 30, "output_tokens": 20, "total_tokens": 50},
                }, ensure_ascii=False),
            )

        session.context.route("https://api.openai.com/**", mock_openai)
        composer.locator("#composer-new").click()
        composer.locator("#composer-reference-open").click()
        composer.locator(".composer-case-option", has_text="精选场景案例").locator("input").check()
        composer.locator(".composer-case-option", has_text="即梦角色").locator("input").check()
        composer.locator("#composer-reference-apply").click()
        composer.locator("#composer-model-trigger").click()
        composer.locator("#composer-model-dynamic button", has_text="OpenAI").click()
        expect(composer.locator("#composer-model-label")).to_have_text("OpenAI")
        composer.locator("#composer-instruction").fill("参考1保持三人构图和中间女性聚焦，参考2只负责画面风格")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_contain_text("三人电影级长焦构图")
        assert len(openai_requests) == 1
        visual_parts = openai_requests[0]["input"][0]["content"]
        assert len([part for part in visual_parts if part.get("type") == "input_image"]) == 2
        labels = [part.get("text") for part in visual_parts if part.get("type") == "input_text"]
        assert "@参考1/图片1" in labels
        assert "@参考2/图片1" in labels

        composer.evaluate(
            """async (origin) => {
              const {aiTaskAssignments} = await chrome.storage.local.get('aiTaskAssignments');
              await chrome.runtime.sendMessage({
                type: 'UPDATE_AI_PROVIDER_CONFIGURATION',
                registry: {
                  providers: {
                    'custom-text': {
                      endpoint: `${origin}/v1/responses`,
                      protocol: 'responses',
                      apiKey: 'controlled-chat-test-key',
                      consent: true,
                      models: {
                        creativePlanning: 'local-vision-test'
                      }
                    },
                    'custom-media': {
                      endpoint: `${origin}/v1/responses`,
                      protocol: 'responses',
                      apiKey: 'controlled-chat-test-key',
                      consent: true,
                      models: {
                        imageAnalysis: 'local-vision-test',
                        imageGeneration: 'local-image-test'
                      },
                      imageGeneration: {
                        protocol: 'images_generations',
                        endpoint: `${origin}/v1/images/generations`,
                        editsEndpoint: `${origin}/v1/images/edits`,
                        apiKey: 'controlled-image-test-key',
                        model: 'local-image-test',
                        sizes: ['1024x1024']
                      }
                    }
                  }
                },
                assignments: {
                  ...aiTaskAssignments,
                  creativePlanning: {providerId: 'custom-text', model: 'local-vision-test'},
                  imageAnalysis: {providerId: 'custom-media', model: 'local-vision-test'},
                  imageGeneration: {providerId: 'custom-media', model: 'local-image-test'}
                }
              });
            }""",
            local_origin,
        )
        composer.reload()
        expect(composer.locator("#composer-model-trigger")).to_be_visible()
        composer.locator("#composer-model-trigger").click()
        composer.locator("#composer-model-dynamic button", has_text="自定义兼容服务（文字）").click()
        expect(composer.locator("#composer-model-label")).to_have_text("自定义兼容服务（文字）")
        CreativeServiceHandler.requests.clear()
        CreativeServiceHandler.release_image.clear()
        composer.locator("#composer-options summary").click()
        expect(composer.locator("#composer-create-image")).to_be_enabled()
        expect(composer.locator("#composer-generation-settings")).to_be_visible()
        expect(composer.locator("#composer-image-size-field")).to_be_visible()
        composer.locator("#composer-image-size").select_option("1536x1024")
        expect(composer.locator("#composer-image-size")).to_have_value("1536x1024")
        assert current_session(composer)["generationParameters"]["size"] == "1536x1024"
        composer.locator("#composer-create-image").check()
        expect(composer.locator("#composer-image-size")).to_have_value("1536x1024")
        composer.locator("#composer-options summary").click()
        expect(composer.locator("#composer-model-label")).to_have_text("OpenAI · 生图")
        composer.locator("#composer-model-trigger").click()
        composer.locator("#composer-model-dynamic button", has_text="local-image-test").click()
        expect(composer.locator("#composer-model-label")).to_have_text("兼容服务 · 生图")
        composer.locator("#composer-options summary").click()
        expect(composer.locator("#composer-generation-settings")).to_be_visible()
        expect(composer.locator("#composer-generation-settings-title")).to_have_text("本轮图片参数")
        expect(composer.locator("#composer-image-size-field")).to_be_visible()
        expect(composer.locator("#composer-image-size")).to_have_value("1536x1024")
        expect(composer.locator('#composer-image-size option[data-incompatible="true"]')).to_have_text("1536x1024（当前模型不支持，请重选）")
        expect(composer.locator("#composer-generation-parameter-note")).to_contain_text("不受当前服务支持")
        expect(composer.locator("#composer-image-size")).to_be_enabled()
        supported_size = composer.locator("#composer-image-size").evaluate(
            "select => [...select.options].find(option => option.dataset.incompatible !== 'true')?.value || ''"
        )
        assert supported_size and supported_size != "auto", supported_size
        composer.locator("#composer-image-size").select_option(supported_size)
        expect(composer.locator("#composer-image-size")).to_have_value(supported_size)
        expect(composer.locator("#composer-image-size")).to_be_disabled()
        assert current_session(composer)["generationParameters"]["size"] == supported_size
        composer.locator("#composer-options summary").click()
        composer.locator("#composer-instruction").fill("按相同职责直接创建图片")
        composer.locator("#composer-action").click()
        try:
            expect(composer.locator(".composer-session-running")).to_be_visible()
            running_row = composer.locator(".composer-session-item:has(.composer-session-running)")
            running_row.hover()
            running_row.locator(".composer-session-menu > summary").click()
            expect(running_row.get_by_role("menuitem", name="删除", exact=True)).to_be_disabled()
        except AssertionError:
            diagnostic = composer.evaluate(
                """async () => ({
                  feedback: document.querySelector('#composer-feedback')?.textContent || '',
                  failure: document.querySelector('.composer-message.failure')?.textContent || '',
                  session: (await chrome.runtime.sendMessage({
                    type: 'GET_COMPOSER_SESSION',
                    sessionId: new URL(location.href).searchParams.get('session')
                  })).session,
                  jobs: (await chrome.storage.local.get('creativeJobs')).creativeJobs
                })"""
            )
            print({
                "feedback": diagnostic["feedback"],
                "failure": diagnostic["failure"],
                "generation_profile": diagnostic["session"]["generationAiProfile"],
                "output_mode": diagnostic["session"]["outputMode"],
                "job_status": (diagnostic.get("jobs") or {}).get("items", [{}])[-1].get("status", "missing"),
                "paths": [item["path"] for item in CreativeServiceHandler.requests],
            })
            raise
        other_session = composer.locator(".composer-session-item:not(:has(.composer-session-running)) > button:first-child").first
        expect(other_session).to_be_visible()
        other_session.click()
        try:
            expect(composer.locator(".composer-session-running")).to_be_visible()
        except AssertionError:
            diagnostic = composer.evaluate(
                "() => chrome.storage.local.get(['creativeJobs', 'composerSessions'])"
            )
            print({
                "jobs": diagnostic.get("creativeJobs"),
                "paths": [item["path"] for item in CreativeServiceHandler.requests],
                "authorizations": [item["authorization"] for item in CreativeServiceHandler.requests],
            })
            raise
        CreativeServiceHandler.release_image.set()
        composer.locator(".composer-library-exit").click()
        expect(composer).to_have_url(f"chrome-extension://{session.extension_id}/library.html")
        deadline = time.monotonic() + 10
        creative_jobs = None
        while time.monotonic() < deadline:
            creative_jobs = composer.evaluate("() => chrome.storage.local.get('creativeJobs').then(value => value.creativeJobs)")
            if creative_jobs and creative_jobs["items"][-1]["status"] == "completed":
                break
            composer.wait_for_timeout(100)
        assert creative_jobs and creative_jobs["items"][-1]["status"] == "completed", creative_jobs
        image_session_id = creative_jobs["items"][-1]["sessionId"]
        composer.goto(f"chrome-extension://{session.extension_id}/composer.html?session={image_session_id}")
        expect(composer.locator(".composer-result-card img")).to_have_count(1)
        assert len(openai_requests) == 1
        local_requests = CreativeServiceHandler.requests
        assert [item["path"] for item in local_requests] == [
            "/v1/responses", "/v1/images/edits"
        ]
        assert [item["authorization"] for item in local_requests] == [
            "Bearer controlled-chat-test-key",
            "Bearer controlled-image-test-key",
        ]
        local_execution = json.loads(local_requests[0]["body"])
        assert local_execution["model"] == "local-vision-test", local_execution["model"]
        assert len([
            part for part in local_execution["input"][0]["content"]
            if part.get("type") == "input_image"
        ]) == 2
        assert local_requests[1]["content_type"].startswith("multipart/form-data; boundary=")
        assert local_requests[1]["body"].count(b'name="image[]"') == 2
        assert b'name="model"' in local_requests[1]["body"] and b"local-image-test" in local_requests[1]["body"]
        assert b'name="size"' in local_requests[1]["body"] and supported_size.encode() in local_requests[1]["body"]
        creative_runs = composer.evaluate("() => chrome.storage.local.get('creativeRuns').then(value => value.creativeRuns)")
        assert len(creative_runs) == 1
        assert len(creative_runs[0]["outputs"]) == 1

        CreativeServiceHandler.release_image.clear()
        composer.evaluate(
            """() => {
              const nativeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
              let releaseStaleRefresh;
              let delayed = false;
              window.__promptDirectorStaleRefreshCaptured = false;
              window.__promptDirectorReleaseStaleRefresh = () => releaseStaleRefresh?.();
              chrome.runtime.sendMessage = async (...args) => {
                const response = await nativeSendMessage(...args);
                const message = args[0];
                const hasActiveJob = response?.creativeJobs?.items?.some(item => ['queued', 'running'].includes(item.status));
                if (message?.type === 'GET_STATE' && hasActiveJob && !delayed) {
                  delayed = true;
                  window.__promptDirectorStaleRefreshCaptured = true;
                  await new Promise(resolve => { releaseStaleRefresh = resolve; });
                }
                return response;
              };
            }"""
        )
        composer.locator("#composer-instruction").fill("完成后立即恢复发送按钮")
        composer.locator("#composer-action").click()
        composer.wait_for_function("() => window.__promptDirectorStaleRefreshCaptured === true")
        CreativeServiceHandler.release_image.set()
        deadline = time.monotonic() + 10
        completion_jobs = None
        while time.monotonic() < deadline:
            completion_jobs = composer.evaluate("() => chrome.storage.local.get('creativeJobs').then(value => value.creativeJobs)")
            if completion_jobs and completion_jobs["items"][-1]["status"] == "completed":
                break
            composer.wait_for_timeout(100)
        assert completion_jobs and completion_jobs["items"][-1]["status"] == "completed", completion_jobs
        expect(composer.locator(".composer-result-card")).to_have_count(2)
        expect(composer.locator("#composer-action")).to_have_attribute("data-state", "send")
        composer.evaluate("() => window.__promptDirectorReleaseStaleRefresh()")
        composer.wait_for_timeout(200)
        expect(composer.locator("#composer-action")).to_have_attribute("data-state", "send")
        expect(composer.locator("#composer-action")).to_have_attribute("aria-label", "发送")

        CreativeServiceHandler.release_image.clear()
        composer.locator("#composer-instruction").fill("启动图片任务后立即停止")
        composer.locator("#composer-action").click()
        expect(composer.locator("#composer-action")).to_have_attribute("data-state", "stop")
        composer.locator("#composer-action").click()
        deadline = time.monotonic() + 5
        stopped_jobs = None
        while time.monotonic() < deadline:
            stopped_jobs = composer.evaluate("() => chrome.storage.local.get('creativeJobs').then(value => value.creativeJobs)")
            if stopped_jobs and stopped_jobs["items"][-1]["status"] == "interrupted":
                break
            composer.wait_for_timeout(100)
        CreativeServiceHandler.release_image.set()
        assert stopped_jobs and stopped_jobs["items"][-1]["status"] == "interrupted", stopped_jobs
        assert stopped_jobs["items"][-1]["executionState"] == "stop_unknown", stopped_jobs
        assert stopped_jobs["items"][-1]["providerMayHaveAccepted"] is True, stopped_jobs
        stopped_count = len(stopped_jobs["items"])
        composer.wait_for_timeout(800)
        assert composer.evaluate(
            "() => chrome.storage.local.get('creativeJobs').then(value => value.creativeJobs.items.length)"
        ) == stopped_count

        composer.set_viewport_size({"width": 390, "height": 844})
        model_box = composer.locator("#composer-model-trigger").bounding_box()
        send_box = composer.locator("#composer-action").bounding_box()
        input_box = composer.locator(".composer-input-box").bounding_box()
        assert model_box and send_box and input_box
        assert model_box["x"] + model_box["width"] <= send_box["x"]
        assert send_box["x"] + send_box["width"] <= input_box["x"] + input_box["width"] + 1
        composer.set_viewport_size({"width": 1280, "height": 900})

        print({
            "network_retry": True,
            "stop": True,
            "stream_retry_reused_instruction": True,
            "assembly_layers": 7,
            "auto_route": "analyze_materials",
            "manual_route": "chat",
            "markdown_rendered": True,
            "english_output": True,
            "video_instruction": True,
            "clarification_same_response": True,
            "invalid_auto_frame_preserved": True,
            "openai_multimodal_images": 2,
            "controlled_image_generation_saved": True,
            "image_generation_survived_navigation": True,
            "image_generation_survived_session_switch": True,
            "durable_image_stop": True,
            "controlled_reference_images": 2,
            "generation_size_owned_by_session": supported_size,
            "mobile_model_send_overlap": False,
        })
    local_service.shutdown()


if __name__ == "__main__":
    main()
