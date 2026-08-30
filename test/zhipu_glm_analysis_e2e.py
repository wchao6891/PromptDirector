from __future__ import annotations

import json

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
ANALYSIS_TASKS = ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"]


def main() -> None:
    image_entry = base_entry("zhipu-image-entry", "GLM 图片分析", "测试图片", "content:reference")
    image_entry["mediaAssets"] = [{
        "id": "zhipu-image",
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
        "byteSize": 68,
    }]
    image_entry["primaryMediaId"] = "zhipu-image"
    video_entry = base_entry("zhipu-video-entry", "GLM 视频分析", "测试视频", "content:reference")
    video_entry["mediaAssets"] = [{
        "id": "zhipu-video",
        "kind": "video",
        "usage": "content",
        "storageMode": "reference",
        "mimeType": "video/mp4",
        "reference": {
            "url": "https://assets.example/zhipu-video.mp4",
            "provider": "fixture",
            "playbackMode": "external",
        },
    }]
    video_entry["primaryMediaId"] = "zhipu-video"
    local_video_entry = base_entry("zhipu-local-video-entry", "GLM 本地视频边界", "本地测试视频", "content:reference")
    local_video_entry["mediaAssets"] = [{
        "id": "zhipu-local-video",
        "kind": "video",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "video/mp4",
        "byteSize": 12,
    }]
    local_video_entry["primaryMediaId"] = "zhipu-local-video"

    with extension_session("prompt-director-zhipu-glm-", viewport={"width": 1280, "height": 900}) as run:
        requests: list[dict] = []

        def mock_zhipu(route) -> None:
            if route.request.method == "GET" and route.request.url == "https://open.bigmodel.cn/api/paas/v4/models":
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='{"data":[{"id":"glm-5.3-flash"}]}',
                )
                return
            payload = route.request.post_data_json
            requests.append({
                "url": route.request.url,
                "authorization": route.request.headers.get("authorization", ""),
                "payload": payload,
            })
            content = payload.get("messages", [{}])[-1].get("content", [])
            if isinstance(content, list) and any(item.get("type") == "image_url" for item in content):
                result = {
                    "reconstructionPrompt": "深色背景中的中央主体，保持居中构图和清晰轮廓。",
                    "tags": [{"g": "camera.composition", "t": "居中构图"}],
                }
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({
                        "model": "glm-5.3-flash",
                        "choices": [{"message": {"content": json.dumps(result, ensure_ascii=False)}}],
                        "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
                    }, ensure_ascii=False),
                )
                return
            if isinstance(content, list) and any(item.get("type") == "video_url" for item in content):
                result = {
                    "reconstructionPrompt": "00:01 黑场出现主体，00:03 镜头稳定推进。",
                    "tags": [
                        {"g": "style.render", "t": "电影写实"},
                        {"g": "camera.shot", "t": "近景主体"},
                        {"g": "camera.motion", "t": "稳定推进"},
                        {"g": "light.palette", "t": "深色背景"},
                    ],
                    "uncertainties": [],
                }
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({
                        "model": "glm-5.3-flash",
                        "choices": [{
                            "message": {"content": json.dumps(result, ensure_ascii=False)
                                if payload.get("response_format") == {"type": "json_object"}
                                else "00:01 黑场出现主体，00:03 镜头推进。"},
                            "finish_reason": "stop",
                        }],
                        "usage": {"prompt_tokens": 12, "completion_tokens": 6, "total_tokens": 18},
                    }, ensure_ascii=False),
                )
                return
            if payload.get("stream") is True:
                content = '{"route":"compose","status":"ready"}\n黑场中主体快速出现，镜头稳定推进。'
                body = (
                    f'data: {json.dumps({"model": "glm-5.3-flash", "choices": [{"delta": {"content": content}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 16, "completion_tokens": 7, "total_tokens": 23}}, ensure_ascii=False)}\n\n'
                    "data: [DONE]\n\n"
                )
                route.fulfill(status=200, content_type="text/event-stream", body=body)
                return
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "model": "glm-5.3-flash",
                    "choices": [{"message": {"content": json.dumps({
                        "route": "compose",
                        "status": "ready",
                        "suggestedTitle": "GLM 创作链路",
                        "instruction": "把主体出现设计成前三秒钩子。",
                        "question": None,
                        "librarySearch": None,
                    }, ensure_ascii=False)}}],
                    "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
                }, ensure_ascii=False),
            )

        run.context.route("https://open.bigmodel.cn/**", mock_zhipu)
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [image_entry, video_entry, local_video_entry],
            "uiPreferences": {"locale": "zh-CN", "theme": "light", "motion": "none"},
        })
        configured = setup.evaluate(
            """async (tasks) => {
              const connection = await chrome.runtime.sendMessage({
                type: 'UPDATE_AI_PROVIDER_CONFIGURATION',
                registry: {providers: {zhipu: {apiKey: 'zhipu-e2e-secret', consent: true}}}
              });
              if (!connection?.ok) throw new Error(connection?.message || '连接保存失败');
              const catalog = await chrome.runtime.sendMessage({type: 'DISCOVER_AI_PROVIDER_MODELS', providerId: 'zhipu', force: true});
              if (!catalog?.ok) throw new Error(catalog?.message || '模型目录读取失败');
              const stored = await chrome.storage.local.get('aiTaskAssignments');
              const assignments = {...stored.aiTaskAssignments};
              for (const taskId of tasks) assignments[taskId] = {providerId: 'zhipu', model: 'glm-5.3-flash'};
              const saved = await chrome.runtime.sendMessage({type: 'UPDATE_AI_PROVIDER_CONFIGURATION', assignments});
              if (!saved?.ok) throw new Error(saved?.message || '任务分配失败');
              const runtimes = {};
              for (const taskId of tasks) {
                runtimes[taskId] = await chrome.runtime.sendMessage({type: 'GET_AI_TASK_RUNTIME', taskId});
              }
              return {catalog, saved, runtimes};
            }""",
            ANALYSIS_TASKS,
        )
        assert configured["catalog"]["message"] == "智谱 GLM 已发现 2 个模型", configured
        catalog_models = configured["catalog"]["aiProviderRegistry"]["providers"]["zhipu"]["discoveredModels"]
        by_model = {model["id"]: model for model in catalog_models}
        assert by_model["glm-5.3-flash"]["status"] == "available", by_model
        assert by_model["glm-5.3-flash"]["source"] == "provider_models+official_capabilities", by_model
        assert by_model["glm-4.6v"]["status"] == "unverified", by_model
        for task_id in ANALYSIS_TASKS:
            runtime = configured["runtimes"][task_id]
            assert runtime["assignment"]["providerId"] == "zhipu", runtime
            assert runtime["assignment"]["model"] == "glm-5.3-flash", runtime

        setup.evaluate(
            f"""async () => {{
              const {{saveMediaBlob}} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob('{PNG}'), value => value.charCodeAt(0));
              await saveMediaBlob('zhipu-image', new Blob([bytes], {{type: 'image/png'}}), {{checkCapacity: false}});
              await saveMediaBlob('zhipu-local-video', new Blob([Uint8Array.from([0,0,0,12,102,116,121,112,105,115,111,109])], {{type: 'video/mp4'}}), {{checkCapacity: false}});
            }}"""
        )

        image_result = setup.evaluate(
            """() => chrome.runtime.sendMessage({
              type: 'ANALYZE_ENTRY_IMAGE', entryId: 'zhipu-image-entry', visualId: 'zhipu-image', outputLocale: 'zh-CN'
            })"""
        )
        assert image_result["ok"] is True, image_result
        image_request = next(item["payload"] for item in requests if any(
            part.get("type") == "image_url"
            for part in item["payload"].get("messages", [{}])[-1].get("content", [])
        ))
        image_part = next(part for part in image_request["messages"][-1]["content"] if part["type"] == "image_url")
        assert image_part == {
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{PNG}", "detail": "high"},
        }, image_part
        assert image_request["response_format"] == {"type": "json_object"}, image_request

        video_result = setup.evaluate(
            """async () => {
              const started = await chrome.runtime.sendMessage({
                type: 'START_OR_JOIN_ANALYSIS_TASK', kind: 'entry_video',
                entryId: 'zhipu-video-entry', assetId: 'zhipu-video', mode: 'content-summary',
                instruction: '只用一句中文概括视频可见内容。', includeTags: false,
                consumerId: 'zhipu-e2e', clientRequestId: 'zhipu-e2e-public-video',
                priority: 'interactive', outputLocale: 'zh-CN'
              });
              if (!started?.ok) return started;
              for (let index = 0; index < 100; index += 1) {
                const current = await chrome.runtime.sendMessage({type: 'GET_ANALYSIS_TASK', taskId: started.task.id});
                if (!['queued', 'running'].includes(current?.task?.status)) return current;
                await new Promise(resolve => setTimeout(resolve, 20));
              }
              return {ok: false, message: '视频分析任务等待超时'};
            }"""
        )
        assert video_result["ok"] is True, video_result
        assert video_result["task"]["status"] == "completed", video_result
        video_request = next(item["payload"] for item in requests if any(
            part.get("type") == "video_url"
            for part in item["payload"].get("messages", [{}])[-1].get("content", [])
        ))
        video_part = next(part for part in video_request["messages"][-1]["content"] if part["type"] == "video_url")
        assert video_part["video_url"]["url"] == "https://assets.example/zhipu-video.mp4", video_part

        requests_before_local_preflight = len(requests)
        library = run.open_page("library.html", wait_until="networkidle")
        library.evaluate("() => { chrome.permissions.request = async () => true; }")
        library.locator('.case-card[data-entry-id="zhipu-local-video-entry"]').click()
        library.get_by_role("button", name="逆推提示词", exact=True).click()
        expect(library.locator(".video-reconstruction-current .video-reconstruction-editor")).to_have_value(
            "00:01 黑场出现主体，00:03 镜头稳定推进。"
        )
        assert len(requests) == requests_before_local_preflight + 1, requests
        local_video_request = requests[-1]["payload"]
        local_video_part = next(part for part in local_video_request["messages"][-1]["content"] if part["type"] == "video_url")
        assert local_video_part["video_url"]["url"] == "AAAADGZ0eXBpc29t", local_video_part

        composer = run.open_page("composer.html")
        composer.locator("#composer-model-trigger").click()
        dynamic_choice = composer.locator("#composer-model-dynamic button", has_text="glm-5.3-flash")
        if dynamic_choice.count() == 0:
            raise AssertionError({
                "dynamicHtml": composer.locator("#composer-model-dynamic").inner_html(),
                "menuHtml": composer.locator("#composer-model-menu").inner_html(),
                "runtime": composer.evaluate("() => chrome.runtime.sendMessage({type: 'GET_COMPOSER_AI_RUNTIME'})"),
                "pageErrors": run.page_errors,
            })
        expect(dynamic_choice).to_be_visible()
        expect(dynamic_choice).to_contain_text("glm-5.3-flash")
        dynamic_choice.click()
        expect(composer.locator("#composer-model-label")).to_contain_text("智谱 GLM")
        composer.locator("#composer-instruction").fill("为这个主体设计一个前三秒广告钩子")
        composer.locator("#composer-action").click()
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_contain_text("镜头稳定推进")
        session_id = composer.evaluate("() => new URL(location.href).searchParams.get('session')")
        composer.reload(wait_until="networkidle")
        expect(composer.locator("#composer-model-label")).to_contain_text("智谱 GLM")
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_contain_text("镜头稳定推进")
        assert composer.evaluate("() => new URL(location.href).searchParams.get('session')") == session_id

        assert all(item["authorization"] == "Bearer zhipu-e2e-secret" for item in requests), requests
        stored = composer.evaluate("() => chrome.storage.local.get(['aiProviderRegistry', 'aiTaskAssignments', 'composerSessions'])")
        assert stored["aiProviderRegistry"]["providers"]["zhipu"]["apiKey"] == "zhipu-e2e-secret"
        assert all(stored["aiTaskAssignments"][task]["providerId"] == "zhipu" for task in ANALYSIS_TASKS)
        assert stored["composerSessions"], stored
        print({
            "zhipuCatalog": True,
            "analysisAssignments": len(ANALYSIS_TASKS),
            "dataUrlImage": True,
            "publicVideoUrl": True,
            "composerGlmPlanning": True,
            "refreshRecovery": True,
            "paidRequests": 0,
        })


if __name__ == "__main__":
    main()
