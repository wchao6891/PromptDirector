from __future__ import annotations

import json
import re

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


TASK_IDS = {
    "textTags",
    "skillExtraction",
    "creativePlanning",
    "imageAnalysis",
    "videoAnalysis",
    "imageGeneration",
    "videoGeneration",
}

PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
DIMENSIONS = ["subject", "scene", "action", "style", "camera", "light", "mood", "sound", "output", "workflow"]


def assignment_routes(assignments: dict) -> dict:
    return {
        task_id: {
            "providerId": value.get("providerId", ""),
            "model": value.get("model", ""),
        }
        for task_id, value in assignments.items()
    }


def complete_visual_analysis() -> dict:
    return {
        "description": "中央主体位于深色背景中。",
        "canvas": {
            "width": 1,
            "height": 1,
            "aspectRatio": "1:1",
            "orientation": "square",
            "dominantColors": [{"hex": "#101820", "coveragePercent": 70, "source": "estimated"}],
        },
        "elements": [{
            "id": "subject-1",
            "label": "中央主体",
            "category": "subject",
            "box_2d": [150, 250, 850, 750],
            "coveragePercent": 35,
            "depthLayer": "foreground",
            "occludes": [],
            "occludedBy": [],
            "relationships": ["位于画面中央"],
            "visualAttributes": ["清晰轮廓"],
        }],
        "dimensions": [{
            "id": dimension,
            "applicable": dimension != "sound",
            "facts": [] if dimension == "sound" else [f"{dimension} 可见事实"],
            "measurements": [],
        } for dimension in DIMENSIONS],
        "OCR": [],
        "reconstructionPrompt": "深色背景中的中央主体，保持清晰轮廓和居中构图。",
        "limitations": ["无法确认画外信息"],
        "completeness": {"checkedRegions": ["四角", "主体", "背景", "文字"], "omittedVisibleElements": []},
        "tags": [{"g": "camera.composition", "t": "居中构图"}],
    }


