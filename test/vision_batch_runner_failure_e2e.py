from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import ai_configuration_fixture, base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def main() -> None:
    entry = base_entry("runner-failure", "启动失败案例", "共享提示词", "content:prompt:image")
    entry["mediaAssets"] = [{
        "id": "runner-failure-image",
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
    }]
    entry["primaryMediaId"] = "runner-failure-image"
    providers = {
        "custom-media": {
            "endpoint": "https://fixture.invalid/v1/responses",
            "protocol": "responses",
            "apiKey": "fixture-key",
            "consent": True,
            "models": {"imageAnalysis": "current-model"},
        },
    }
    assignments = {
        "imageAnalysis": {"providerId": "custom-media", "model": "current-model"},
    }

    with extension_session("prompt-director-vision-runner-failure-", viewport={"width": 1280, "height": 800}) as session:
        session.context.route(
            "https://fixture.invalid/**",
            lambda route: route.fulfill(
                status=500,
                content_type="application/json",
                body='{"error":{"message":"fixture vision failure"}}',
            ),
        )
        setup = session.open_page("collector.html")
        setup.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        session.seed_storage(setup, {
            "schemaVersion": 25,
            "entries": [entry],
            **ai_configuration_fixture(providers=providers, assignments=assignments),
        })
        setup.evaluate(
            """async ({entry, png}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              await saveMediaBlob(entry.mediaAssets[0].id, new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
            }""",
            {"entry": entry, "png": PNG_BASE64},
        )
        setup.evaluate(
            """async () => {
              const {createVisionBatchJob} = await import(chrome.runtime.getURL('analysis-batch.js'));
              const stored = await chrome.storage.local.get('entries');
              const job = createVisionBatchJob(stored.entries, {
                id: 'runner-failure-job',
                entryIds: ['runner-failure'],
                providerType: 'compatible',
                providerId: 'custom-media',
                model: 'current-model',
                now: '2026-08-26T00:00:00.000Z'
              });
              await chrome.storage.local.set({batchJob: job});
            }"""
        )

        library = session.open_page("library.html", wait_until="networkidle")
        library.locator("#select-cases").click()
        library.locator("#selection-select-filtered").click()
        library.locator("#selection-more-menu > summary").click()
        library.locator("#selection-analyze").click()
        dialog = library.locator("#vision-batch-dialog")
        expect(dialog.locator("#vision-batch-summary")).to_contain_text("1 等待中")

        library.evaluate(
            "() => chrome.alarms.create('prompt-director-analysis-batch', {when: Date.now() + 50})"
        )
        expect(dialog.locator("#vision-batch-feedback")).to_contain_text("图片分析服务暂时不可用", timeout=15_000)
        expect(dialog.locator("#vision-batch-retry")).to_be_visible(timeout=15_000)
        expect(dialog.locator("#vision-batch-pause")).to_be_hidden(timeout=15_000)

        print({"runner_failure_visible": True, "retry_available": True})


if __name__ == "__main__":
    main()
