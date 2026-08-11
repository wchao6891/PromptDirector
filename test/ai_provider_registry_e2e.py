from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import extension_session


def main() -> None:
    with extension_session("prompt-director-ai-registry-", viewport={"width": 1280, "height": 900}) as run:
        model_authorizations: list[str] = []

        def mock_models(route) -> None:
            model_authorizations.append(route.request.headers.get("authorization", ""))
            route.fulfill(
                status=200,
                content_type="application/json",
                body='{"data":[{"id":"gpt-5.6-terra"},{"id":"gpt-image-2"}]}',
            )

        run.context.route("https://www.micuapi.ai/v1/models", mock_models)
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [],
            "aiSettings": {
                "activeProvider": "deepseek",
                "apiKey": "deepseek-secret",
                "analysisModel": "deepseek-text",
                "consent": True,
            },
            "visionSettings": {
                "activeProvider": "compatible",
                "consent": True,
                "openai": {"apiKey": "openai-secret", "model": "openai-vision"},
                "compatible": {
                    "protocol": "responses",
                    "endpoint": "https://www.micuapi.ai/v1/responses",
                    "apiKey": "micu-vision-secret",
                    "model": "gpt-5.6-terra",
                    "imageGeneration": {
                        "protocol": "images_generations",
                        "endpoint": "https://www.micuapi.ai/v1/images/generations",
                        "editsEndpoint": "https://www.micuapi.ai/v1/images/edits",
                        "apiKey": "micu-image-secret",
                        "model": "gpt-image-2",
                    },
                },
            },
            "aiServiceProfiles": {
                "gemini": {"apiKey": "gemini-secret", "model": "gemini-video"},
                "xai": {"apiKey": "xai-secret", "textModel": "grok-text", "imageModel": "grok-image"},
            },
        })
        library = run.open_page("library.html", wait_until="networkidle")
        if not library.locator("#settings-dialog").is_visible():
            library.locator("#open-settings").click()
        library.locator('[data-settings-tab="ai"]').click()

        expect(library.locator("#ai-provider-list .ai-provider-row")).to_have_count(5)
        expect(library.locator("#ai-assignment-list .ai-assignment-row")).to_have_count(7)
        expect(library.locator("#ai-provider-list")).to_contain_text("DeepSeek")
        expect(library.locator("#ai-provider-list")).to_contain_text("OpenAI")
        expect(library.locator("#ai-provider-list")).to_contain_text("Google Gemini")
        expect(library.locator("#ai-provider-list")).to_contain_text("xAI")
        expect(library.locator("#ai-provider-list")).to_contain_text("自定义兼容服务（图片与生成）")
        expect(library.locator("#open-ai-routing")).to_have_text("添加 AI 服务")
        expect(library.locator("#ai-provider-list").get_by_role("button", name="编辑配置")).to_have_count(5)
        expect(library.locator(".ai-advanced-settings")).not_to_have_attribute("open", "")
        expect(library.locator("#deepseek-api-key")).to_be_hidden()
        library.locator(".ai-advanced-settings > summary").click()
        expect(library.locator("#deepseek-api-key")).to_be_visible()
        expect(library.locator("#ai-settings-status")).to_contain_text("API Key 已配置")
        library.locator('[data-analysis-kind="vision"]').click()
        expect(library.locator("#vision-compatible-api-key")).to_be_visible()
        expect(library.locator("#vision-settings-status")).to_contain_text("服务已配置")
        library.locator("#vision-provider").select_option("openai")
        expect(library.locator("#vision-openai-api-key")).to_be_visible()
        library.locator("#vision-provider").select_option("compatible")
        expect(library.locator("#vision-compatible-api-key")).to_be_visible()
        expect(library.locator("#vision-settings-form")).not_to_contain_text("图片生成协议")
        expect(library.locator("#vision-settings-form")).not_to_contain_text("图片尺寸")

        image_runtime = library.evaluate("() => chrome.runtime.sendMessage({type: 'GET_AI_TASK_RUNTIME', taskId: 'imageAnalysis'})")
        assert image_runtime["ok"] is True, image_runtime
        assert image_runtime["assignment"] == {"providerId": "custom-media", "model": "gpt-5.6-terra"}, image_runtime

        library.locator("#open-ai-routing").click()
        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog).to_be_visible()
        dialog.locator("#promptdirector-app-dialog-providerEditor").select_option("openrouter")
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor")).to_have_value("openrouter")
        expect(dialog.locator("#promptdirector-app-dialog-provider_openrouter_apiKey")).to_be_visible()
        expect(dialog.locator("#promptdirector-app-dialog-providerEditor option")).to_have_count(9)
        expect(dialog.locator('[data-field-id^="provider_"]:visible')).to_have_count(2)
        expect(dialog.locator('[data-field-id^="assignment_"]')).to_have_count(0)
        password_values = dialog.locator('input[type="password"]').evaluate_all("nodes => nodes.map(node => node.value)")
        assert all(value == "" for value in password_values), password_values
        expect(dialog.locator('input[type="password"]:visible')).to_have_count(0)
        assert "secret" not in dialog.text_content()
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
        expect(image_endpoint).to_be_visible()
        expect(image_endpoint).to_have_value("https://www.micuapi.ai/v1/images/generations")
        expect(dialog.locator("#promptdirector-app-dialog-provider_custom_media_imageEditsEndpoint")).to_have_value("https://www.micuapi.ai/v1/images/edits")
        assert image_key.bounding_box()["y"] < image_endpoint.bounding_box()["y"], "生图 Key 必须位于高级接口字段之前"
        expect(dialog).to_contain_text("能力声明，不是本轮输出值")
        library.evaluate("() => { chrome.permissions.request = async () => true; }")
        dialog.get_by_role("button", name="保存配置").click()
        expect(dialog).to_be_hidden()
        expect(library.locator("#feedback")).to_contain_text("模型目录中可见 gpt-image-2")
        expect(library.locator("#feedback")).to_contain_text("不代表米醋已授权")
        assert model_authorizations[-2:] == [
            "Bearer replacement-image-secret",
            "Bearer replacement-analysis-secret",
        ], model_authorizations
        saved_keys = library.evaluate("() => chrome.storage.local.get('aiProviderRegistry')")
        custom_media = saved_keys["aiProviderRegistry"]["providers"]["custom-media"]
        assert custom_media["apiKey"] == "replacement-analysis-secret"
        assert custom_media["imageGeneration"]["apiKey"] == "replacement-image-secret"

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
        assert set(stored["aiTaskAssignments"].keys()) == {"textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis", "imageGeneration", "videoGeneration"}
        print({"connectedProviders": 5, "taskAssignments": 7, "legacyCompatibleVisionRestored": True, "credentialsExposed": False})


if __name__ == "__main__":
    main()