def assert_deepseek_dynamic_image_analysis() -> None:
    catalog = {"visible": True}
    vision_requests: list[dict] = []
    openai_paid_requests: list[str] = []
    model_id = "opaque-account-model-2026"

    def mock_deepseek(route) -> None:
        if route.request.method == "GET" and route.request.url == "https://api.deepseek.com/models":
            models = [{"id": model_id}] if catalog["visible"] else []
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"data": models}),
            )
            return
        if route.request.method == "POST" and route.request.url == "https://api.deepseek.com/chat/completions":
            payload = route.request.post_data_json
            vision_requests.append(payload)
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "model": model_id,
                    "choices": [{"message": {"content": json.dumps(complete_visual_analysis(), ensure_ascii=False)}}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
                }, ensure_ascii=False),
            )
            return
        route.fulfill(status=500, content_type="application/json", body='{"error":{"message":"unexpected DeepSeek request"}}')

    def block_openai(route) -> None:
        if route.request.method == "GET" and route.request.url == "https://api.openai.com/v1/models":
            route.fulfill(
                status=200,
                content_type="application/json",
                body='{"data":[{"id":"declared-openai-vision","input_modalities":["text","image"],"output_modalities":["text"]}]}',
            )
            return
        openai_paid_requests.append(route.request.url)
        route.fulfill(status=500, content_type="application/json", body='{"error":{"message":"unexpected fallback"}}')

    entry = base_entry(
        "deepseek-dynamic-vision",
        "动态模型图片分析",
        "只用于本地浏览器验收。",
        "content:prompt:image",
    )
    entry["mediaAssets"] = [{
        "id": "deepseek-dynamic-image",
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
        "byteSize": 68,
    }]
    entry["primaryMediaId"] = "deepseek-dynamic-image"

    with extension_session("prompt-director-deepseek-vision-", viewport={"width": 1280, "height": 900}) as run:
        run.context.route("https://api.deepseek.com/**", mock_deepseek)
        run.context.route("https://api.openai.com/**", block_openai)
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [entry],
            "uiPreferences": {"locale": "zh-CN", "theme": "system", "motion": "system"},
            "aiProviderRegistry": {
                "version": 4,
                "providers": {
                    "deepseek": {"apiKey": "deepseek-e2e-key", "consent": True},
                    "openai": {
                        "apiKey": "openai-e2e-key",
                        "consent": True,
                        "models": {"imageAnalysis": "declared-openai-vision"},
                        "discoveredModels": [{
                            "id": "declared-openai-vision",
                            "name": "OpenAI 对照模型",
                            "status": "available",
                            "confidence": "declared",
                            "source": "fixture",
                            "tasks": ["imageAnalysis"],
                            "inputModalities": ["text", "image"],
                            "outputModalities": ["text"],
                        }],
                    },
                },
            },
            "aiTaskAssignments": {},
        })
        setup.evaluate(
            f"""async () => {{
              const {{saveMediaBlob}} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob('{PNG}'), value => value.charCodeAt(0));
              await saveMediaBlob('deepseek-dynamic-image', new Blob([bytes], {{type: 'image/png'}}), {{checkCapacity: false}});
            }}"""
        )

        library = run.open_page("library.html", wait_until="networkidle")
        library.wait_for_timeout(1_000)
        library_state = library.locator("body").get_attribute("data-library-state")
        assert library_state == "ready", {
            "libraryState": library_state,
            "pageErrors": run.page_errors,
            "loadingText": library.locator("#library-loading").text_content(),
        }
        if not library.locator("#settings-dialog").is_visible():
            library.locator("#open-settings").click()
        library.locator('[data-settings-tab="ai"]').click()
        library.locator('[data-ai-routing-tab="providers"]').click()
        deepseek_row = library.locator('[data-provider-id="deepseek"]')
        deepseek_row.get_by_role("button", name="刷新模型").click()
        expect(library.locator("#feedback")).to_contain_text("DeepSeek 已发现 1 个模型")
        expect(deepseek_row).to_contain_text("模型目录已读取 · 1 个模型")

        library.locator('[data-ai-routing-tab="tasks"]').click()
        image_task = library.locator("#ai-assignment-list .ai-assignment-row", has_text="图片分析")
        image_task.get_by_role("button", name="配置").click()
        dialog = library.locator("#promptdirector-app-dialog")
        provider_select = dialog.locator('[data-field-id="providerId"] select')
        model_select = dialog.locator('[data-field-id="model"] select')
        provider_select.select_option("deepseek")
        expect(model_select).to_have_value(model_id)
        expect(model_select.locator("option")).to_have_text(model_id)
        expect(dialog.locator(".model-capability-help")).to_have_count(1)
        expect(dialog.locator(".model-capability-help")).to_contain_text("当前模型未声明这项能力；是否可用以真实执行结果为准")
        expect(dialog).not_to_contain_text("实验")
        dialog.get_by_role("button", name="保存任务路由").click()
        expect(dialog).to_be_hidden()
        expect(image_task).to_contain_text(f"DeepSeek · {model_id}")

        stored_assignment = library.evaluate(
            "() => chrome.storage.local.get('aiTaskAssignments').then(value => value.aiTaskAssignments.imageAnalysis)"
        )
        assert stored_assignment == {
            "providerId": "deepseek",
            "model": model_id,
            "evidence": "manual_unverified",
            "managedBy": "task",
            "concurrency": 10,
        }, stored_assignment
        runtime = library.evaluate(
            "() => chrome.runtime.sendMessage({type: 'GET_AI_TASK_RUNTIME', taskId: 'imageAnalysis'})"
        )
        assert runtime["assignment"] == stored_assignment, runtime
        assert runtime["visionSettings"]["compatible"]["structuredOutput"] == "json_object", runtime
        assert runtime["runtimeDescriptor"]["capabilities"]["image"] is None, runtime

        analyzed = library.evaluate(
            """async () => chrome.runtime.sendMessage({
              type: 'ANALYZE_ENTRY_IMAGE',
              entryId: 'deepseek-dynamic-vision',
              visualId: 'deepseek-dynamic-image',
              outputLocale: 'zh-CN'
            })"""
        )
        assert analyzed["ok"] is True, analyzed
        assert len(vision_requests) == 1, vision_requests
        request = vision_requests[0]
        assert request["model"] == model_id, request
        assert request["response_format"] == {"type": "json_object"}, request
        content = request["messages"][0]["content"]
        assert [item["type"] for item in content] == ["text", "image_url"], content
        assert "JSON property names are case-sensitive" in content[0]["text"], content[0]
        assert '\"required\":[\"reconstructionPrompt\",\"tags\"]' in content[0]["text"], content[0]
        assert '\"ocr\"' not in content[0]["text"], content[0]
        assert content[1]["image_url"]["url"].startswith("data:image/png;base64,"), content
        assert not openai_paid_requests, openai_paid_requests

        catalog["visible"] = False
        library.locator('[data-ai-routing-tab="providers"]').click()
        deepseek_row.get_by_role("button", name="刷新模型").click()
        expect(deepseek_row).to_contain_text("1 个下架或当前不可用")
        library.locator('[data-ai-routing-tab="tasks"]').click()
        expect(image_task).to_contain_text(f"DeepSeek · {model_id}")
        expect(image_task).to_contain_text("已分配但模型不可用")

        disappeared = library.evaluate(
            """async () => {
              try {
                return await chrome.runtime.sendMessage({
                  type: 'ANALYZE_ENTRY_IMAGE',
                  entryId: 'deepseek-dynamic-vision',
                  visualId: 'deepseek-dynamic-image',
                  outputLocale: 'zh-CN'
                });
              } catch (error) {
                return {ok: false, rejected: true, message: error.message};
              }
            }"""
        )
        assert disappeared["ok"] is False, disappeared
        assert "已下架" in disappeared["message"] or "不可用" in disappeared["message"], disappeared
        assert len(vision_requests) == 1, vision_requests
        assert not openai_paid_requests, openai_paid_requests
        final_state = library.evaluate(
            "() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])"
        )
        assert final_state["aiTaskAssignments"]["imageAnalysis"] == stored_assignment, final_state
        assert final_state["aiProviderRegistry"]["providers"]["deepseek"]["discoveredModels"][0]["status"] == "unavailable", final_state

        print({
            "manualDeepSeekImageAssignment": True,
            "requestFormat": "image_url+json_object",
            "disappearedModelBlocked": True,
            "silentFallbackRequests": len(openai_paid_requests),
            "realPaidRequests": 0,
        })


