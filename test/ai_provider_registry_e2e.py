from __future__ import annotations

import re

from playwright.sync_api import expect

from e2e_support import extension_session


TASK_IDS = {
    "textTags",
    "skillExtraction",
    "creativePlanning",
    "imageAnalysis",
    "videoAnalysis",
    "imageGeneration",
    "videoGeneration",
}


def open_ai_settings(run):
    library = run.open_page("library.html", wait_until="networkidle")
    if not library.locator("#settings-dialog").is_visible():
        library.locator("#open-settings").click()
    library.locator('[data-settings-tab="ai"]').click()
    return library


def assert_new_install_defaults() -> None:
    with extension_session("prompt-director-ai-registry-new-") as run:
        library = open_ai_settings(run)

        expect(library.locator("#ai-provider-list .ai-provider-row")).to_have_count(10)
        expect(library.locator('#ai-provider-list [data-provider-category="official"]')).to_contain_text("官方服务")
        expect(library.locator('#ai-provider-list [data-provider-category="aggregator"]')).to_contain_text("聚合平台")
        expect(library.locator('#ai-provider-list [data-provider-category="custom"]')).to_contain_text("自定义兼容服务")
        expect(library.locator('[data-provider-id="kimi"]')).to_contain_text("Kimi")
        expect(library.locator("#ai-assignment-list .ai-assignment-row")).to_have_count(7)
        expect(library.locator("#ai-assignment-list .ai-assignment-row", has_text="尚未分配")).to_have_count(7)
        expect(library.locator("#ai-provider-list")).to_contain_text("模型目录未读取")

        stored = library.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])")
        assert set(stored["aiTaskAssignments"].keys()) == TASK_IDS, stored
        assert all(value == {"providerId": "", "model": ""} for value in stored["aiTaskAssignments"].values()), stored
        assert stored["aiProviderRegistry"]["version"] == 4, stored

        execution_state = library.evaluate(
            "() => chrome.runtime.sendMessage({type: 'GET_CREATIVE_JOB_EXECUTION_STATE'})"
        )
        assert execution_state["ok"] is True, execution_state
        assert execution_state["aiSettings"]["analysisModel"] == "", execution_state
        assert execution_state["aiSettings"]["compatible"] == {
            "endpoint": "", "model": "", "apiKey": ""
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
        expect(library.locator('[data-provider-id="kimi"]')).to_contain_text("模型目录已读取 · 1 个模型 · 尚未执行模型调用验证")
        expect(library.locator("#ai-assignment-list .ai-assignment-row", has_text="文字标签")).to_contain_text("已下架或当前不可用")


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
        expect(library.locator("#ai-assignment-list .ai-assignment-row", has_text="Not assigned")).to_have_count(7)
        expect(library.locator('[data-provider-id="volcengine"]')).to_contain_text("Volcengine")

        library.locator("#ai-assignment-list .ai-assignment-row").first.get_by_role("button", name="Configure").click()
        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog).not_to_contain_text(chinese, use_inner_text=True)
        expect(library.locator("#feedback")).to_contain_text("No connected service has a catalog model explicitly supporting Text tags")
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
                body='{"data":[{"id":"gpt-text-catalog-only"}]}',
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

        expect(library.locator("#ai-provider-list .ai-provider-row")).to_have_count(10)
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
        library.locator("#ai-settings-form").get_by_role("button", name="保存分析规则").click()
        expect(library.locator("#feedback")).to_contain_text("分析规则已保存")
        library.locator('[data-analysis-kind="vision"]').click()
        expect(library.locator("#vision-instructions-zh")).to_be_visible()
        expect(library.locator("#vision-settings-status")).to_contain_text("规则保存在本机")
        library.locator("#vision-instructions-zh").fill("只保存统一 Registry 的图片分析规则")
        library.locator("#vision-settings-form").get_by_role("button", name="保存分析规则").click()
        expect(library.locator("#feedback")).to_contain_text("分析规则已保存")
        saved_preferences = library.evaluate("() => chrome.storage.local.get(['aiPreferences', 'aiTaskAssignments'])")
        assert saved_preferences["aiPreferences"]["textInstructionsByLocale"]["zh-CN"] == "只保存统一 Registry 的文字分析规则"
        assert saved_preferences["aiPreferences"]["visionInstructionsByLocale"]["zh-CN"] == "只保存统一 Registry 的图片分析规则"
        assert saved_preferences["aiTaskAssignments"] == assignments_before_rules

        image_runtime = library.evaluate("() => chrome.runtime.sendMessage({type: 'GET_AI_TASK_RUNTIME', taskId: 'imageAnalysis'})")
        assert image_runtime["ok"] is True, image_runtime
        assert image_runtime["assignment"] == {"providerId": "custom-media", "model": "gpt-5.6-terra"}, image_runtime

        library.locator("#open-ai-routing").click()
        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog).to_be_visible()
        dialog.locator("#promptdirector-app-dialog-providerEditor").select_option("openrouter")
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor")).to_have_value("openrouter")
        expect(dialog.locator("#promptdirector-app-dialog-provider_openrouter_apiKey")).to_be_visible()
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option")).to_have_count(10)
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option", has_text="官方服务 · Kimi")).to_have_count(1)
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option", has_text="聚合平台 · OpenRouter")).to_have_count(1)
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option", has_text="自定义兼容服务 · 自定义兼容服务（图片与生成）")).to_have_count(1)
        expect(dialog.locator('[data-field-id^="provider_"]:visible')).to_have_count(2)
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
        assert image_key.bounding_box()["y"] < image_endpoint.bounding_box()["y"], "生图 Key 必须位于高级接口字段之前"
        expect(dialog).to_contain_text("能力声明，不是本轮输出值")
        assignments_before_save = library.evaluate("() => chrome.storage.local.get('aiTaskAssignments').then(value => value.aiTaskAssignments)")
        library.evaluate("() => { chrome.permissions.request = async () => true; }")
        dialog.get_by_role("button", name="保存配置").click()
        expect(dialog).to_be_hidden()
        expect(library.locator("#feedback")).to_contain_text("模型目录中可见 gpt-image-2")
        expect(library.locator("#feedback")).to_contain_text("不代表米醋已授权")
        assert model_authorizations[-2:] == [
            "Bearer replacement-image-secret",
            "Bearer replacement-analysis-secret",
        ], model_authorizations
        saved_keys = library.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])")
        custom_media = saved_keys["aiProviderRegistry"]["providers"]["custom-media"]
        assert custom_media["apiKey"] == "replacement-analysis-secret"
        assert custom_media["imageGeneration"]["apiKey"] == "replacement-image-secret"
        assert saved_keys["aiTaskAssignments"] == assignments_before_save

        library.locator('[data-provider-id="openai"]').get_by_role("button", name="编辑配置").click()
        openai_dialog = library.locator("#promptdirector-app-dialog")
        expect(openai_dialog).to_be_visible()
        expect(openai_dialog.locator("#promptdirector-app-dialog-providerEditor")).to_have_value("openai")
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
        assert openai_saved["aiTaskAssignments"] == openai_assignments_before_save

        library.locator('[data-ai-routing-tab="tasks"]').click()
        generation_task = library.locator("#ai-assignment-list .ai-assignment-row", has_text="图片生成")
        generation_task.get_by_role("button", name="更换").click()
        generation_dialog = library.locator("#promptdirector-app-dialog")
        generation_dialog.locator('[data-field-id="providerId"] select').select_option("openai")
        expect(generation_dialog.locator('[data-field-id="model"] select')).to_have_value("openai-account-image-model")
        expect(generation_dialog.locator('[data-field-id="model"]')).to_contain_text("手动声明，未验证")
        generation_dialog.locator(".app-dialog-close").click()
        expect(generation_dialog).to_be_visible()
        expect(generation_dialog.locator(".app-dialog-status")).to_contain_text("未保存的更改")
        generation_dialog.locator(".app-dialog-close").click()
        expect(generation_dialog).to_be_hidden()

        image_task = library.locator("#ai-assignment-list .ai-assignment-row", has_text="图片分析")
        expect(image_task).to_contain_text("自定义兼容服务（图片与生成） · gpt-5.6-terra")
        image_task.get_by_role("button", name="更换").click()
        task_dialog = library.locator("#promptdirector-app-dialog")
        expect(task_dialog.locator('[data-field-id="providerId"]')).to_be_visible()
        expect(task_dialog.locator('[data-field-id="model"]')).to_be_visible()
        expect(task_dialog.locator('[data-field-id]')).to_have_count(2)
        task_dialog.locator(".app-dialog-close").click()

        stored = library.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])")
        assert stored["aiProviderRegistry"]["providers"]["deepseek"]["apiKey"] == "deepseek-secret"
        assert set(stored["aiTaskAssignments"].keys()) == TASK_IDS
        assert stored["aiTaskAssignments"] == assignments_before_save

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
        nano_dialog.get_by_role("button", name="保存任务默认").click()
        expect(nano_dialog).to_be_hidden()

        nano_saved = library.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments'])")
        assert nano_saved["aiTaskAssignments"]["imageGeneration"] == {
            "providerId": "gemini", "model": "gemini-3.1-flash-image"
        }
        assert {
            task: value for task, value in nano_saved["aiTaskAssignments"].items() if task != "imageGeneration"
        } == {
            task: value for task, value in assignments_before_nano.items() if task != "imageGeneration"
        }
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
        print({"providersShown": 10, "connectedProviders": 5, "taskAssignments": 7, "newInstallUnassigned": True, "nanoBananaCatalogAssigned": True, "nanoBananaComposerParameters": True, "paidCalls": 0, "unifiedPreferencesSaved": True, "credentialsExposed": False})


if __name__ == "__main__":
    main()
