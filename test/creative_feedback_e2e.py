from __future__ import annotations

import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


EXTENSION_DIR = Path(__file__).resolve().parents[1]


def main() -> None:
    screenshots = Path(tempfile.gettempdir())
    with tempfile.TemporaryDirectory(prefix="prompt-director-feedback-") as profile_dir:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile_dir,
                headless=True,
                channel="chromium",
                viewport={"width": 390, "height": 844},
                permissions=["clipboard-read", "clipboard-write"],
                args=[
                    f"--disable-extensions-except={EXTENSION_DIR}",
                    f"--load-extension={EXTENSION_DIR}",
                ],
            )
            try:
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                extension_id = worker.url.split("/")[2]
                setup = context.new_page()
                setup.goto(f"chrome-extension://{extension_id}/collector.html")
                setup.evaluate(
                    """async () => {
                      await chrome.storage.local.clear();
                      await chrome.storage.local.set({
                        schemaVersion: 13,
                        composerSessions: [{
                          id: 'session-one',
                          title: '电影猫海报',
                          targetType: 'image',
                          targetPlatform: 'ChatGPT',
                          outputLanguage: 'zh-CN',
                          referenceSnapshots: [],
                          messages: [
                            {id: 'message-user', role: 'user', type: 'request', content: '生成一张电影感猫海报', createdAt: '2026-07-24T10:00:00.000Z'},
                            {id: 'message-prompt', role: 'assistant', type: 'prompt', content: '电影感猫海报提示词', createdAt: '2026-07-24T10:01:00.000Z'}
                          ],
                          promptVersions: [{
                            id: 'prompt-one',
                            text: '电影感猫海报提示词',
                            title: '电影猫海报',
                            methodVersion: '1.1.0',
                            outputLanguage: 'zh-CN',
                            createdAt: '2026-07-24T10:01:00.000Z'
                          }],
                          createdAt: '2026-07-24T10:00:00.000Z',
                          updatedAt: '2026-07-24T10:01:00.000Z'
                        }]
                      });
                    }"""
                )

                composer = context.new_page()
                composer.goto(f"chrome-extension://{extension_id}/composer.html?session=session-one")
                composer.wait_for_load_state("networkidle")
                copy_button = composer.locator(".composer-message.prompt").get_by_role("button", name="复制")
                expect(copy_button).to_be_visible()
                copy_button.click()
                expect(composer.locator("#composer-feedback")).to_contain_text("已复制")
                copied_state = composer.evaluate("""async () => chrome.storage.local.get('activeCreativeResult')""")
                assert copied_state.get("activeCreativeResult") is None

                collector = context.new_page()
                collector.goto(f"chrome-extension://{extension_id}/collector.html")
                collector.wait_for_load_state("networkidle")
                expect(collector.locator("#result-start")).to_be_hidden()
                expect(collector.locator("#normal-start")).to_be_visible()
                expect(collector.locator("#normal-start .start-copy")).to_have_count(0)
                expect(collector.locator("#start-smart-visuals")).to_have_text("智能选图")
                expect(collector.locator("#start-selection")).to_have_text("提取文字/图片")
                expect(collector.locator("#start-screenshot")).to_have_text("框选截图")
                normal_geometry = collector.evaluate(
                    """() => {
                      const smart = document.querySelector('#start-smart-visuals').getBoundingClientRect();
                      const text = document.querySelector('#start-selection').getBoundingClientRect();
                      const backup = document.querySelector('#start-screenshot').getBoundingClientRect();
                      return {
                        pageWidth: document.documentElement.scrollWidth,
                        smart: {height: smart.height, top: smart.top, right: smart.right},
                        text: {height: text.height, top: text.top, right: text.right},
                        backup: {height: backup.height, right: backup.right},
                      };
                    }"""
                )
                assert normal_geometry["pageWidth"] == 390
                assert normal_geometry["smart"]["height"] == 52
                assert normal_geometry["text"]["height"] == 52
                assert normal_geometry["smart"]["top"] == normal_geometry["text"]["top"]
                assert normal_geometry["backup"]["height"] == 30, normal_geometry
                assert max(normal_geometry[key]["right"] for key in ("smart", "text", "backup")) <= 390
                collector.screenshot(path=str(screenshots / "promptdirector-step5-collector-normal.png"), full_page=True)

                add_result_button = composer.locator(".composer-message.prompt").get_by_role("button", name="添加生成图片")
                expect(add_result_button).to_be_visible()
                add_result_button.click()
                expect(composer.locator("#composer-feedback")).to_contain_text("已打开侧边栏")

                expect(collector.locator("#result-start")).to_be_visible()
                expect(collector.locator("#normal-start")).to_be_hidden()
                expect(collector.locator("#result-prompt-title")).to_have_text("电影猫海报")
                expect(collector.locator("#result-smart-visuals")).to_have_text("选择图片")
                expect(collector.locator("#result-screenshot")).to_have_text("框选")
                expect(collector.locator("#result-start .capture-actions small")).to_have_count(0)
                result_geometry = collector.evaluate(
                    """() => {
                      const actions = [...document.querySelectorAll('#result-start .capture-actions button')]
                        .map((button) => {
                          const box = button.getBoundingClientRect();
                          return {height: box.height, right: box.right};
                        });
                      return {pageWidth: document.documentElement.scrollWidth, actions};
                    }"""
                )
                assert result_geometry["pageWidth"] == 390
                assert len(result_geometry["actions"]) == 2
                assert all(action["height"] == 52 and action["right"] <= 390 for action in result_geometry["actions"])
                collector.screenshot(path=str(screenshots / "promptdirector-step5-collector-result.png"), full_page=True)

                response = collector.evaluate(
                    """async () => {
                      const visualId = 'creative-result-one';
                      const imageStore = await import(chrome.runtime.getURL('image-store.js'));
                      await imageStore.saveScreenshotBlob(
                        visualId,
                        new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], {type: 'image/png'})
                      );
                      await chrome.storage.local.set({
                        captureDraft: {
                          version: 1,
                          id: 'draft-one',
                          fragments: [],
                          visuals: [{
                            id: visualId,
                            sourceUrl: 'https://example.com/create',
                            sourceTitle: 'Generated result',
                            capturedAt: '2026-07-24T10:05:00.000Z',
                            width: 1024,
                            height: 1536,
                            mimeType: 'image/png',
                            byteSize: 8
                          }],
                          primaryVisualId: visualId,
                          createdAt: '2026-07-24T10:05:00.000Z',
                          updatedAt: '2026-07-24T10:05:00.000Z'
                        }
                      });
                      return chrome.runtime.sendMessage({type: 'COMMIT_CREATIVE_OUTPUTS'});
                    }"""
                )
                assert response["ok"] is True
                assert response["autoAnalyze"] is False

                composer.reload()
                expect(composer.locator(".composer-result-card")).to_have_count(1)
                expect(composer.locator(".composer-result-card")).to_contain_text("本次生成结果")
                composer.locator(".composer-result-card").get_by_role("button", name="保存到灵感库").click()
                expect(composer.locator("#composer-feedback")).to_contain_text("灵感库")
                stored = composer.evaluate("""async () => chrome.storage.local.get(['entries', 'creativeRuns'])""")
                assert len(stored["entries"]) == 1
                assert stored["entries"][0]["creationMeta"]["promptVersionId"] == "prompt-one"
                assert len(stored["creativeRuns"]) == 1
                assert "evaluation" not in stored["creativeRuns"][0]["outputs"][0]
            finally:
                context.close()


if __name__ == "__main__":
    main()