def open_ai_settings(run):
    library = run.open_page("library.html", wait_until="networkidle")
    if not library.locator("#settings-dialog").is_visible():
        library.locator("#open-settings").click()
    library.locator('[data-settings-tab="ai"]').click()
    return library


def assert_new_install_defaults() -> None:
    with extension_session("prompt-director-ai-registry-new-") as run:
        library = open_ai_settings(run)

        expect(library.locator("#ai-provider-list .ai-provider-row")).to_have_count(11)
        expect(library.locator('#ai-provider-list [data-provider-category="official"]')).to_contain_text("官方服务")
        expect(library.locator('#ai-provider-list [data-provider-category="aggregator"]')).to_contain_text("聚合平台")
        expect(library.locator('#ai-provider-list [data-provider-category="custom"]')).to_contain_text("自定义兼容服务")
        expect(library.locator('[data-provider-id="kimi"]')).to_contain_text("Kimi")
        expect(library.locator("#ai-assignment-list .ai-assignment-row")).to_have_count(7)
        expect(library.locator("#ai-assignment-list .ai-assignment-row", has_text="未连接可用服务")).to_have_count(7)
        expect(library.locator("#ai-provider-list")).to_contain_text("模型目录未读取")

        stored = library.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])")
        assert set(stored["aiTaskAssignments"].keys()) == TASK_IDS, stored
        assert all(value["providerId"] == "" and value["model"] == "" for value in stored["aiTaskAssignments"].values()), stored
        assert {
            task_id: value["concurrency"]
            for task_id, value in stored["aiTaskAssignments"].items()
        } == {
            "textTags": 20,
            "skillExtraction": 20,
            "creativePlanning": 20,
            "imageAnalysis": 10,
            "videoAnalysis": 2,
            "imageGeneration": 10,
            "videoGeneration": 10,
        }, stored
        assert stored["aiProviderRegistry"]["version"] == 5, stored

        execution_state = library.evaluate(
            "() => chrome.runtime.sendMessage({type: 'GET_CREATIVE_JOB_EXECUTION_STATE'})"
        )
        assert execution_state["ok"] is True, execution_state
        assert execution_state["aiSettings"]["analysisModel"] == "", execution_state
        assert execution_state["aiSettings"]["compatible"] == {
            "endpoint": "", "model": "", "apiKey": "", "structuredOutput": "json_object"
        }, execution_state

        library.evaluate(
            """async () => {
              const stored = await chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments']);
              stored.aiProviderRegistry.providers.deepseek.discoveredModels = [{
                id: 'retired-model', name: 'retired-model', status: 'unavailable',
                confidence: 'declared', tasks: ['textTags']
              }];
              stored.aiProviderRegistry.providers.deepseek.discovery = {
                discoveredAt: '2026-08-12T00:00:00.000Z', source: 'provider_cache', error: '目录服务暂时不可用'
              };
              stored.aiProviderRegistry.providers.kimi.discoveredModels = [{
                id: 'kimi-current', name: 'kimi-current', status: 'available',
                confidence: 'declared', tasks: ['textTags']
              }];
              stored.aiProviderRegistry.providers.kimi.discovery = {
                discoveredAt: '2026-08-12T00:00:00.000Z', source: 'provider_models', error: ''
              };
              stored.aiTaskAssignments.textTags = {providerId: 'deepseek', model: 'retired-model'};
              await chrome.storage.local.set(stored);
              location.reload();
            }"""
        )
        library.wait_for_load_state("networkidle")
        if not library.locator("#settings-dialog").is_visible():
            library.locator("#open-settings").click()
        library.locator('[data-settings-tab="ai"]').click()
        expect(library.locator('[data-provider-id="deepseek"]')).to_contain_text("模型目录读取失败：目录服务暂时不可用；保留 1 个模型")
        expect(library.locator('[data-provider-id="kimi"]')).to_contain_text("模型目录已读取 · 1 个模型")
        expect(library.locator('[data-provider-id="kimi"]')).not_to_contain_text("尚未执行模型调用验证")
        expect(library.locator("#ai-assignment-list .ai-assignment-row", has_text="文字标签")).to_contain_text("连接需修复：API Key 或发送授权无效")


