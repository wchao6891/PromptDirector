from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def main() -> None:
    reconstruction_prompt = "正方形画面；白猫居中，占画面高度约一半；柔和窗光从左侧照入，背景为低饱和蓝灰色。"
    fingerprint = "a" * 64
    entry = base_entry(
        "reconstruction-copy-case",
        "重建提示词复制验收案例",
        "",
        "content:prompt:image",
    )
    entry["mediaAssets"] = [{
        "id": "reconstruction-copy-image",
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "contentHash": fingerprint,
        "capturedAt": "2026-08-09T00:00:00.000Z",
        "reviewStatus": "verified",
        "visionAnalysis": {
            "version": 2,
            "description": "白猫位于正方形画面中央，左侧柔和窗光，蓝灰背景。",
            "reconstructionPrompt": reconstruction_prompt,
            "imageFingerprint": fingerprint,
            "profileFingerprint": "b" * 64,
            "invalidated": False,
        },
    }]
    entry["primaryMediaId"] = "reconstruction-copy-image"

    with extension_session("prompt-director-reconstruction-copy-") as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async ({entry, png}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              await chrome.storage.local.clear();
              await chrome.storage.local.set({
                schemaVersion: 25,
                entries: [entry],
                uiPreferences: {locale: 'zh-CN', theme: 'dark', motion: 'reduced'}
              });
              await saveMediaBlob(entry.primaryMediaId, new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
            }""",
            {"entry": entry, "png": PNG_BASE64},
        )

        library = session.open_page("library.html", wait_until="networkidle")
        library.locator(".case-card").click()
        copy = library.get_by_role("button", name="复制提示词")
        expect(copy).to_be_enabled()
        copy.click()
        copied = library.evaluate("async () => navigator.clipboard.readText()")

        assert copied == reconstruction_prompt, {
            "expected": reconstruction_prompt,
            "actual": copied,
        }
        expect(library.locator(".prompt-text").first).to_have_text(reconstruction_prompt)

        library.get_by_role("button", name="关闭详情").click()
        library.evaluate(
            """async ({entryId, assetId}) => {
              const stored = await chrome.storage.local.get('entries');
              const entry = stored.entries.find(item => item.id === entryId);
              entry.mediaPrompts = [{
                assetId,
                text: '旧版简短分析提示词',
                source: 'ai-suggestion',
                updatedAt: '2026-08-01T00:00:00.000Z'
              }];
              await chrome.storage.local.set({entries: stored.entries});
            }""",
            {"entryId": entry["id"], "assetId": entry["primaryMediaId"]},
        )
        library.reload(wait_until="networkidle")
        library.locator(".case-card").click()
        expect(library.locator(".prompt-text").first).to_have_text("旧版简短分析提示词")
        library.locator(".detail-analysis-menu > summary").click()
        library.get_by_role("button", name="更新为 V2 提示词").click()
        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog).to_contain_text("用户复制、采集、导入或手动编辑的提示词不会被覆盖")
        before_confirm = library.evaluate("() => chrome.storage.local.get('entries').then(value => value.entries[0].mediaPrompts[0].text)")
        assert before_confirm == "旧版简短分析提示词"
        dialog.get_by_role("button", name="确认替换").click()
        expect(dialog).not_to_be_visible()
        expect(library.locator(".prompt-text").first).to_have_text(reconstruction_prompt)

        print({
            "copied": copied,
            "image_only_case_has_one_v2_prompt": True,
            "legacy_ai_prompt_replaced_after_confirmation": True,
        })


if __name__ == "__main__":
    main()
