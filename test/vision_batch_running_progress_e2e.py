from __future__ import annotations

import base64
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


class HangingVisionHandler(BaseHTTPRequestHandler):
    request_started = Event()
    release_requests = Event()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(length)
        type(self).request_started.set()
        if not type(self).release_requests.wait(timeout=10):
            return self.reply({"error": {"message": "fixture timed out"}}, status=503)
        return self.reply({
            "model": "local-progress-vision",
            "output_text": json.dumps({
                "reconstructionPrompt": "主体位于画面中央，低饱和电影光线，完整保留构图、景深与材质细节。",
                "tags": [{"g": "style.render", "t": "电影感"}],
            }, ensure_ascii=False),
            "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
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


def image_entry(entry_id: str, minute: int) -> dict:
    entry = base_entry(entry_id, f"进度案例 {minute + 1}", "共享提示词", "content:prompt:image", minute)
    asset_id = f"{entry_id}-image"
    entry["mediaAssets"] = [{
        "id": asset_id,
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
    }]
    entry["primaryMediaId"] = asset_id
    return entry


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), HangingVisionHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    entries = [image_entry("progress-a", 0), image_entry("progress-b", 1)]

    providers = {
        "custom-media": {
            "endpoint": f"{origin}/v1/responses",
            "protocol": "responses",
            "apiKey": "fixture-key",
            "consent": True,
            "models": {"imageAnalysis": "local-progress-vision"},
        },
    }
    assignments = {
        "imageAnalysis": {"providerId": "custom-media", "model": "local-progress-vision"},
    }

    try:
        with extension_session("prompt-director-vision-progress-", viewport={"width": 390, "height": 844}) as session:
            setup = session.open_page("collector.html")
            setup.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
            session.seed_storage(setup, {
                "schemaVersion": 25,
                "entries": entries,
                **ai_configuration_fixture(providers=providers, assignments=assignments),
            })
            setup.evaluate(
                """async ({entries, png}) => {
                  const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
                  const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
                  for (const [index, entry] of entries.entries()) {
                    await saveMediaBlob(entry.primaryMediaId, new Blob([
                      bytes,
                      new TextEncoder().encode(`progress-${index}`)
                    ], {type: 'image/png'}), {checkCapacity: false});
                  }
                }""",
                {"entries": entries, "png": PNG_BASE64},
            )

            library = session.open_page("library.html", wait_until="networkidle")
            library.locator("#select-cases").click()
            library.locator("#selection-select-filtered").click()
            library.locator("#selection-more-menu > summary").click()
            library.locator("#selection-analyze").click()
            dialog = library.locator("#vision-batch-dialog")
            dialog.locator("#vision-batch-start").click()

            assert HangingVisionHandler.request_started.wait(timeout=5), "本地图片服务没有收到请求"
            expect(dialog.locator("#vision-batch-summary")).to_contain_text("2 处理中", timeout=5_000)
            expect(dialog.locator("#vision-batch-summary")).to_contain_text("0 等待中")
            running_progress = dialog.locator("#vision-batch-progress-bar").evaluate(
                "element => ({value: element.value, max: element.max})"
            )
            assert running_progress == {"value": 0, "max": 2}, running_progress
            layout = library.evaluate(
                """() => {
                  const dialog = document.querySelector('#vision-batch-dialog');
                  const rect = dialog.getBoundingClientRect();
                  return {
                    viewportWidth: window.innerWidth,
                    documentWidth: document.documentElement.scrollWidth,
                    dialogLeft: rect.left,
                    dialogRight: rect.right,
                  };
                }"""
            )
            assert layout["documentWidth"] <= layout["viewportWidth"], layout
            assert layout["dialogLeft"] >= 0 and layout["dialogRight"] <= layout["viewportWidth"], layout

            HangingVisionHandler.release_requests.set()
            expect(dialog.locator("#vision-batch-summary")).to_contain_text("2/2 已完成", timeout=10_000)
            completed_progress = dialog.locator("#vision-batch-progress-bar").evaluate(
                "element => ({value: element.value, max: element.max})"
            )
            assert completed_progress == {"value": 2, "max": 2}, completed_progress
            print({"in_flight_progress_visible": True, "completed": 2, "narrowViewport": layout})
    finally:
        HangingVisionHandler.release_requests.set()
        server.shutdown()


if __name__ == "__main__":
    main()
