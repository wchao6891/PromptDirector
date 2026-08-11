from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
DIMENSIONS = ["subject", "scene", "action", "style", "camera", "light", "mood", "sound", "output", "workflow"]


def complete_analysis(description: str, *, model_response: bool = False) -> dict:
    return {
        "description": description,
        "canvas": {
            "width": 1,
            "height": 1,
            "aspectRatio": "1:1",
            "orientation": "square",
            "dominantColors": [{"hex": "#101820", "coveragePercent": 70, "source": "estimated"}],
        },
        "elements": [{
            "id": "subject-1",
            "label": "中央主体",
            "category": "subject",
            **({"box_2d": [150, 250, 850, 750]} if model_response else {
                "bbox": {"x": 250, "y": 150, "width": 500, "height": 700, "source": "estimated"}
            }),
            "coveragePercent": 35,
            "depthLayer": "foreground",
            "occludes": [],
            "occludedBy": [],
            "relationships": ["位于画面中央"],
            "visualAttributes": ["清晰轮廓"],
        }],
        "dimensions": [{
            "id": dimension,
            "applicable": dimension != "sound",
            "facts": [] if dimension == "sound" else [f"{dimension} 可见事实"],
            "measurements": [],
        } for dimension in DIMENSIONS],
        "ocr": [],
        "reconstructionPrompt": f"{description}，主体居中，完整还原构图和光色。",
        "limitations": ["无法确认画外信息"],
        "completeness": {"checkedRegions": ["四角", "主体", "背景", "文字"], "omittedVisibleElements": []},
        "tags": [],
    }


