from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def current_session(page) -> dict:
    return page.evaluate(
        """async () => {
          const sessionId = new URL(location.href).searchParams.get('session');
          return (await chrome.runtime.sendMessage({type: 'GET_COMPOSER_SESSION', sessionId})).session;
        }"""
    )


def case_option(page):
    return page.locator(".composer-case-option", has_text="十图角色案例")


def asset_checkbox(page, number: int):
    return case_option(page).get_by_label(f"选择第 {number} 张图片")


def main() -> None:
    entry = base_entry("ten-image-case", "十图角色案例", "每张图都有自己的构图和角色状态。", "content:prompt:image")
    entry["mediaAssets"] = [
        {
            "id": f"ten-image-{index}",
            "kind": "image",
            "usage": "content",
            "storageMode": "managed",
            "mimeType": "image/png",
            "width": 1,
            "height": 1,
            "byteSize": 68,
            "contentHash": f"fingerprint-{index}",
        }
        for index in range(1, 11)
    ]
    entry["primaryMediaId"] = "ten-image-1"
    entry["mediaPrompts"] = [
        {"assetId": f"ten-image-{index}", "text": f"第 {index} 张图片的独立提示词"}
        for index in range(1, 11)
    ]

    with extension_session("prompt-director-reference-picker-", viewport={"width": 1280, "height": 900}) as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [entry],
            "aiProviderRegistry": {
                "version": 3,
                "providers": {
                    "deepseek": {
                        "endpoint": "https://api.deepseek.com/chat/completions",
                        "protocol": "chat_completions",
                        "apiKey": "deepseek-test-key",
                        "consent": True,
                        "models": {"creativePlanning": "deepseek-test"},
                    },
                    "openai": {
                        "endpoint": "https://api.openai.com/v1/responses",
                        "protocol": "responses",
                        "apiKey": "openai-test-key",
                        "consent": True,
                        "models": {"imageAnalysis": "gpt-image-test", "imageGeneration": "gpt-image-test"},
                        "discoveredModels": [{
                            "id": "gpt-image-test",
                            "name": "gpt-image-test",
                            "status": "available",
                            "confidence": "declared",
                            "source": "test-catalog",
                            "tasks": ["imageGeneration"],
                            "inputModalities": ["text", "image"],
                            "outputModalities": ["image"],
                            "referenceImages": {
                                "supported": True,
                                "maxItems": 6,
                                "source": "observed_error",
                                "observedAt": "2026-08-09T00:00:00.000Z",
                            },
                        }],
                    },
                },
            },
            "aiTaskAssignments": {
                "creativePlanning": {"providerId": "deepseek", "model": "deepseek-test"},
                "imageAnalysis": {"providerId": "openai", "model": "gpt-image-test"},
                "imageGeneration": {"providerId": "openai", "model": "gpt-image-test"},
            },
        })
        setup.evaluate(
            f"""async () => {{
              const {{saveMediaBlob}} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob('{PNG}'), character => character.charCodeAt(0));
              for (let index = 1; index <= 10; index += 1) {{
                await saveMediaBlob(`ten-image-${{index}}`, new Blob([bytes], {{type: 'image/png'}}), {{checkCapacity: false}});
              }}
            }}"""
        )

        composer = run.open_page("composer.html")
        console_messages: list[str] = []
        composer.on("console", lambda message: console_messages.append(message.text))
        composer.locator("#composer-reference-open").click()
        expect(case_option(composer).locator(".composer-case-asset")).to_have_count(10)
        case_option(composer).locator(":scope > input[type=checkbox]").check()
        expect(composer.locator("#composer-case-selection-count")).to_contain_text("已选择 1 张/项参考")
        composer.locator("#composer-reference-apply").click()
        composer.wait_for_timeout(50)
        assert not any("Blocked aria-hidden" in message for message in console_messages), console_messages
        expect(composer.locator("#composer-reference-open")).to_be_focused()

        session = current_session(composer)
        assert len(session["referenceSnapshots"]) == 1, session["referenceSnapshots"]
        assert session["referenceSnapshots"][0]["assetId"] == "ten-image-1"
        assert session["referenceSnapshots"][0]["imageRefs"] == [{"visualId": "ten-image-1", "mimeType": "image/png"}]

        composer.locator("#composer-reference-open").click()
        anchor_before = case_option(composer).evaluate(
            """option => {
              option.dataset.stabilityProbe = 'same-option';
              const picker = document.querySelector('#composer-case-picker');
              picker.scrollTop = Math.min(80, picker.scrollHeight - picker.clientHeight);
              const rect = option.getBoundingClientRect();
              return {top: rect.top, scrollTop: picker.scrollTop};
            }"""
        )
        case_option(composer).locator(".composer-case-select-preview").click()
        expect(asset_checkbox(composer, 1)).not_to_be_checked()
        case_option(composer).locator(".composer-case-asset").nth(2).click()
        expect(asset_checkbox(composer, 3)).to_be_checked()
        asset_checkbox(composer, 8).check()
        anchor_after = composer.evaluate(
            """() => {
              const option = document.querySelector('.composer-case-option[data-stability-probe="same-option"]');
              const picker = document.querySelector('#composer-case-picker');
              return {sameNode: Boolean(option), top: option?.getBoundingClientRect().top, scrollTop: picker.scrollTop};
            }"""
        )
        assert anchor_after["sameNode"], anchor_after
        assert abs(anchor_after["top"] - anchor_before["top"]) <= 1, (anchor_before, anchor_after)
        assert abs(anchor_after["scrollTop"] - anchor_before["scrollTop"]) <= 1, (anchor_before, anchor_after)
        expect(composer.locator("#composer-case-selection-count")).to_contain_text("已选择 2 张/项参考")
        composer.locator("#composer-reference-apply").click()

        session = current_session(composer)
        snapshots = session["referenceSnapshots"]
        assert [item["assetId"] for item in snapshots] == ["ten-image-3", "ten-image-8"], snapshots
        assert [item["referenceId"] for item in snapshots] == ["ten-image-case:ten-image-3", "ten-image-case:ten-image-8"]
        assert [item["alias"] for item in snapshots] == ["@参考1", "@参考2"]
        assert [item["originalText"] for item in snapshots] == ["第 3 张图片的独立提示词", "第 8 张图片的独立提示词"]
        assert composer.locator("#composer-aliases img").evaluate_all("nodes => nodes.map(node => node.dataset.visualId)") == ["ten-image-3", "ten-image-8"]

        composer.locator("#composer-options summary").click()
        composer.locator("#composer-create-image").check()
        composer.locator("#composer-options summary").click()
        composer.locator("#composer-reference-open").click()
        for number in [1, 2, 4, 5, 6]:
            asset_checkbox(composer, number).check()
        expect(composer.locator("#composer-case-selection-count")).to_contain_text("当前生图模型 7/6")
        expect(composer.locator("#composer-reference-feedback")).to_contain_text("最多接收 6 张参考图；当前 7 张")
        expect(composer.locator("#composer-reference-apply")).to_be_disabled()
        assert len(case_option(composer).locator(".composer-case-asset input:checked").all()) == 7
        asset_checkbox(composer, 6).uncheck()
        expect(composer.locator("#composer-reference-apply")).to_be_enabled()
        composer.locator("#composer-reference-cancel").click()

        detail = run.open_page("composer.html?references=ten-image-case&asset=ten-image-8")
        detail.wait_for_function("() => new URL(location.href).searchParams.has('session')")
        detail_session = current_session(detail)
        assert len(detail_session["referenceSnapshots"]) == 1
        assert detail_session["referenceSnapshots"][0]["assetId"] == "ten-image-8"
        expect(detail.locator('#composer-aliases img[data-visual-id="ten-image-8"]')).to_have_count(1)

        print({
            "multiImageCaseDefault": "primary-only",
            "independentReferences": ["ten-image-3", "ten-image-8"],
            "secondaryDetailReference": "ten-image-8",
            "knownLimitPreservedSelection": "7/6",
            "largePreviewClickSelects": True,
            "selectionAnchorShiftPx": 1,
        })


if __name__ == "__main__":
    main()
