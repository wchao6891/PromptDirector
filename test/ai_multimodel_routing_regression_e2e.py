from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, extension_session


TEXT_TASKS = ["textTags", "skillExtraction", "creativePlanning"]
ANALYSIS_TASKS = [*TEXT_TASKS, "imageAnalysis", "videoAnalysis"]


def account_model(model_id: str, *, tasks: list[str] | None = None) -> dict:
    declared_tasks = tasks or []
    input_modalities = ["text"]
    if "imageAnalysis" in declared_tasks:
        input_modalities.append("image")
    if "videoAnalysis" in declared_tasks:
        input_modalities.append("video")
    return {
        "id": model_id,
        "name": model_id,
        "status": "available",
        "confidence": "declared" if declared_tasks else "manual_unverified",
        "source": "provider_models",
        "tasks": declared_tasks,
        "inputModalities": input_modalities if declared_tasks else [],
        "outputModalities": ["text"] if declared_tasks else [],
    }


def main() -> None:
    with extension_session("prompt-director-multimodel-routing-") as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [],
            **ai_configuration_fixture(
                providers={
                    "deepseek": {
                        "apiKey": "deepseek-e2e-key",
                        "consent": True,
                        "discoveredModels": [
                            account_model("deepseek-v4-flash", tasks=TEXT_TASKS),
                            account_model("deepseek-v4-pro", tasks=TEXT_TASKS),
                            account_model("deepseek-v4-flash-vision-exp", tasks=[*TEXT_TASKS, "imageAnalysis"]),
                        ],
                        "discovery": {
                            "discoveredAt": "2026-08-30T10:00:00.000Z",
                            "source": "provider_models",
                        },
                    },
                    "zhipu": {
                        "apiKey": "zhipu-e2e-key",
                        "consent": True,
                        "discoveredModels": [
                            account_model("glm-5.3-flash", tasks=ANALYSIS_TASKS),
                            *[account_model(f"glm-account-{index}", tasks=TEXT_TASKS) for index in range(12)],
                        ],
                        "discovery": {
                            "discoveredAt": "2026-08-30T10:00:00.000Z",
                            "source": "provider_models",
                        },
                    },
                    "custom-media": {
                        "protocol": "responses",
                        "endpoint": "http://127.0.0.1:49191/v1/responses",
                        "apiKey": "analysis-e2e-key",
                        "consent": True,
                        "imageGeneration": {
                            "protocol": "images_generations",
                            "endpoint": "http://127.0.0.1:49191/v1/images/generations",
                            "editsEndpoint": "http://127.0.0.1:49191/v1/images/edits",
                            "apiKey": "generation-e2e-key",
                            "model": "account-image-model",
                            "sizes": ["1024x1024"],
                            "qualities": ["high"],
                        },
                    },
                },
                assignments={
                    "textTags": {"providerId": "zhipu", "model": "glm-5.3-flash"},
                    "skillExtraction": {"providerId": "zhipu", "model": "glm-5.3-flash"},
                    "creativePlanning": {"providerId": "zhipu", "model": "glm-5.3-flash"},
                    "imageAnalysis": {"providerId": "zhipu", "model": "glm-5.3-flash"},
                    "videoAnalysis": {"providerId": "zhipu", "model": "glm-5.3-flash"},
                    "imageGeneration": {"providerId": "custom-media", "model": "account-image-model"},
                },
            ),
        })

        library = run.open_page("library.html", wait_until="networkidle")
        if not library.locator("#settings-dialog").is_visible():
            library.locator("#open-settings").click()
        library.locator('[data-settings-tab="ai"]').click()
        library.locator('[data-ai-routing-tab="providers"]').click()
        library.locator('[data-provider-id="deepseek"]').get_by_role("button", name="编辑配置").click()
        dialog = library.locator("#promptdirector-app-dialog")
        text_model = dialog.locator('[data-field-id="provider_deepseek_model_textAnalysis"] select')
        image_model = dialog.locator('[data-field-id="provider_deepseek_model_imageAnalysis"] select')
        expect(text_model).to_be_visible()
        expect(image_model).to_be_visible()
        expect(text_model).to_contain_text("deepseek-v4-flash")
        expect(image_model).to_contain_text("deepseek-v4-flash-vision-exp")
        expect(image_model.locator('option[value="deepseek-v4-flash"]')).to_have_count(0)
        text_model.select_option("deepseek-v4-flash")
        image_model.select_option("deepseek-v4-flash-vision-exp")
        library.evaluate("() => { chrome.permissions.request = async () => true; }")
        dialog.get_by_role("button", name="保存配置").click()
        expect(dialog).to_be_hidden()

        library.locator('[data-ai-routing-tab="tasks"]').click()
        for task_label in ["文字标签", "Skill 提炼", "创作规划"]:
            expect(library.locator("#ai-assignment-list .ai-assignment-row", has_text=task_label)).to_contain_text(
                "DeepSeek · deepseek-v4-flash"
            )
        expect(library.locator("#ai-assignment-list .ai-assignment-row", has_text="图片分析")).to_contain_text(
            "DeepSeek · deepseek-v4-flash-vision-exp"
        )
        expect(library.locator("#ai-assignment-list .ai-assignment-row", has_text="视频分析")).to_contain_text(
            "智谱 GLM · glm-5.3-flash"
        )

        composer = run.open_page("composer.html", wait_until="networkidle")
        composer.set_viewport_size({"width": 360, "height": 800})
        expect(composer.locator("#composer-create-image")).to_be_enabled()
        composer.locator("#composer-model-trigger").click()
        choices = composer.locator("#composer-model-dynamic button")
        expect(choices).to_have_count(16)
        selected_choice = composer.locator('#composer-model-dynamic button[aria-checked="true"]')
        unselected_choice = composer.locator('#composer-model-dynamic button[aria-checked="false"]').first
        expect(selected_choice).to_have_count(1)
        menu = composer.locator("#composer-model-menu")
        menu_box = menu.bounding_box()
        assert menu_box and menu_box["x"] >= 0 and menu_box["y"] >= 0, menu_box
        assert menu_box["x"] + menu_box["width"] <= 360, menu_box
        assert menu_box["y"] + menu_box["height"] <= 800, menu_box
        menu_metrics = menu.evaluate("node => ({overflowY: getComputedStyle(node).overflowY, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight})")
        assert menu_metrics["overflowY"] == "auto", menu_metrics
        assert menu_metrics["scrollHeight"] > menu_metrics["clientHeight"], menu_metrics
        selected_background = selected_choice.evaluate("node => getComputedStyle(node).backgroundColor")
        unselected_background = unselected_choice.evaluate("node => getComputedStyle(node).backgroundColor")
        assert selected_background != unselected_background, (selected_background, unselected_background)
        composer.keyboard.press("Escape")

        composer.locator("#composer-options summary").click()
        composer.locator("#composer-create-image").click()
        expect(composer.locator("#composer-create-image")).to_be_checked()
        expect(composer.locator("#composer-model-label")).to_contain_text("生图")
        composer.locator("#composer-model-trigger").click()
        expect(composer.locator("#composer-model-dynamic button")).to_have_count(1)
        expect(composer.locator("#composer-model-dynamic")).to_contain_text("account-image-model")

        print({
            "connectionTextAndVisionModels": True,
            "connectionRoutesUpdated": True,
            "composerPlanningChoices": 16,
            "composerMenuScrollable": True,
            "independentImageGenerationSelectable": True,
            "realPaidRequests": 0,
        })


if __name__ == "__main__":
    main()
