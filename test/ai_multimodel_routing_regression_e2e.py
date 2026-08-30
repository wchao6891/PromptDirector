from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, extension_session


def account_model(model_id: str, *, declared: bool = False) -> dict:
    return {
        "id": model_id,
        "name": model_id,
        "status": "available",
        "confidence": "declared" if declared else "manual_unverified",
        "source": "provider_models",
        "tasks": ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"] if declared else [],
        "inputModalities": ["text", "image", "video"] if declared else [],
        "outputModalities": ["text"] if declared else [],
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
                            account_model("deepseek-account-alpha"),
                            account_model("deepseek-account-beta"),
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
                            account_model("glm-5.3-flash", declared=True),
                            account_model("glm-account-air"),
                            account_model("glm-account-plus"),
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
                    "creativePlanning": {"providerId": "zhipu", "model": "glm-5.3-flash"},
                    "imageGeneration": {"providerId": "custom-media", "model": "account-image-model"},
                },
            ),
        })

        library = run.open_page("library.html", wait_until="networkidle")
        if not library.locator("#settings-dialog").is_visible():
            library.locator("#open-settings").click()
        library.locator('[data-settings-tab="ai"]').click()
        library.locator('[data-ai-routing-tab="providers"]').click()
        library.locator('[data-provider-id="zhipu"]').get_by_role("button", name="编辑配置").click()
        dialog = library.locator("#promptdirector-app-dialog")
        model_select = dialog.locator('[data-field-id="provider_zhipu_analysisModel"] select')
        expect(model_select.locator("option")).to_have_count(4)
        expect(model_select).to_contain_text("glm-5.3-flash")
        expect(model_select).to_contain_text("glm-account-air")
        expect(model_select).to_contain_text("glm-account-plus")
        dialog.get_by_role("button", name="取消").click()

        composer = run.open_page("composer.html", wait_until="networkidle")
        expect(composer.locator("#composer-create-image")).to_be_enabled()
        composer.locator("#composer-model-trigger").click()
        choices = composer.locator("#composer-model-dynamic button")
        expect(choices).to_have_count(5)
        for model_id in [
            "glm-5.3-flash",
            "glm-account-air",
            "glm-account-plus",
            "deepseek-account-alpha",
            "deepseek-account-beta",
        ]:
            expect(composer.locator("#composer-model-dynamic")).to_contain_text(model_id)

        print({
            "connectionCatalogChoices": 3,
            "composerPlanningChoices": 5,
            "independentImageGenerationEnabled": True,
            "realPaidRequests": 0,
        })


if __name__ == "__main__":
    main()
