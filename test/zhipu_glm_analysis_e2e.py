from __future__ import annotations

import json
import shutil
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect

from e2e_support import EXTENSION_DIR, base_entry, extension_session, wait_for_async_condition


PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
ANALYSIS_TASKS = ["textTags", "skillExtraction", "creativePlanning", "imageAnalysis", "videoAnalysis"]


@contextmanager
def zhipu_mock_server(requests: list[dict], lifecycle_release=None, video_responses=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args) -> None:
            return

        def send_json(self, payload: dict, *, content_type: str = "application/json") -> None:
            body = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            self.send_json({"data": [{"id": "glm-5.3-flash"}]})

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            requests.append({
                "url": self.path,
                "authorization": self.headers.get("Authorization", ""),
                "payload": payload,
            })
            content = payload.get("messages", [{}])[-1].get("content", [])
            if payload.get("stream") is True:
                visible = '{"route":"compose","status":"ready"}\n黑场中主体快速出现，镜头稳定推进。'
                event = json.dumps({
                    "model": "glm-5.3-flash",
                    "choices": [{"delta": {"content": visible}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 16, "completion_tokens": 7, "total_tokens": 23},
                }, ensure_ascii=False)
                body = f"data: {event}\n\ndata: [DONE]\n\n".encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
                return
            if isinstance(content, list) and any(item.get("type") == "image_url" for item in content):
                result = {
                    "reconstructionPrompt": "深色背景中的中央主体，保持居中构图和清晰轮廓。",
                    "tags": [{"g": "camera.composition", "t": "居中构图"}],
                }
            elif isinstance(content, list) and any(item.get("type") == "video_url" for item in content):
                if video_responses:
                    self.send_json(video_responses.pop(0))
                    return
                video_payload = next(item["video_url"]["url"] for item in content if item.get("type") == "video_url")
                if len(video_payload) > 1_000_000:
                    if lifecycle_release is not None:
                        assert lifecycle_release.wait(30), "后台回收实验未释放视频响应"
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
            else:
                result = {
                    "route": "compose",
                    "status": "ready",
                    "suggestedTitle": "GLM 创作链路",
                    "instruction": "把主体出现设计成前三秒钩子。",
                    "question": None,
                    "librarySearch": None,
                }
            self.send_json({
                "model": "glm-5.3-flash",
                "choices": [{"message": {"content": json.dumps(result, ensure_ascii=False)}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
            })

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/api/paas/v4/chat/completions"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@contextmanager
def extension_with_local_provider_permission(endpoint: str):
    with TemporaryDirectory(prefix="prompt-director-local-provider-extension-") as directory:
        target = Path(directory)
        for source in EXTENSION_DIR.iterdir():
            if source.name == "manifest.json":
                continue
            if source.is_file() and source.suffix in {".js", ".html", ".css"}:
                shutil.copy2(source, target / source.name)
            elif source.is_dir() and source.name in {"assets", "vendor", "_locales"}:
                shutil.copytree(source, target / source.name)
        manifest = json.loads((EXTENSION_DIR / "manifest.json").read_text())
        local_origin = f"{endpoint.split('/api/', 1)[0]}/*"
        manifest["host_permissions"] = [*manifest.get("host_permissions", []), local_origin]
        (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        yield target


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

    requests: list[dict] = []
    video_responses: list[dict] = []
    lifecycle_release = threading.Event()
    with zhipu_mock_server(requests, lifecycle_release, video_responses) as endpoint, extension_with_local_provider_permission(endpoint) as extension_dir, extension_session(
        "prompt-director-zhipu-glm-", viewport={"width": 1280, "height": 900}, extension_dir=extension_dir
    ) as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [image_entry, video_entry, local_video_entry],
            "uiPreferences": {"locale": "zh-CN", "theme": "light", "motion": "none", "analysisDiagnostics": True},
        })
        configured = setup.evaluate(
            """async ({tasks, endpoint}) => {
              const connection = await chrome.runtime.sendMessage({
                type: 'UPDATE_AI_PROVIDER_CONFIGURATION',
                registry: {providers: {zhipu: {apiKey: 'zhipu-e2e-secret', endpoint, consent: true}}}
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
            {"tasks": ANALYSIS_TASKS, "endpoint": endpoint},
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
        assert image_request["max_tokens"] == 131072, "图片应使用 GLM 官方 128K 输出能力"

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
        assert video_request["max_tokens"] == 131072, "案例视频输出额度必须贯通实际请求"
        assert video_part["video_url"]["url"] == "https://assets.example/zhipu-video.mp4", video_part

        requests_before_local_preflight = len(requests)
        library = run.open_page("library.html", wait_until="networkidle")
        library.evaluate("() => { chrome.permissions.request = async () => true; }")
        library.evaluate(
            """async () => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = new Uint8Array(16 * 1024 * 1024);
              bytes.set([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]);
              await saveMediaBlob('zhipu-local-video', new Blob([bytes], {type: 'video/mp4'}), {checkCapacity: false});
            }"""
        )
        library.locator('.case-card[data-entry-id="zhipu-local-video-entry"]').click()
        expect(library.locator(".video-analysis-run")).to_have_count(1)
        expect(library.locator(".video-analysis-instruction")).to_have_count(0)
        expect(library.locator(".video-analysis-history")).to_have_count(0)
        expect(library.locator(".detail-analysis-menu")).to_have_count(0)
        analysis_workspace = library.locator(".video-analysis-workspace")
        assert analysis_workspace.evaluate("element => element.scrollWidth <= element.clientWidth") is True
        original_worker = run.context.service_workers[0]
        library.evaluate("""() => {
          window.videoTaskTransitions = [];
          chrome.storage.onChanged.addListener(changes => {
            for (const task of changes.analysisTasks?.newValue?.items ?? []) {
              if (task.request?.entryId === 'zhipu-local-video-entry') window.videoTaskTransitions.push({
                status: task.status, phase: task.phase, updatedAt: task.updatedAt
              });
            }
          });
        }""")
        library.get_by_role("button", name="逆推视频提示词", exact=True).click()
        wait_for_async_condition(library,
            """async () => {
              const stored = await chrome.storage.local.get('analysisTasks');
              return stored.analysisTasks?.items?.some(task =>
                task.request?.entryId === 'zhipu-local-video-entry'
                && task.status === 'running'
                && task.phase === 'analyzing'
              );
            }"""
        )
        lifecycle_task_id = library.evaluate(
            """async () => {
              const stored = await chrome.storage.local.get('analysisTasks');
              return stored.analysisTasks.items.find(item =>
                item.request?.entryId === 'zhipu-local-video-entry' && item.status === 'running'
              ).id;
            }"""
        )
        cdp = run.context.new_cdp_session(library)
        versions: list[dict] = []
        cdp.on("ServiceWorker.workerVersionUpdated", lambda event: versions.extend(event.get("versions", [])))
        cdp.send("ServiceWorker.enable")
        library.wait_for_timeout(100)
        worker_version = next(version for version in versions if version.get("scriptURL") == original_worker.url)
        cdp.send("ServiceWorker.stopWorker", {"versionId": worker_version["versionId"]})
        lifecycle_release.set()
        library.evaluate(
            """async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return chrome.runtime.sendMessage({type: 'GET_STATE'});
            }"""
        )
        wait_for_async_condition(library,
            """async (taskId) => {
              const stored = await chrome.storage.local.get('analysisTasks');
              const task = stored.analysisTasks?.items?.find(item => item.id === taskId);
              return task?.status === 'completed';
            }""",
            arg=lifecycle_task_id,
            timeout=30_000,
        )
        lifecycle_task = library.evaluate(
            """async (taskId) => {
              const stored = await chrome.storage.local.get('analysisTasks');
              return stored.analysisTasks.items.find(item => item.id === taskId);
            }""",
            lifecycle_task_id,
        )
        assert lifecycle_task["status"] == "completed", {"task": lifecycle_task, "transitions": library.evaluate("window.videoTaskTransitions")}
        expect(library.locator(".video-reconstruction-current .video-reconstruction-editor")).to_have_value(
            "00:01 黑场出现主体，00:03 镜头稳定推进。",
            timeout=30_000,
        )
        assert len(requests) == requests_before_local_preflight + 1, requests
        local_video_request = requests[-1]["payload"]
        assert local_video_request["max_tokens"] == 131072, "Offscreen 本地视频不能回落到通用额度"
        local_video_part = next(part for part in local_video_request["messages"][-1]["content"] if part["type"] == "video_url")
        assert local_video_part["video_url"]["url"].startswith("AAAADGZ0eXBpc29t"), local_video_part
        assert not local_video_part["video_url"]["url"].startswith("data:"), local_video_part
        active_targets = cdp.send("Target.getTargets")["targetInfos"]
        assert any(
            target["type"] == "service_worker" and target["url"] == original_worker.url
            for target in active_targets
        ), active_targets
        stored_video = library.evaluate(
            """async () => {
              const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
              const entry = state.entries.find(item => item.id === 'zhipu-local-video-entry');
              const taskState = await chrome.storage.local.get('analysisTasks');
              const task = taskState.analysisTasks.items.find(item => item.request?.entryId === entry.id);
              return {
                taskStatus: task.status,
                reconstruction: entry.videoAnalyses.find(item => item.mode === 'visual-reconstruction')?.reconstructionPrompt || '',
                tags: entry.facetAssignments.filter(item => item.source === 'vision_model' && item.visualId === 'zhipu-local-video').length,
              };
            }"""
        )
        assert stored_video["taskStatus"] == "completed", stored_video
        assert stored_video["reconstruction"], stored_video
        assert stored_video["tags"] > 0, stored_video
        library.set_viewport_size({"width": 390, "height": 844})
        assert analysis_workspace.evaluate("element => element.scrollWidth <= element.clientWidth") is True
        library.set_viewport_size({"width": 1280, "height": 900})
        library.reload(wait_until="networkidle")
        library.locator('.case-card[data-entry-id="zhipu-local-video-entry"]').click()
        expect(library.locator(".video-reconstruction-current .video-reconstruction-editor")).to_have_value(
            "00:01 黑场出现主体，00:03 镜头稳定推进。"
        )

        composer_session_id = library.evaluate(
            """async () => {
              const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
              const {createComposerSession, createReferenceSnapshots} = await import(chrome.runtime.getURL('composer.js'));
              const session = createComposerSession({
                id: 'zhipu-video-composer-e2e',
                title: 'GLM 视频对话',
                targetType: 'video',
                aiProfile: {serviceId: 'zhipu', model: 'glm-5.3-flash'},
                referenceSnapshots: createReferenceSnapshots(
                  state.entries,
                  [{entryId: 'zhipu-local-video-entry', assetIds: ['zhipu-local-video']}],
                  'zh-CN',
                  'video'
                )
              });
              const saved = await chrome.runtime.sendMessage({type: 'UPSERT_COMPOSER_SESSION', session});
              if (!saved?.ok) throw new Error(saved?.message || '无法保存视频创作会话');
              return session.id;
            }"""
        )
        composer = run.open_page(f"composer.html?session={composer_session_id}")
        composer.locator("#composer-model-trigger").click()
        dynamic_choice = composer.locator("#composer-model-dynamic button", has_text="glm-5.3-flash")
        if dynamic_choice.count() == 0:
            raise AssertionError({"dynamicHtml": composer.locator("#composer-model-dynamic").inner_html()})
        expect(dynamic_choice).to_be_visible()
        expect(dynamic_choice).to_contain_text("glm-5.3-flash")
        dynamic_choice.click()
        expect(composer.locator("#composer-model-label")).to_contain_text("智谱 GLM")
        expect(composer.locator(".composer-input-reference-card")).to_have_count(1)
        requests_before_composer = len(requests)
        composer.locator("#composer-instruction").fill("为这个主体设计一个前三秒广告钩子")
        composer.locator("#composer-action").click()
        try:
            wait_for_async_condition(composer, """async () => {
              const {creativeJobs} = await chrome.storage.local.get('creativeJobs');
              return creativeJobs?.items?.some(job => ['completed', 'failed', 'interrupted'].includes(job.status));
            }""")
        except AssertionError:
            print(composer.locator('body').inner_text())
            raise
        job_facts = composer.evaluate("""async () => {
          const {creativeJobs} = await chrome.storage.local.get('creativeJobs');
          return creativeJobs.items.map(({status, phase, error, actualStages}) => ({status, phase, error, actualStages}));
        }""")
        assert job_facts[-1]['status'] == 'completed', job_facts
        expect(composer.locator(".composer-message.prompt .composer-message-text")).to_contain_text("镜头稳定推进")
        assert len(requests) == requests_before_composer + 1, requests
        composer_request = requests[-1]["payload"]
        composer_video = next(
            part for part in composer_request["messages"][-1]["content"] if part.get("type") == "video_url"
        )
        assert composer_video["video_url"]["url"].startswith("AAAADGZ0eXBpc29t"), composer_video
        assert composer_request["stream"] is True, composer_request
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

        before_failure = len(requests)
        video_responses.append({"model": "glm-5.3-flash", "choices": [{
            "finish_reason": "length", "message": {"content": ""}
        }]})
        library.evaluate("() => { chrome.permissions.request = async () => true; }")
        library.get_by_role("button", name="逆推视频提示词", exact=True).click()
        failed_task = wait_for_async_condition(library, """async () => {
          const response = await chrome.runtime.sendMessage({type: 'GET_ENTRY_VIDEO_ANALYSIS_TASK',
            entryId: 'zhipu-local-video-entry', assetId: 'zhipu-local-video'});
          return response.task?.status === 'failed' ? response.task : null;
        }""")
        assert len(requests) == before_failure + 1, "截断结果不得自动重发"
        attempt = failed_task["attempts"][-1]
        assert attempt["diagnostic"]["httpStatus"] == 200, attempt
        assert attempt["diagnostic"]["finishReason"] == "length", attempt
        assert attempt["diagnostic"]["contentLength"] == 0, attempt
        assert attempt["diagnostic"]["inputTokens"] is None, attempt
        assert attempt["requestBudget"]["providerCalls"] == 1, attempt
        assert "zhipu-e2e-secret" not in json.dumps(failed_task)
        library.reload(wait_until="networkidle")
        library.locator('.case-card[data-entry-id="zhipu-local-video-entry"]').click()
        expect(library.locator(".video-analysis-task-status")).to_contain_text("截断")
        expect(library.locator(".video-reconstruction-current .video-reconstruction-editor")).to_have_value(
            "00:01 黑场出现主体，00:03 镜头稳定推进。"
        )
        expect(library.locator(".video-analysis-task-status .analysis-diagnostics")).to_have_count(0)
        library.locator("#open-settings").dispatch_event("click")
        library.locator('[data-settings-tab="tasks"]').click()
        details = library.locator("#analysis-diagnostics")
        details.locator("summary").click()
        expect(details).to_contain_text("HTTP: 200")
        expect(details).to_contain_text("finish: length")
        library.get_by_role("button", name="关闭设置", exact=True).click()
        library.set_viewport_size({"width": 390, "height": 844})
        assert analysis_workspace.evaluate("element => element.scrollWidth <= element.clientWidth") is True
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
