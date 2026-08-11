from __future__ import annotations

import base64
from playwright.sync_api import expect

from e2e_support import extension_session


GENERATED_MP4 = base64.b64decode(
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAN0bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAMgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAp90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAADIAAAEAAABAAAAAAIXbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABwm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAYJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAHZIAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAFAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAOGN0dHMAAAAAAAAABQAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAUAAAABAAAAKHN0c3oAAAAAAAAAAAAAAAUAAALFAAAADAAAAAwAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAAOkAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2Mi4zLjEwMAAAAAhmcmVlAAAC/W1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhaz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEADP//vbsvgU2FMjBAAAACEGaJGxCv/7AAAAACEGeQniF/8GBAAAACAGeYXRCv8SAAAAACAGeY2pCv8SB"
)


def main() -> None:
    with extension_session("prompt-director-video-", viewport={"width": 1280, "height": 900}) as session:
        setup = session.open_page("collector.html")
        session.seed_storage(
            setup,
            {
                "schemaVersion": 24,
                "entries": [],
                "creativeExperimentSettings": {"enabled": True, "autoAnalyze": False},
                "visionSettings": {
                    "activeProvider": "openai",
                    "consent": True,
                    "openai": {
                        "apiKey": "video-e2e-key",
                        "model": "gpt-5-mini",
                        "videoGeneration": {
                            "model": "account-video-model",
                            "sizes": ["1280x720", "720x1280"],
                            "durations": ["4", "8"],
                        },
                    },
                },
            },
        )
        setup.evaluate(
            """async ({videoBase64}) => {
              const {createComposerSession} = await import(chrome.runtime.getURL('composer.js'));
              const {createCreativeRun} = await import(chrome.runtime.getURL('creative-runs.js'));
              const {saveDerivedMedia, saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
              const capturedAt = '2026-08-08T10:00:00.000Z';
              const visual = {
                id: 'video-result-e2e', kind: 'video', usage: 'content', storageMode: 'managed',
                mimeType: 'video/mp4', byteSize: decode(videoBase64).byteLength,
                width: 16, height: 16, durationMs: 200, posterAssetId: 'poster:video-result-e2e',
                capturedAt, reviewStatus: 'unverified'
              };
              const session = createComposerSession({
                id: 'video-session-e2e', title: '视频快速验证', targetType: 'video', outputMode: 'create_video',
                aiProfile: {serviceId: 'openai', model: 'gpt-5-mini'},
                generationParameters: {duration: '4', resolution: '1280x720'},
                messages: [
                  {id: 'video-user-e2e', role: 'user', type: 'request', content: '生成四秒的稳定镜头'},
                  {id: 'video-assistant-e2e', role: 'assistant', type: 'prompt', content: '一个黑色方块保持稳定，镜头无移动。', route: 'compose', routeSource: 'manual'}
                ],
                promptVersions: [{
                  id: 'video-prompt-e2e', text: '一个黑色方块保持稳定，镜头无移动。', title: '视频快速验证',
                  methodVersion: '1.2.0', outputLanguage: 'zh-CN', productionReviewEnabled: true,
                  createdAt: '2026-08-08T09:59:00.000Z'
                }]
              });
              const videoBlob = new Blob([decode(videoBase64)], {type: 'video/mp4'});
              const png = decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
              await saveMediaBlob(visual.id, videoBlob, {checkCapacity: false});
              await saveDerivedMedia(visual.id, {thumbnail: new Blob([png], {type: 'image/png'})});
              const run = createCreativeRun(
                {sessionId: session.id, promptVersionId: 'video-prompt-e2e'},
                session,
                [visual],
                capturedAt,
                {serviceId: 'openai', requestModel: 'account-video-model', requestParameters: {size: '1280x720', duration: '4'}}
              );
              await chrome.storage.local.set({composerSessions: [session], creativeRuns: [run]});
            }""",
            {"videoBase64": base64.b64encode(GENERATED_MP4).decode()},
        )

        composer = session.open_page("composer.html?session=video-session-e2e")

        video = composer.locator(".composer-result-video")
        expect(video).to_be_visible(timeout=15_000)
        expect(composer.get_by_role("button", name="保存到灵感库", exact=True)).to_be_visible()
        composer.locator(".composer-result-judgment > summary").click()
        composer.get_by_label("值得保留").fill("保留稳定构图")
        composer.get_by_label("需要改进").fill("增加主体动作")
        composer.get_by_role("button", name="保存判断", exact=True).click()
        expect(composer.locator(".composer-result-judgment-feedback")).to_have_text("本次人工判断已保存")
        composer.get_by_label("值得保留").fill("保留稳定构图和节奏")
        composer.get_by_role("button", name="保存修改", exact=True).click()
        composer.wait_for_function(
            """() => chrome.storage.local.get('creativeRuns').then(value =>
              value.creativeRuns?.[0]?.outputs?.[0]?.judgment?.keep === '保留稳定构图和节奏'
            )"""
        )
        judgment = composer.evaluate(
            "() => chrome.storage.local.get('creativeRuns').then(value => value.creativeRuns[0].outputs[0].judgment)"
        )
        assert judgment["keep"] == "保留稳定构图和节奏" and judgment["improve"] == "增加主体动作", judgment
        composer.get_by_role("button", name="清空", exact=True).click()
        expect(composer.locator(".composer-result-judgment-feedback")).to_have_text("本次人工判断已清空")
        assert composer.evaluate(
            "() => chrome.storage.local.get('creativeRuns').then(value => value.creativeRuns[0].outputs[0].judgment)"
        ) is None
        state = composer.evaluate(
            """async () => {
              const stored = await chrome.storage.local.get(['creativeRuns']);
              const output = stored.creativeRuns[0].outputs[0];
              const {getMediaBlob, getDerivedMedia} = await import(chrome.runtime.getURL('media-store.js'));
              const blob = await getMediaBlob(output.visual.id);
              const derived = await getDerivedMedia(output.visual.id);
              return {
                visual: output.visual,
                blobType: blob?.type || '',
                blobSize: blob?.size || 0,
                hasPreview: derived?.thumbnail instanceof Blob,
              };
            }"""
        )
        assert state["blobType"] == "video/mp4" and state["blobSize"] == len(GENERATED_MP4), state
        assert state["hasPreview"] is True, state

        composer.get_by_role("button", name="保存到灵感库", exact=True).click()
        expect(composer.get_by_role("button", name="已保存到灵感库", exact=True)).to_be_visible()
        saved = composer.evaluate(
            """async () => {
              const stored = await chrome.storage.local.get(['entries', 'creativeRuns']);
              const visualId = stored.creativeRuns[0].outputs[0].visual.id;
              return {
                visualId,
                inLibrary: stored.entries.some(entry => (entry.mediaAssets || []).some(asset => asset.id === visualId)),
              };
            }"""
        )
        assert saved["inLibrary"] is True, saved

        composer.get_by_role("button", name="删除", exact=True).click()
        delete_dialog = composer.locator("#promptdirector-app-dialog")
        expect(delete_dialog).to_be_visible()
        delete_dialog.get_by_role("button", name="删除", exact=True).click()
        expect(video).to_have_count(0)
        deleted = composer.evaluate(
            """async (visualId) => {
              const stored = await chrome.storage.local.get(['creativeRuns']);
              const {getMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              return {
                outputCount: stored.creativeRuns[0].outputs.length,
                libraryBlobRetained: (await getMediaBlob(visualId)) instanceof Blob,
              };
            }""",
            saved["visualId"],
        )
        assert deleted == {"outputCount": 0, "libraryBlobRetained": True}, deleted
        print({"video": "previewed-saved-deleted", **deleted})


if __name__ == "__main__":
    main()