def assert_english_ai_settings() -> None:
    with extension_session("prompt-director-ai-registry-en-", viewport={"width": 1280, "height": 900}) as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [],
            "uiPreferences": {"locale": "en", "theme": "system", "motion": "system"},
        })
        library = open_ai_settings(run)
        chinese = re.compile(r"[\u3400-\u9fff]")

        expect(library.locator("html")).to_have_attribute("lang", "en")
        expect(library.locator("#settings-ai-panel")).not_to_contain_text(chinese, use_inner_text=True)
        expect(library.locator("#ai-assignment-list .ai-assignment-row", has_text="No usable service connected")).to_have_count(7)
        expect(library.locator('[data-provider-id="volcengine"]')).to_contain_text("Volcengine")

        library.locator("#ai-assignment-list .ai-assignment-row").first.get_by_role("button", name="Configure").click()
        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog).not_to_contain_text(chinese, use_inner_text=True)
        expect(library.locator("#feedback")).to_contain_text(
            "No connected model can be assigned to Text tags. Connect a service and refresh its model catalog first."
        )
        dialog.locator(".app-dialog-close").click()

        library.locator('[data-ai-routing-tab="providers"]').click()
        library.locator("#open-ai-routing").click()
        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog).not_to_contain_text(chinese, use_inner_text=True)
        dialog.locator("#promptdirector-app-dialog-providerEditor").select_option("custom-media")
        dialog.locator(".app-dialog-advanced-settings > summary").click()
        expect(dialog).not_to_contain_text(chinese, use_inner_text=True)
        expect(dialog.get_by_role("button", name="Fill Micu personal relay preset")).to_be_visible()
        dialog.locator(".app-dialog-close").click()