class AiHandler(BaseHTTPRequestHandler):
    visual_requests: list[dict] = []
    summary_requests: list[dict] = []
    fail_visual_request_once = 2

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        if self.path.endswith("/responses"):
            self.visual_requests.append(payload)
            if len(self.visual_requests) == self.fail_visual_request_once:
                return self.reply({"error": {"message": "temporary local fixture failure"}}, status=503)
            result = complete_analysis(f"第 {len(self.visual_requests)} 张待补齐图片", model_response=True)
            return self.reply({
                "model": "local-vision-v2",
                "output_text": json.dumps(result, ensure_ascii=False),
                "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
            })
        self.summary_requests.append(payload)
        user_content = payload["messages"][-1]["content"]
        assets = json.loads(user_content)["assets"]
        summary = {
            "imageRoles": [{"assetId": item["assetId"], "role": f"第 {index + 1} 张的独立角色"} for index, item in enumerate(assets)],
            "sharedVisualSystem": ["统一低饱和光色"],
            "differences": ["构图和主体状态不同"],
            "continuity": ["形成同一视觉序列"],
            "compositionRules": ["保持主体层级清晰"],
            "reusablePrompt": "统一低饱和视觉系统，逐图保持各自构图与主体状态。",
        }
        return self.reply({
            "model": "local-summary",
            "choices": [{"message": {"content": json.dumps(summary, ensure_ascii=False)}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
        })

    def cors(self) -> None:
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "authorization, content-type")
        self.send_header("access-control-allow-methods", "POST, OPTIONS")

    def reply(self, payload: dict, *, status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, _format: str, *_args) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), AiHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"

    entry = base_entry("visual-batch-case", "十五图批量分析案例", "案例共享提示词", "content:prompt:image")
    entry["mediaAssets"] = [{
        "id": f"visual-batch-{index}",
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
        "byteSize": 68,
    } for index in range(1, 16)]
    entry["primaryMediaId"] = "visual-batch-1"
    entry["mediaPrompts"] = [
        {"assetId": "visual-batch-1", "text": "用户手动保存的第一张提示词", "source": "manual", "updatedAt": "2026-08-01T00:00:00.000Z"},
        {"assetId": "visual-batch-3", "text": "旧版简短分析提示词", "source": "ai-suggestion", "updatedAt": "2026-08-01T00:00:00.000Z"},
    ]

    with extension_session("prompt-director-visual-batch-", viewport={"width": 1280, "height": 900}) as run:
        setup = run.open_page("collector.html")
        setup.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [entry],
            "aiProviderRegistry": {
                "version": 3,
                "providers": {
                    "custom-text": {
                        "endpoint": f"{origin}/v1/chat/completions",
                        "protocol": "chat_completions",
                        "consent": True,
                        "models": {
                            "textTags": "local-summary",
                            "skillExtraction": "local-summary",
                            "creativePlanning": "local-summary",
                        },
                    },
                    "custom-media": {
                        "endpoint": f"{origin}/v1/responses",
                        "protocol": "responses",
                        "consent": True,
                        "models": {"imageAnalysis": "local-vision-v2"},
                    },
                },
            },
            "aiTaskAssignments": {
                "creativePlanning": {"providerId": "custom-text", "model": "local-summary"},
                "imageAnalysis": {"providerId": "custom-media", "model": "local-vision-v2"},
            },
        })
        setup.evaluate(
            f"""async () => {{
              const {{saveMediaBlob}} = await import(chrome.runtime.getURL('media-store.js'));
              const {{imageFingerprint}} = await import(chrome.runtime.getURL('vision.js'));
              const bytes = Uint8Array.from(atob('{PNG}'), value => value.charCodeAt(0));
              const blob = new Blob([bytes], {{type: 'image/png'}});
              const fingerprint = await imageFingerprint(blob);
              for (let index = 1; index <= 15; index += 1) await saveMediaBlob(`visual-batch-${{index}}`, blob, {{checkCapacity: false}});
              const stored = await chrome.storage.local.get('entries');
              const entry = stored.entries[0];
              entry.mediaAssets.forEach(asset => {{ asset.contentHash = fingerprint; }});
              entry.mediaAssets[0].visionAnalysis = {{
                ...{json.dumps(complete_analysis('第一张已有有效分析'), ensure_ascii=False)},
                version: 2,
                imageFingerprint: fingerprint,
                profileFingerprint: 'saved-profile',
                providerType: 'compatible',
                model: 'previous-model',
                createdAt: '2026-08-01T00:00:00.000Z'
              }};
              entry.mediaAssets[2].visionAnalysis = {{
                ...{json.dumps(complete_analysis('第三张过期分析'), ensure_ascii=False)},
                version: 2,
                imageFingerprint: 'expired-fingerprint',
                profileFingerprint: 'old-profile',
                providerType: 'compatible',
                model: 'old-model',
                createdAt: '2026-08-01T00:00:00.000Z'
              }};
              await chrome.storage.local.set({{entries: stored.entries}});
            }}"""
        )

        library = run.open_page("library.html", wait_until="networkidle")
        library.locator(".case-card").click()
        analysis_menu = library.locator(".detail-analysis-menu")
        analysis_menu.locator(":scope > summary").click()
        analysis_menu.get_by_role("button", name="批量图片分析").click()

        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text("默认补齐 14 张缺失或过期分析")
        expect(dialog).to_contain_text("自定义兼容服务（图片与生成） · local-vision-v2")
        expect(dialog).to_contain_text("自定义兼容服务（文字） · local-summary")
        expect(dialog.locator(".visual-analysis-card")).to_have_count(15)
        expect(dialog.get_by_role("button", name="选择缺失/过期")).to_be_visible()
        expect(dialog.get_by_role("button", name="全选")).to_be_visible()
        expect(dialog.get_by_role("button", name="清空")).to_be_visible()
        expect(dialog.get_by_label("选择图片 1", exact=True)).not_to_be_checked()
        expect(dialog.get_by_label("选择图片 2", exact=True)).to_be_checked()
        expect(dialog.get_by_label("选择图片 3", exact=True)).to_be_checked()
        assert dialog.locator(".visual-analysis-card").first.bounding_box()["width"] >= 140
        dialog.get_by_role("button", name="开始分析").click()

        expect(dialog).to_contain_text("1 张失败，已成功 13 张且不会重复请求", timeout=15_000)
        expect(dialog.locator('.visual-analysis-card[data-state="failed"]')).to_have_count(1)
        expect(dialog.locator('.visual-analysis-card[data-state="completed"]')).to_have_count(13)
        assert len(AiHandler.visual_requests) == 14
        assert len(AiHandler.summary_requests) == 0
        dialog.get_by_role("button", name="开始分析").click()

        suggestions = library.locator("#promptdirector-app-dialog")
        expect(suggestions).to_contain_text("确认更新图片提示词", timeout=15_000)
        expect(suggestions).to_contain_text("用户复制、采集、导入或手动编辑的提示词不会被覆盖")
        expect(suggestions.locator("textarea")).to_have_count(1)
        before_confirm = library.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries[0].mediaPrompts)")
        assert next(item for item in before_confirm if item["assetId"] == "visual-batch-3")["text"] == "旧版简短分析提示词"
        suggestions.get_by_role("button", name="确认替换").click()
        expect(suggestions).not_to_be_visible()

        stored = library.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries[0])")
        analyses = [asset.get("visionAnalysis") for asset in stored["mediaAssets"]]
        assert all(analysis and analysis["version"] == 2 for analysis in analyses), analyses
        assert analyses[0]["createdAt"] == "2026-08-01T00:00:00.000Z"
        assert all(asset["contentHash"] == asset["visionAnalysis"]["imageFingerprint"] for asset in stored["mediaAssets"])
        assert len(stored["visualSetAnalyses"]) == 1
        prompts = {item["assetId"]: item for item in stored["mediaPrompts"]}
        assert prompts["visual-batch-1"]["text"] == "用户手动保存的第一张提示词"
        assert prompts["visual-batch-1"]["source"] == "manual"
        assert prompts["visual-batch-3"]["text"] == analyses[2]["reconstructionPrompt"]
        assert prompts["visual-batch-3"]["source"] == "ai-suggestion"
        assert stored["visualSetAnalyses"][0]["version"] == 1
        assert len(AiHandler.visual_requests) == 15
        assert len(AiHandler.summary_requests) == 1
        assert "data:image" not in json.dumps(AiHandler.summary_requests[0])

        print({
            "existingV2Reused": 1,
            "visualRequests": len(AiHandler.visual_requests),
            "failedImageRetriedOnly": 1,
            "textSummaryRequests": len(AiHandler.summary_requests),
            "summarySentOriginalImages": False,
        })

    server.shutdown()


if __name__ == "__main__":
    main()
