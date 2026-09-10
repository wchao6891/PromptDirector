from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, extension_session


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
            **ai_configuration_fixture(
                providers={
                    "deepseek": {
                        "apiKey": "deepseek-e2e-key",
                        "consent": True,
                        "models": {"creativePlanning": "deepseek-v4-flash"},
                    },
                    "openai": {
                        "apiKey": "openai-e2e-key",
                        "consent": True,
                        "models": {"imageAnalysis": "gpt-5-mini", "creativePlanning": "gpt-5-mini"},
                    },
                },
                assignments={
                    "creativePlanning": {"providerId": "deepseek", "model": "deepseek-v4-flash"},
                    "imageAnalysis": {"providerId": "openai", "model": "gpt-5-mini"},
                },
            ),
        })
        vision_requests: list[dict] = []
        composer_requests: list[dict] = []

        def mock_openai(route) -> None:
            payload = route.request.post_data_json
            if payload is None:
                route.continue_()
                return
            if payload.get("stream"):
                composer_requests.append(payload)
                visible = json.dumps({"route": "compose", "status": "ready"}) + "\nUse the original composition."
                events = [
                    {"type": "response.output_text.delta", "delta": visible},
                    {"type": "response.completed", "response": {"model": "gpt-5-mini", "status": "completed", "usage": {"input_tokens": 12, "output_tokens": 8}}},
                ]
                route.fulfill(status=200, content_type="text/event-stream", body="".join(f"data: {json.dumps(event)}\n\n" for event in events))
                return
            vision_requests.append(payload)
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
                        "tags": [{"g": "camera.composition", "t": "主体居中"}],
                    }),
                    "usage": {"input_tokens": 12, "output_tokens": 8, "total_tokens": 20},
                }),
            )

        def mock_deepseek(route) -> None:
            payload = route.request.post_data_json
            composer_requests.append(payload)
            if payload.get("stream"):
                visible_text = "Use the analyzed composition."
                route.fulfill(
                    status=200,
                    content_type="text/event-stream",
                    body=(
                        f'data: {json.dumps({"model": "deepseek-v4-flash", "choices": [{"delta": {"content": json.dumps({"route": "compose", "status": "ready"}) + chr(10) + visible_text}, "finish_reason": "stop"}]})}\n\n'
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
        composer.set_viewport_size({"width": 1280, "height": 900})
        composer.locator("#composer-instruction").fill("Use the attached composition")
        composer.locator("#composer-action").click()
        expect(composer.locator("#composer-image-input-status")).to_be_visible()
        expect(composer.locator("#composer-image-input-message")).to_contain_text("切换支持看图的模型")
        expect(composer.locator("#composer-image-blocker")).to_have_count(0)
        expect(composer.locator("#composer-instruction")).to_have_value("Use the attached composition")
        assert not vision_requests and not composer_requests
        artifact_dir = os.environ.get("PROMPTDIRECTOR_E2E_ARTIFACT_DIR")
        if artifact_dir:
            Path(artifact_dir).mkdir(parents=True, exist_ok=True)
            composer.screenshot(path=str(Path(artifact_dir) / "composer-switch-model.png"), full_page=True)
        composer.locator("#composer-image-input-model").click()
        expect(composer.locator("#composer-model-menu")).to_be_visible()
        composer.locator("#composer-model-dynamic button", has_text="OpenAI").click()
        expect(composer.locator("#composer-image-input-status")).to_be_hidden()
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_have_text("Use the original composition.")
        if artifact_dir:
            composer.screenshot(path=str(Path(artifact_dir) / "composer-original-image-response.png"), full_page=True)
        assert len(composer_requests) == 1, composer_requests
        assert len(vision_requests) == 0, vision_requests
        images = [part for row in composer_requests[0]["input"] for part in row.get("content", []) if part.get("type") == "input_image"]
        assert len(images) == 2, composer_requests[0]
        assert all(part["image_url"].startswith("data:image/png;base64,") for part in images)
        expect(composer.locator("#composer-library-search")).to_have_attribute("aria-pressed", "true")
        assembly_snapshot = composer.evaluate(
            """async (sessionId) => {
              const stored = await chrome.storage.local.get('composerSessions');
              return stored.composerSessions.find(item => item.id === sessionId)?.assemblySnapshot || null;
            }""", session_id,
        )
        assert assembly_snapshot["prerequisiteAnalysisRequests"] == 0, assembly_snapshot
        assert assembly_snapshot["media"]["expectedSentImageCount"] == 2, assembly_snapshot

        composer.locator("#composer-attachment-files").set_input_files({
            "name": "clip.mp4",
            "mimeType": "video/mp4",
            "buffer": b"not-a-video",
        })
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(4)
        expect(composer.locator(".composer-temp-reference-card").last).to_contain_text("clip.mp4")
        composer.locator("#composer-instruction").fill("Read the attached video")
        composer.locator("#composer-action").click()
        expect(composer.locator("#composer-feedback")).to_contain_text("请切换视频模型")
        assert len(composer_requests) == 1, composer_requests

        composer.locator(".composer-temp-reference-card").first.get_by_role("button", name="移除临时附件").click()
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(3)
        composer.locator("#composer-temp-reference-save-all").click()
        expect(composer.locator("#composer-feedback")).to_contain_text("已保存")
        expect(composer.locator(".composer-temp-reference-card")).to_have_count(0)
        entries = composer.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries || [])")
        assert len(entries) == 3, entries

        # An explicit analysis task for two pictures from one case writes both results back.
        task_ids = composer.evaluate(
            """async () => {
              const stored = await chrome.storage.local.get('entries');
              const imageEntries = stored.entries.filter(entry => entry.mediaAssets.some(asset => asset.kind === 'image'));
              const combined = {...imageEntries[0], mediaAssets: imageEntries.flatMap(entry => entry.mediaAssets)};
              await chrome.storage.local.set({entries: [combined]});
              const domain = await import(chrome.runtime.getURL('composer.js'));
              const session = domain.createComposerSession({referenceSnapshots: domain.createReferenceSnapshots([combined], [{entryId: combined.id, assetIds: combined.mediaAssets.map(asset => asset.id)}])});
              await chrome.runtime.sendMessage({type: 'UPSERT_COMPOSER_SESSION', session});
              const response = await chrome.runtime.sendMessage({type: 'START_OR_JOIN_ANALYSIS_TASK', sessionId: session.id, tempReferenceIds: session.referenceSnapshots.map(reference => reference.referenceId), clientRequestId: crypto.randomUUID(), consumerId: crypto.randomUUID()});
              return {entryId: combined.id, sessionId: session.id, response};
            }"""
        )
        assert task_ids["response"]["ok"], task_ids
        from e2e_support import wait_for_async_condition
        completed = wait_for_async_condition(composer,
            """async (taskId) => {
              const response = await chrome.runtime.sendMessage({type:'GET_ANALYSIS_TASK',taskId});
              return ['completed','failed'].includes(response.task?.status) ? response : null;
            }""", arg=task_ids["response"]["task"]["id"])
        assert completed["task"]["status"] == "completed", completed
        saved_analyses = composer.evaluate(
            """async (entryId) => {
              const stored = await chrome.storage.local.get('entries');
              return stored.entries.find(entry => entry.id === entryId).mediaAssets.filter(asset => asset.kind === 'image').map(asset => asset.visionAnalysis);
            }""", task_ids["entryId"])
        assert len(saved_analyses) == 2 and all(value and value.get("reconstructionPrompt") for value in saved_analyses), saved_analyses
        assert not run.page_errors, run.page_errors
        print({"inputPaths": ["file", "paste", "drop"], "mobile": mobile_geometry,
               "originalImagesSent": len(images), "automaticAnalysisRequests": 0,
               "switchModelMenuStaysOpen": True, "explicitAnalysisSavedImages": len(saved_analyses),
               "savedCases": len(entries)})


if __name__ == "__main__":
    main()
