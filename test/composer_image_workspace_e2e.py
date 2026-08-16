from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def main() -> None:
    reference = base_entry("reference-entry", "原始构图参考", "三人构图，中间女性清晰聚焦。", "content:prompt:image")
    reference["mediaAssets"] = [{
        "id": "reference-visual", "kind": "image", "usage": "content", "storageMode": "managed",
        "mimeType": "image/png", "width": 320, "height": 200, "byteSize": 1000,
    }]
    reference["primaryMediaId"] = "reference-visual"
    prompt_version = {
        "id": "prompt-version-one",
        "text": "三人构图，中间女性清晰聚焦，前后景虚化。",
        "title": "三人焦点构图",
        "methodVersion": "3.1.0",
        "outputLanguage": "zh-CN",
        "instructionSnapshot": {"instruction": "保持三人关系和中间焦点"},
        "createdAt": "2026-08-07T00:00:00.000Z",
    }
    reference_snapshot = {
        "entryId": "reference-entry",
        "alias": "@参考1",
        "title": "原始构图参考",
        "referenceKind": "prompt",
        "referenceText": reference["text"],
        "originalText": reference["text"],
        "imageRefs": [{"visualId": "reference-visual", "mimeType": "image/png"}],
    }
    session_value = {
        "id": "image-workspace-session",
        "title": "三人焦点构图",
        "targetType": "image",
        "routeMode": "compose",
        "outputMode": "create_image",
        "aiProfile": {"serviceId": "openai", "model": "gpt-5-mini", "thinking": False},
        "generationAiProfile": {"serviceId": "openai", "model": "gpt-5-mini", "thinking": False},
        "referenceSnapshots": [reference_snapshot],
        "messages": [
            {"id": "user-one", "role": "user", "type": "request", "content": "生成三人焦点构图", "createdAt": "2026-08-07T00:00:00.000Z"},
            {"id": "assistant-one", "role": "assistant", "type": "prompt", "route": "compose", "content": prompt_version["text"], "createdAt": "2026-08-07T00:00:01.000Z"},
        ],
        "promptVersions": [prompt_version],
        "createdAt": "2026-08-07T00:00:00.000Z",
        "updatedAt": "2026-08-07T00:00:02.000Z",
    }
    output_visual = {
        "id": "generated-visual-one", "kind": "image", "usage": "content", "storageMode": "managed",
        "mimeType": "image/png", "width": 320, "height": 200, "byteSize": 1000,
        "capturedAt": "2026-08-07T00:00:02.000Z",
    }
    run_value = {
        "id": "creative-run-one",
        "version": 3,
        "sessionId": session_value["id"],
        "promptVersionId": prompt_version["id"],
        "title": prompt_version["title"],
        "targetType": "image",
        "outputLanguage": "zh-CN",
        "promptText": prompt_version["text"],
        "methodVersion": "3.1.0",
        "executionInstruction": "保持三人关系和中间焦点",
        "referenceSnapshots": [{key: value for key, value in reference_snapshot.items() if key != "entryId"}],
        "briefSnapshot": [{"role": "user", "type": "request", "content": "生成三人焦点构图"}],
        "createdAt": "2026-08-07T00:00:02.000Z",
        "updatedAt": "2026-08-07T00:00:02.000Z",
        "events": [],
        "outputs": [{
            "visual": output_visual,
            "capturedAt": output_visual["capturedAt"],
            "signals": [{"type": "captured", "at": output_visual["capturedAt"]}],
            "generation": {"serviceId": "openai", "requestModel": "gpt-5-mini"},
        }],
    }

    with extension_session("prompt-director-image-workspace-", viewport={"width": 1280, "height": 900}) as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [reference],
            "composerSessions": [session_value],
            "creativeRuns": [run_value],
            **ai_configuration_fixture(
                providers={
                    "openai": {
                        "apiKey": "openai-e2e-key",
                        "consent": True,
                        "models": {
                            "creativePlanning": "gpt-5-mini",
                            "imageAnalysis": "gpt-5-mini",
                            "imageGeneration": "gpt-5-mini",
                        },
                    },
                },
                assignments={
                    "creativePlanning": {"providerId": "openai", "model": "gpt-5-mini"},
                    "imageAnalysis": {"providerId": "openai", "model": "gpt-5-mini"},
                    "imageGeneration": {"providerId": "openai", "model": "gpt-5-mini"},
                },
            ),
        })
        setup.evaluate(
            f"""async () => {{
              const imageStore = await import(chrome.runtime.getURL('image-store.js'));
              const bytes = Uint8Array.from(atob('{PNG_BASE64}'), value => value.charCodeAt(0));
              const source = new Blob([bytes], {{type: 'image/png'}});
              const canvas = new OffscreenCanvas(320, 200);
              const context = canvas.getContext('2d');
              context.fillStyle = '#1d3446';
              context.fillRect(0, 0, 320, 200);
              context.fillStyle = '#e6d3bd';
              context.fillRect(130, 35, 60, 145);
              context.fillStyle = '#71808b';
              context.fillRect(18, 62, 74, 125);
              context.fillRect(228, 62, 74, 125);
              const result = await canvas.convertToBlob({{type: 'image/png'}});
              await imageStore.saveScreenshotBlob('reference-visual', source);
              await imageStore.saveScreenshotBlob('generated-visual-one', result);
            }}"""
        )

        composer = run.open_page("composer.html?session=image-workspace-session", wait_until="networkidle")

        result_image = composer.locator(".composer-result-image").first
        expect(result_image).to_be_visible()
        image_box = result_image.bounding_box()
        assert image_box and image_box["width"] > 600 and image_box["height"] >= 280, image_box
        expect(composer.get_by_role("button", name="更多", exact=True)).to_have_count(0)
        expect(composer.get_by_role("button", name="按当前来源重新生成", exact=True)).to_have_count(0)

        result_image.click()
        workspace = composer.locator(".composer-image-workspace")
        expect(workspace).to_be_visible()
        expect(workspace.get_by_role("button", name="下载原图", exact=True)).to_be_visible()
        composer.locator("[data-workspace-id='zoomIn']").click()
        expect(composer.locator("[data-workspace-id='zoomLabel']")).not_to_have_text("100%")
        composer.locator("[data-workspace-id='fit']").click()

        with composer.expect_download() as download_info:
            workspace.get_by_role("button", name="下载原图", exact=True).click()
        assert download_info.value.suggested_filename.endswith(".png")

        workspace.get_by_role("button", name="保存到灵感库", exact=True).click()
        expect(composer.locator("#composer-feedback")).to_contain_text("保存")
        stored_after_save = composer.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries)")
        assert any(item.get("creationMeta", {}).get("creativeRunId") == "creative-run-one" for item in stored_after_save)

        workspace.get_by_role("button", name="作为参考继续", exact=True).click()
        expect(workspace).not_to_be_visible()
        expect(composer.locator("#composer-reference-count")).to_have_text("2")

        result_image.click()
        workspace.get_by_role("button", name="编辑", exact=True).click()
        workspace.get_by_role("button", name="局部修改", exact=True).click()
        mask = composer.locator("[data-workspace-id='mask']")
        expect(mask).to_be_visible()
        mask_box = mask.bounding_box()
        assert mask_box
        composer.mouse.move(mask_box["x"] + mask_box["width"] * 0.45, mask_box["y"] + mask_box["height"] * 0.4)
        composer.mouse.down()
        composer.mouse.move(mask_box["x"] + mask_box["width"] * 0.55, mask_box["y"] + mask_box["height"] * 0.6, steps=5)
        composer.mouse.up()
        composer.locator("[data-workspace-id='instruction']").fill("只把中间女性的外套改成红色")
        expect(composer.locator("[data-workspace-id='instruction']")).to_have_value("只把中间女性的外套改成红色")
        expect(workspace.get_by_role("button", name="修改选区", exact=True)).to_be_enabled()
        composer.set_viewport_size({"width": 390, "height": 844})
        mobile_geometry = composer.evaluate(
            """() => {
              const workspace = document.querySelector('.composer-image-workspace');
              const panel = document.querySelector('.composer-image-workspace-panel');
              const viewport = document.querySelector('.composer-image-viewport');
              return {
                overflow: workspace.scrollWidth - workspace.clientWidth,
                panelBottom: panel.getBoundingClientRect().bottom,
                viewportHeight: viewport.getBoundingClientRect().height,
                windowHeight: window.innerHeight,
              };
            }"""
        )
        assert mobile_geometry["overflow"] <= 1, mobile_geometry
        assert mobile_geometry["panelBottom"] <= mobile_geometry["windowHeight"] + 1, mobile_geometry
        assert mobile_geometry["viewportHeight"] > 250, mobile_geometry
        composer.locator("[data-workspace-id='close']").click()

        composer.set_viewport_size({"width": 1280, "height": 900})
        composer.locator(".composer-result-card").first.locator(".composer-result-image").click()
        workspace.get_by_role("button", name="删除", exact=True).click()
        delete_dialog = composer.locator("#promptdirector-app-dialog")
        expect(delete_dialog).to_be_visible()
        delete_dialog.get_by_role("button", name="删除", exact=True).click()
        expect(composer.locator(".composer-result-card")).to_have_count(0)

        print({
            "maskEditing": True,
            "mobile": mobile_geometry,
            "localEditExecutionCoveredBy": ["composer-service.test.js", "creative-jobs.test.js"],
        })


if __name__ == "__main__":
    main()