def main() -> None:
    assert_new_install_defaults()
    assert_english_ai_settings()
    assert_deepseek_dynamic_image_analysis()
    with extension_session("prompt-director-ai-registry-", viewport={"width": 1280, "height": 900}) as run:
        model_authorizations: list[str] = []
        gemini_model_requests: list[dict[str, str]] = []
        gemini_interaction_calls = 0

        def mock_models(route) -> None:
            model_authorizations.append(route.request.headers.get("authorization", ""))
            route.fulfill(
                status=200,
                content_type="application/json",
                body='{"data":[{"id":"gpt-5.6-terra"},{"id":"gpt-image-2"}]}',
            )

        def mock_openai_models(route) -> None:
            route.fulfill(
                status=200,
                content_type="application/json",
                body=(
                    '{"data":[{"id":"gpt-text-catalog-only",'
                    '"input_modalities":["text"],"output_modalities":["text"]}]}'
                ),
            )

        def mock_gemini_models(route) -> None:
            gemini_model_requests.append({
                "url": route.request.url,
                "api_key": route.request.headers.get("x-goog-api-key", ""),
                "authorization": route.request.headers.get("authorization", ""),
            })
            route.fulfill(
                status=200,
                content_type="application/json",
                body=(
                    '{"models":['
                    '{"name":"models/gemini-2.5-flash","displayName":"Gemini 2.5 Flash",'
                    '"supportedGenerationMethods":["generateContent"]},'
                    '{"name":"models/gemini-3.1-flash-image","displayName":"Nano Banana 2",'
                    '"supportedGenerationMethods":["generateContent"]},'
                    '{"name":"models/gemini-image-preview","displayName":"Image Preview",'
                    '"supportedGenerationMethods":["generateContent"]}'
                    ']}'
                ),
            )

        def block_gemini_interactions(route) -> None:
            nonlocal gemini_interaction_calls
            gemini_interaction_calls += 1
            route.fulfill(status=500, content_type="application/json", body='{"error":{"message":"unexpected paid call"}}')

        run.context.route("https://www.micuapi.ai/v1/models", mock_models)
        run.context.route("https://api.openai.com/v1/models", mock_openai_models)
        run.context.route("https://generativelanguage.googleapis.com/v1beta/models", mock_gemini_models)
        run.context.route("https://generativelanguage.googleapis.com/v1beta/interactions", block_gemini_interactions)
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [],
            "uiPreferences": {"locale": "zh-CN", "theme": "system", "motion": "system"},
            "aiProviderRegistry": {
                "version": 4,
                "providers": {
                    "deepseek": {
                        "apiKey": "deepseek-secret",
                        "consent": True,
                        "models": {"textTags": "deepseek-text", "skillExtraction": "deepseek-text", "creativePlanning": "deepseek-text"},
                    },
                    "openai": {
                        "apiKey": "openai-secret",
                        "consent": True,
                        "models": {"imageAnalysis": "openai-vision"},
                    },
                    "gemini": {
                        "apiKey": "gemini-secret",
                        "consent": True,
                        "models": {"videoAnalysis": "gemini-video"},
                    },
                    "xai": {
                        "apiKey": "xai-secret",
                        "consent": True,
                        "models": {"creativePlanning": "grok-text", "imageGeneration": "grok-image"},
                    },
                    "custom-media": {
                        "endpoint": "https://www.micuapi.ai/v1/responses",
                        "protocol": "responses",
                        "apiKey": "micu-vision-secret",
                        "consent": True,
                        "models": {"imageAnalysis": "gpt-5.6-terra", "imageGeneration": "gpt-image-2"},
                        "imageGeneration": {
                            "protocol": "images_generations",
                            "endpoint": "https://www.micuapi.ai/v1/images/generations",
                            "editsEndpoint": "https://www.micuapi.ai/v1/images/edits",
                            "apiKey": "micu-image-secret",
                            "model": "gpt-image-2",
                        },
                    },
                },
            },
            "aiTaskAssignments": {
                "textTags": {"providerId": "deepseek", "model": "deepseek-text"},
                "skillExtraction": {"providerId": "deepseek", "model": "deepseek-text"},
                "creativePlanning": {"providerId": "xai", "model": "grok-text"},
                "imageAnalysis": {"providerId": "custom-media", "model": "gpt-5.6-terra"},
                "videoAnalysis": {"providerId": "gemini", "model": "gemini-video"},
                "imageGeneration": {"providerId": "custom-media", "model": "gpt-image-2"},
                "videoGeneration": {"providerId": "", "model": ""},
            },
        })
        library = open_ai_settings(run)

        expect(library.locator("#ai-provider-list .ai-provider-row")).to_have_count(11)
        expect(library.locator("#ai-assignment-list .ai-assignment-row")).to_have_count(7)
        expect(library.locator('[data-ai-routing-panel="tasks"]')).to_be_visible()
        expect(library.locator('[data-ai-routing-panel="providers"]')).to_be_hidden()
        library.locator('[data-ai-routing-tab="providers"]').click()
        expect(library.locator('[data-ai-routing-panel="providers"]')).to_be_visible()
        expect(library.locator("#ai-provider-list")).to_contain_text("DeepSeek")
        expect(library.locator("#ai-provider-list")).to_contain_text("OpenAI")
        expect(library.locator("#ai-provider-list")).to_contain_text("Google Gemini")
        expect(library.locator("#ai-provider-list")).to_contain_text("xAI")
        expect(library.locator("#ai-provider-list")).to_contain_text("自定义兼容服务（图片与生成）")
        expect(library.locator("#ai-provider-list")).to_contain_text("Kimi")
        expect(library.locator("#open-ai-routing")).to_have_text("连接 AI 服务")
        expect(library.locator("#ai-provider-list").get_by_role("button", name="编辑配置")).to_have_count(5)
        expect(library.locator("#settings-ai-panel > .ai-advanced-settings")).not_to_have_attribute("open", "")
        expect(library.locator("#settings-ai-panel > .ai-advanced-settings > summary")).to_contain_text("分析规则与创作方法（高级）")
        expect(library.locator("#deepseek-api-key")).to_have_count(0)
        expect(library.locator("#vision-provider")).to_have_count(0)
        expect(library.locator("#text-ai-provider")).to_have_count(0)
        library.locator("#settings-ai-panel > .ai-advanced-settings > summary").click()
        expect(library.locator("#analysis-instructions-zh")).to_be_visible()
        expect(library.locator("#ai-settings-status")).to_contain_text("规则保存在本机")
        assignments_before_rules = library.evaluate("() => chrome.storage.local.get('aiTaskAssignments').then(value => value.aiTaskAssignments)")
        library.locator("#analysis-instructions-zh").fill("只保存统一 Registry 的文字分析规则")
        text_save = library.locator("#ai-settings-form").get_by_role("button", name="保存分析规则")
        text_save.click()
        library.wait_for_function(
            """expected => chrome.storage.local.get('aiPreferences').then(value =>
              value.aiPreferences?.textInstructionsByLocale?.['zh-CN'] === expected)""",
            arg="只保存统一 Registry 的文字分析规则",
        )
        expect(text_save).to_be_enabled()
        library.locator('[data-analysis-kind="vision"]').click()
        expect(library.locator("#vision-instructions-zh")).to_be_visible()
        expect(library.locator("#vision-settings-status")).to_contain_text("规则保存在本机")
        library.locator("#vision-instructions-zh").fill("只保存统一 Registry 的图片分析规则")
        vision_save = library.locator("#vision-settings-form").get_by_role("button", name="保存分析规则")
        vision_save.click()
        library.wait_for_function(
            """expected => chrome.storage.local.get('aiPreferences').then(value =>
              value.aiPreferences?.visionInstructionsByLocale?.['zh-CN'] === expected)""",
            arg="只保存统一 Registry 的图片分析规则",
        )
        expect(vision_save).to_be_enabled()
        saved_preferences = library.evaluate("() => chrome.storage.local.get(['aiPreferences', 'aiTaskAssignments'])")
        assert saved_preferences["aiPreferences"]["textInstructionsByLocale"]["zh-CN"] == "只保存统一 Registry 的文字分析规则"
        assert saved_preferences["aiPreferences"]["visionInstructionsByLocale"]["zh-CN"] == "只保存统一 Registry 的图片分析规则"
        assert assignment_routes(saved_preferences["aiTaskAssignments"]) == assignment_routes(assignments_before_rules), {
            "before": assignments_before_rules,
            "after": saved_preferences["aiTaskAssignments"],
        }

        library.wait_for_function(
            """() => chrome.runtime.sendMessage({type: 'GET_AI_TASK_RUNTIME', taskId: 'imageAnalysis'})
              .then(runtime => runtime.assignment?.providerId === 'custom-media'
                && runtime.assignment?.model === 'gpt-5.6-terra')"""
        )
        image_runtime = library.evaluate("() => chrome.runtime.sendMessage({type: 'GET_AI_TASK_RUNTIME', taskId: 'imageAnalysis'})")
        assert image_runtime["ok"] is True, image_runtime
        assert assignment_routes({"imageAnalysis": image_runtime["assignment"]})["imageAnalysis"] == {
            "providerId": "custom-media", "model": "gpt-5.6-terra"
        }, image_runtime

        library.locator("#open-ai-routing").click()
        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog).to_be_visible()
        dialog.locator("#promptdirector-app-dialog-providerEditor").select_option("openrouter")
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor")).to_have_value("openrouter")
        expect(dialog.locator("#promptdirector-app-dialog-provider_openrouter_apiKey")).to_be_visible()
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option")).to_have_count(11)
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option", has_text="官方服务 · 智谱 GLM")).to_have_count(1)
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option", has_text="官方服务 · Kimi")).to_have_count(1)
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option", has_text="聚合平台 · OpenRouter")).to_have_count(1)
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option", has_text="自定义兼容服务 · 自定义兼容服务（图片与生成）")).to_have_count(1)
        expect(dialog.locator('[data-field-id^="provider_"]:visible')).to_have_count(3)
        expect(dialog.locator('[data-field-id="provider_openrouter_analysisModel"]')).to_be_visible()
        expect(dialog.locator('[data-field-id^="assignment_"]')).to_have_count(0)
        password_values = dialog.locator('input[type="password"]').evaluate_all("nodes => nodes.map(node => node.value)")
        assert all(value == "" for value in password_values), password_values
        expect(dialog.locator('input[type="password"]:visible')).to_have_count(0)
        assert "secret" not in dialog.text_content()
        dialog.evaluate("node => node.dispatchEvent(new MouseEvent('click', {bubbles: true}))")
        expect(dialog).to_be_visible()
        dialog.locator(".app-dialog-close").click()
        expect(dialog).to_be_visible()
        expect(dialog.locator(".app-dialog-status")).to_contain_text("有未保存的更改")
        dialog.get_by_role("button", name="确认放弃").click()
        expect(dialog).to_be_hidden()
        library.locator("#open-ai-routing").click()
        dialog = library.locator("#promptdirector-app-dialog")
        dialog.locator("#promptdirector-app-dialog-providerEditor").select_option("custom-media")
        analysis_key = dialog.locator("#promptdirector-app-dialog-provider_custom_media_apiKey")
        image_key = dialog.locator("#promptdirector-app-dialog-provider_custom_media_imageApiKey")
        image_endpoint = dialog.locator("#promptdirector-app-dialog-provider_custom_media_imageEndpoint")
        expect(analysis_key).to_be_visible()
        expect(image_key).to_be_visible()
        expect(analysis_key).to_have_attribute("data-secret-input", "true")
        expect(image_key).to_have_attribute("data-secret-input", "true")
        expect(analysis_key).to_have_attribute("readonly", "")
        expect(image_key).to_have_attribute("readonly", "")
        expect(analysis_key).to_have_attribute("autocomplete", "new-password")
        expect(image_key).to_have_attribute("autocomplete", "new-password")
        analysis_key.click()
        analysis_key.fill("replacement-analysis-secret")
        image_key.click()
        image_key.fill("replacement-image-secret")
        library.wait_for_timeout(500)
        expect(analysis_key).to_have_value("replacement-analysis-secret")
        expect(image_key).to_have_value("replacement-image-secret")
        expect(image_key).to_have_attribute("placeholder", "已保存（尾号 cret）；留空保持不变")
        expect(image_endpoint).to_be_hidden()
        dialog.locator(".app-dialog-advanced-settings > summary").click()
        micu_preset = dialog.get_by_role("button", name="填入米醋个人中转预设")
        expect(micu_preset).to_be_visible()
        micu_preset.click()
        expect(dialog.locator("#promptdirector-app-dialog-provider_custom_media_endpoint")).to_have_value("https://www.micuapi.ai/v1/responses")
        expect(dialog.locator("#promptdirector-app-dialog-provider_custom_media_protocol")).to_have_value("responses")
        expect(image_endpoint).to_be_visible()
        expect(image_endpoint).to_have_value("https://www.micuapi.ai/v1/images/generations")
        expect(dialog.locator("#promptdirector-app-dialog-provider_custom_media_imageEditsEndpoint")).to_have_value("https://www.micuapi.ai/v1/images/edits")
        image_model = dialog.locator("#promptdirector-app-dialog-provider_custom_media_model_imageGeneration")
        expect(image_model).to_be_visible()
        expect(image_model).to_have_value("gpt-image-2")
        expect(dialog.locator("#promptdirector-app-dialog-provider_custom_media_imageSizes")).to_have_value(
            "1024x1024, 1280x720, 720x1280, 1024x1536, 1536x1024, 2048x2048, 2048x1152, 1152x2048"
        )
        assert image_key.bounding_box()["y"] < image_endpoint.bounding_box()["y"], "生图 Key 必须位于高级接口字段之前"
        expect(dialog).to_contain_text("能力声明，不是本轮输出值")
        assignments_before_save = library.evaluate("() => chrome.storage.local.get('aiTaskAssignments').then(value => value.aiTaskAssignments)")
        library.evaluate("() => { chrome.permissions.request = async () => true; }")
        dialog.get_by_role("button", name="保存配置").click()
        expect(dialog).to_be_hidden()
        expect(library.locator("#feedback")).to_contain_text("模型目录中可见 gpt-image-2")
        expect(library.locator("#feedback")).to_contain_text("不代表米醋已授权")
        assert model_authorizations[-1:] == ["Bearer replacement-image-secret"], model_authorizations
        saved_keys = library.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])")
        custom_media = saved_keys["aiProviderRegistry"]["providers"]["custom-media"]
        assert custom_media["apiKey"] == "replacement-analysis-secret"
        assert custom_media["imageGeneration"]["apiKey"] == "replacement-image-secret"
        assert assignment_routes(saved_keys["aiTaskAssignments"]) == assignment_routes(assignments_before_save)

        library.locator('[data-provider-id="openai"]').get_by_role("button", name="编辑配置").click()
        openai_dialog = library.locator("#promptdirector-app-dialog")
        expect(openai_dialog).to_be_visible()
        expect(openai_dialog.locator("#promptdirector-app-dialog-providerEditor")).to_have_value("openai")
        openai_dialog.get_by_role("button", name="读取模型").click()
        openai_analysis_model = openai_dialog.locator("#promptdirector-app-dialog-provider_openai_analysisModel")
        expect(openai_analysis_model.locator("option")).to_have_count(2)
        openai_analysis_model.select_option("gpt-text-catalog-only")
        openai_image_model = openai_dialog.locator("#promptdirector-app-dialog-provider_openai_model_imageGeneration")
        expect(openai_image_model).to_be_hidden()
        openai_dialog.locator(".app-dialog-advanced-settings > summary").click()
        expect(openai_image_model).to_be_visible()
        assert openai_image_model.evaluate("node => node.tagName") == "INPUT"
        openai_image_model.fill("openai-account-image-model")
        openai_assignments_before_save = library.evaluate("() => chrome.storage.local.get('aiTaskAssignments').then(value => value.aiTaskAssignments)")
        openai_dialog.get_by_role("button", name="保存配置").click()
        expect(openai_dialog).to_be_hidden()
        openai_saved = library.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])")
        assert openai_saved["aiProviderRegistry"]["providers"]["openai"]["models"]["imageGeneration"] == "openai-account-image-model"
        assert openai_saved["aiProviderRegistry"]["providers"]["openai"]["discovery"]["discoveredAt"]
        openai_catalog = {
            model["id"]: model["status"]
            for model in openai_saved["aiProviderRegistry"]["providers"]["openai"]["discoveredModels"]
        }
        assert openai_catalog == {
            "gpt-text-catalog-only": "available",
            "openai-vision": "unavailable",
        }, openai_catalog
        assert assignment_routes(openai_saved["aiTaskAssignments"]) == assignment_routes(openai_assignments_before_save)

        library.locator('[data-ai-routing-tab="tasks"]').click()
        generation_task = library.locator("#ai-assignment-list .ai-assignment-row", has_text="图片生成")
        generation_task.get_by_role("button", name="更换").click()
        generation_dialog = library.locator("#promptdirector-app-dialog")
        expect(generation_dialog.locator('[data-field-id="providerId"] option[value="openai"]')).to_have_count(0)
        expect(generation_dialog).not_to_contain_text("openai-account-image-model")
        generation_dialog.locator(".app-dialog-close").click()
        expect(generation_dialog).to_be_hidden()

        image_task = library.locator("#ai-assignment-list .ai-assignment-row", has_text="图片分析")
        expect(image_task).to_contain_text("自定义兼容服务（图片与生成） · gpt-5.6-terra")
        image_task.get_by_role("button", name="更换").click()
        task_dialog = library.locator("#promptdirector-app-dialog")
        expect(task_dialog.locator('[data-field-id="providerId"]')).to_be_visible()
        expect(task_dialog.locator('[data-field-id="model"]')).to_be_visible()
        expect(task_dialog.locator('[data-field-id="concurrency"]')).to_be_visible()
        expect(task_dialog.locator('[data-field-id="concurrency"] input')).to_have_value("10")
        expect(task_dialog.locator('[data-field-id="highConcurrencyConfirmed"]')).to_be_hidden()
        task_dialog.locator(".app-dialog-close").click()

        stored = library.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])")
        assert stored["aiProviderRegistry"]["providers"]["deepseek"]["apiKey"] == "deepseek-secret"
        assert set(stored["aiTaskAssignments"].keys()) == TASK_IDS
        assert assignment_routes(stored["aiTaskAssignments"]) == assignment_routes(assignments_before_save)

        assignments_before_nano = stored["aiTaskAssignments"]
        library.locator('[data-ai-routing-tab="providers"]').click()
        library.locator('[data-provider-id="gemini"]').get_by_role("button", name="刷新模型").click()
        expect(library.locator("#feedback")).to_contain_text("Google Gemini 已发现")
        assert gemini_model_requests, gemini_model_requests
        assert all(request == {
            "url": "https://generativelanguage.googleapis.com/v1beta/models",
            "api_key": "gemini-secret",
            "authorization": "",
        } for request in gemini_model_requests), gemini_model_requests

        gemini_catalog = library.evaluate(
            "() => chrome.storage.local.get('aiProviderRegistry').then(value => value.aiProviderRegistry.providers.gemini.discoveredModels)"
        )
        nano = next(model for model in gemini_catalog if model["id"] == "gemini-3.1-flash-image")
        ordinary = next(model for model in gemini_catalog if model["id"] == "gemini-2.5-flash")
        preview = next(model for model in gemini_catalog if model["id"] == "gemini-image-preview")
        assert "imageGeneration" in nano["tasks"]
        assert nano["supportedResolutions"] == ["512px", "1K", "2K", "4K"]
        assert nano["referenceImages"]["maxItems"] == 14
        assert "imageGeneration" not in ordinary["tasks"]
        assert "imageGeneration" not in preview["tasks"]

        library.locator('[data-ai-routing-tab="tasks"]').click()
        generation_task = library.locator("#ai-assignment-list .ai-assignment-row", has_text="图片生成")
        generation_task.get_by_role("button", name="更换").click()
        nano_dialog = library.locator("#promptdirector-app-dialog")
        nano_dialog.locator('[data-field-id="providerId"] select').select_option("gemini")
        nano_model = nano_dialog.locator('[data-field-id="model"] select')
        expect(nano_model.locator("option")).to_have_count(1)
        expect(nano_model).to_have_value("gemini-3.1-flash-image")
        expect(nano_dialog).to_contain_text("Nano Banana 2")
        nano_dialog.get_by_role("button", name="保存任务路由").click()
        expect(nano_dialog).to_be_hidden()

        nano_saved = library.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])")
        assert nano_saved["aiTaskAssignments"]["imageGeneration"] == {
            "providerId": "gemini", "model": "gemini-3.1-flash-image", "concurrency": 10,
            "managedBy": "task",
        }
        assert assignment_routes({
            task: value for task, value in nano_saved["aiTaskAssignments"].items() if task != "imageGeneration"
        }) == assignment_routes({
            task: value for task, value in assignments_before_nano.items() if task != "imageGeneration"
        })
        public_state = library.evaluate("() => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert "gemini-secret" not in str(public_state)

        library.evaluate(
            """async () => {
              const now = new Date().toISOString();
              await chrome.storage.local.set({composerSessions: [{
                id: 'nano-parameter-session', title: 'Nano Banana 参数验证',
                targetType: 'image', routeMode: 'compose', outputMode: 'create_image',
                aiProfile: {serviceId: 'xai', model: 'grok-text', thinking: false},
                generationAiProfile: {serviceId: 'gemini', model: 'gemini-3.1-flash-image', thinking: false},
                generationParameters: {},
                messages: [{id: 'nano-request', role: 'user', type: 'request', content: '生成电影海报', createdAt: now}],
                createdAt: now, updatedAt: now
              }]});
            }"""
        )
        composer = run.open_page("composer.html?session=nano-parameter-session", wait_until="networkidle")
        composer.locator("#composer-options summary").click()
        expect(composer.locator("#composer-generation-settings")).to_be_visible()
        expect(composer.locator("#composer-image-size-field > span")).to_have_text("画幅比例")
        expect(composer.locator("#composer-image-quality-field > span")).to_have_text("图片尺寸")
        expect(composer.locator("#composer-image-size")).to_have_value("1:1")
        expect(composer.locator("#composer-image-quality")).to_have_value("512px")
        composer.locator("#composer-image-size").select_option("16:9")
        composer.locator("#composer-image-quality").select_option("2K")
        expect(composer.locator("#composer-image-size")).to_have_value("16:9")
        expect(composer.locator("#composer-image-quality")).to_have_value("2K")
        composer_parameters = composer.evaluate(
            """() => chrome.runtime.sendMessage({
              type: 'GET_COMPOSER_SESSION', sessionId: 'nano-parameter-session'
            }).then(response => response.session.generationParameters)"""
        )
        assert composer_parameters["aspectRatio"] == "16:9", composer_parameters
        assert composer_parameters["imageSize"] == "2K", composer_parameters
        assert gemini_interaction_calls == 0
        print({"providersShown": 11, "connectedProviders": 5, "taskAssignments": 7, "newInstallUnassigned": True, "nanoBananaCatalogAssigned": True, "nanoBananaComposerParameters": True, "paidCalls": 0, "unifiedPreferencesSaved": True, "credentialsExposed": False})


if __name__ == "__main__":
    main()
