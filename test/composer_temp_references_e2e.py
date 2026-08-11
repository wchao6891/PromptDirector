from __future__ import annotations

import base64
import json

from playwright.sync_api import expect

from e2e_support import extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def dispatch_file(page, event_type: str, name: str) -> bool:
    return page.evaluate(
        """async ({eventType, name, payload}) => {
          const bytes = Uint8Array.from(atob(payload), value => value.charCodeAt(0));
          const file = new File([bytes], name, {type: 'image/png'});
          const transfer = new DataTransfer();
          transfer.items.add(file);
          const target = document.querySelector(eventType === 'paste' ? '#composer-instruction' : '.composer-input-box');
          const event = eventType === 'paste'
            ? new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true})
            : new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true});
          return target.dispatchEvent(event);
        }""",
        {"eventType": event_type, "name": name, "payload": PNG_BASE64},
    )


def main() -> None:
    with extension_session("prompt-director-temp-references-", viewport={"width": 1280, "height": 900}) as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "composerSessions": [],
            "aiSettings": {
                "activeProvider": "deepseek",
                "apiKey": "deepseek-e2e-key",
                "consent": True,
                "analysisModel": "deepseek-v4-flash",
            },
            "visionSettings": {
                "activeProvider": "openai",
                "consent": True,
                "openai": {"apiKey": "openai-e2e-key", "model": "gpt-5-mini"},
            },
        })
        vision_requests: list[dict] = []
        composer_requests: list[dict] = []
        fail_vision = {"value": False}

        def mock_openai(route) -> None:
            payload = route.request.post_data_json
            if payload is None:
                route.continue_()
                return
            vision_requests.append(payload)
            if fail_vision["value"]:
                route.fulfill(status=500, content_type="application/json", body=json.dumps({"error": {"message": "vision unavailable"}}))
                return
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "model": "gpt-5-mini",
                    "output_text": json.dumps({
                        "description": "Centered subject with a clear silhouette and controlled contrast.",
                        "canvas": {"width": 1, "height": 1, "aspectRatio": "1:1", "orientation": "square", "dominantColors": []},
                        "elements": [{
                            "id": "subject-1", "label": "subject", "category": "subject",
                            "box_2d": [0, 0, 1000, 1000],
                            "coveragePercent": 100, "depthLayer": "midground", "occludes": [], "occludedBy": [],
                            "relationships": [], "visualAttributes": ["clear silhouette", "controlled contrast"]
                        }],
                        "dimensions": [
                            {"id": dimension, "applicable": dimension in ["subject", "camera", "light"],
                             "facts": ["visible"] if dimension in ["subject", "camera", "light"] else [], "measurements": []}
                            for dimension in ["subject", "scene", "action", "style", "camera", "light", "mood", "sound", "output", "workflow"]
                        ],
                        "ocr": [],
                        "reconstructionPrompt": "Centered subject with a clear silhouette and controlled contrast.",
                        "limitations": [],
                        "completeness": {"checkedRegions": ["full frame"], "omittedVisibleElements": []},
                        "tags": [],
                    }),
                    "usage": {"input_tokens": 12, "output_tokens": 8, "total_tokens": 20},
                }),
            )

        def mock_deepseek(route) -> None:
            payload = route.request.post_data_json
            composer_requests.append(payload)
            if payload.get("stream"):
                route.fulfill(
                    status=200,
                    content_type="text/event-stream",
                    body=(
                        f'data: {json.dumps({"model": "deepseek-v4-flash", "choices": [{"delta": {"content": "Use the analyzed composition."}, "finish_reason": "stop"}]})}\n\n'
                        "data: [DONE]\n\n"
                    ),
                )
                return
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "model": "deepseek-v4-flash",
                    "choices": [{"finish_reason": "stop", "message": {"content": json.dumps({
                        "route": "compose",
                        "status": "ready",
                        "suggestedTitle": "Analyzed composition",
                        "instruction": "Use the analyzed temporary references.",
                        "question": None,
                        "librarySearch": None,
                    })}}],
                }),
            )

        run.context.route("https://api.openai.com/**", mock_openai)
        run.context.route("https://api.deepseek.com/**", mock_deepseek)
        composer = run.open_page("composer.html", wait_until="networkidle")

        expect(composer.locator("#composer-attachment-local")).to_be_visible()
        expect(composer.locator("#composer-reference-open")).to_be_visible()

        composer.locator("#composer-attachment-files").set_input_files({
            "name": "director-notes.txt",
            "mimeType": "text/plain",
            "buffer": b"Keep the subject silhouette clear.",
        })
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(1)
        expect(composer.locator(".composer-temp-reference-card").first).to_contain_text("director-notes.txt")

        dispatch_file(composer, "paste", "clipboard-frame.png")
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(2)
        dispatch_file(composer, "drop", "dropped-frame.png")
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(3)

        session_id = composer.evaluate("() => new URL(location.href).searchParams.get('session')")
        assert session_id
        persisted = composer.evaluate(
            """async (sessionId) => {
              const stored = await chrome.storage.local.get('composerSessions');
              const session = stored.composerSessions.find(item => item.id === sessionId);
              const media = await import(chrome.runtime.getURL('media-store.js'));
              const assetIds = session.referenceSnapshots.flatMap(item => item.assetRefs || []).map(item => item.assetId);
              const blobs = await Promise.all(assetIds.map(assetId => media.getMediaBlob(assetId)));
              return {
                sourceTypes: session.referenceSnapshots.map(item => item.sourceType),
                names: session.referenceSnapshots.flatMap(item => item.assetRefs || []).map(item => item.name),
                blobSizes: blobs.map(blob => blob?.size || 0),
              };
            }""",
            session_id,
        )
        assert persisted["sourceTypes"] == ["temporary", "temporary", "temporary"], persisted
        assert persisted["names"] == ["director-notes.txt", "clipboard-frame.png", "dropped-frame.png"], persisted
        assert all(size > 0 for size in persisted["blobSizes"]), persisted

        composer.reload(wait_until="networkidle")
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(3)
        composer.set_viewport_size({"width": 390, "height": 844})
        mobile_geometry = composer.evaluate(
            """() => {
              const input = document.querySelector('.composer-input-area').getBoundingClientRect();
              const cards = document.querySelector('.composer-temp-references');
              return {
                pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
                inputBottom: input.bottom,
                viewportHeight: window.innerHeight,
                cardStripOverflow: cards.scrollWidth > cards.clientWidth,
              };
            }"""
        )
        assert mobile_geometry["pageOverflow"] <= 1, mobile_geometry
        assert mobile_geometry["inputBottom"] <= mobile_geometry["viewportHeight"] + 1, mobile_geometry
        assert mobile_geometry["cardStripOverflow"], mobile_geometry
        composer.locator("#composer-instruction").fill("Use the attached composition")
        composer.locator("#composer-action").click()
        expect(composer.locator("#composer-image-blocker")).to_be_visible()
        expect(composer.locator("#composer-image-blocker-description")).to_contain_text("2 次额外请求")
        expect(composer.locator("#composer-image-blocker-description")).to_contain_text("gpt-5-mini")
        expect(composer.locator("#composer-instruction")).to_have_value("Use the attached composition")
        message_count = composer.evaluate(
            """async (sessionId) => {
              const stored = await chrome.storage.local.get('composerSessions');
              return stored.composerSessions.find(item => item.id === sessionId).messages.length;
            }""",
            session_id,
        )
        assert message_count == 0
        expect(composer.locator("#composer-model-label")).to_have_text("Flash")
        expect(composer.locator("#composer-model-label")).to_have_attribute("title", "DeepSeek Flash")
        composer.locator("#composer-image-blocker-analyze").click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_have_text("Use the analyzed composition.")
        expect(composer.locator("#composer-model-label")).to_have_text("Flash")
        expect(composer.locator("#composer-model-label")).to_have_attribute("title", "DeepSeek Flash")
        analyzed = composer.evaluate(
            """async (sessionId) => {
              const stored = await chrome.storage.local.get('composerSessions');
              const session = stored.composerSessions.find(item => item.id === sessionId);
              return session.referenceSnapshots
                .filter(item => item.sourceType === 'temporary' && item.assetRefs.some(asset => asset.kind === 'image'))
                .map(item => ({kind: item.referenceKind, text: item.referenceText}));
            }""",
            session_id,
        )
        assert len(vision_requests) == 2, vision_requests
        assert len(composer_requests) == 2, composer_requests
        assert analyzed == [
            {"kind": "vision", "text": "Centered subject with a clear silhouette and controlled contrast."},
            {"kind": "vision", "text": "Centered subject with a clear silhouette and controlled contrast."},
        ], analyzed

        composer.locator("#composer-attachment-files").set_input_files({
            "name": "clip.mp4",
            "mimeType": "video/mp4",
            "buffer": b"not-a-video",
        })
        expect(composer.locator("#composer-feedback")).to_contain_text("暂不支持视频")
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(3)

        composer.locator(".composer-temp-reference-card").first.get_by_role("button", name="移除临时附件").click()
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(2)
        composer.locator("#composer-temp-reference-save-all").click()
        expect(composer.locator("#composer-feedback")).to_contain_text("已保存")
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(0)
        entries = composer.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries || [])")
        assert len(entries) == 2, entries

        dispatch_file(composer, "paste", "failed-analysis.png")
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(1)
        composer.locator("#composer-instruction").fill("Keep this request and attachment after an analysis failure")
        composer.locator("#composer-action").click()
        expect(composer.locator("#composer-image-blocker")).to_be_visible()
        fail_vision["value"] = True
        composer.locator("#composer-image-blocker-analyze").click()
        expect(composer.locator("#composer-image-blocker-description")).to_contain_text("本轮输入和附件均已保留")
        expect(composer.locator("#composer-instruction")).to_have_value("Keep this request and attachment after an analysis failure")
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(1)
        assert len(composer_requests) == 2, composer_requests
        failed_reference = composer.evaluate(
            """async (sessionId) => {
              const stored = await chrome.storage.local.get('composerSessions');
              const session = stored.composerSessions.find(item => item.id === sessionId);
              return session.referenceSnapshots.find(item => item.title === 'failed-analysis.png');
            }""",
            session_id,
        )
        assert failed_reference["referenceText"] == "", failed_reference
        composer.locator("#composer-image-blocker-cancel").click()

        composer.locator(".composer-temp-reference-card").get_by_role("button", name="保存到案例库：failed-analysis.png").click()
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(0)
        composer.locator("#composer-action").click()
        expect(composer.locator("#composer-image-blocker")).to_be_visible()
        expect(composer.locator("#composer-image-blocker-description")).to_contain_text("尚未分析的参考图片")
        assert len(composer_requests) == 2, composer_requests
        composer.locator("#composer-image-blocker-cancel").click()

        print({
            "inputPaths": ["file", "paste", "drop"],
            "persisted": persisted,
            "mobile": mobile_geometry,
            "textOnlyBlockedBeforeSend": True,
            "explicitVisionAnalysisRequests": len(vision_requests),
            "failurePreservedInputAndAttachment": True,
            "savedImageCaseBlockedBeforeTextOnlySend": True,
            "savedCases": len(entries),
        })


if __name__ == "__main__":
    main()
