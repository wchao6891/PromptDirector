from __future__ import annotations

import os
from pathlib import Path
from tempfile import mkdtemp

from playwright.sync_api import expect
from e2e_support import base_entry, extension_session

PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def main():
    entries = []
    for kind in ("image", "video"):
        for original in (False, True):
            for ai in (False, True):
                key = f"{kind}-{int(original)}-{int(ai)}"
                entry = base_entry(key, key, "原始提示词内容" if original else "", f"content:prompt:{kind}")
                asset = {"id": f"asset-{key}", "kind": kind, "usage": "content", "storageMode": "managed",
                         "mimeType": "image/png" if kind == "image" else "video/mp4", "contentHash": "a" * 64}
                if ai and kind == "image":
                    asset["visionAnalysis"] = {"version": 2, "imageFingerprint": "a" * 64, "reconstructionPrompt": "AI 图片提示词内容"}
                entry["mediaAssets"] = [asset]
                entry["primaryMediaId"] = asset["id"]
                if ai and kind == "video":
                    entry["videoAnalyses"] = [{"id": f"record-{key}", "assetId": asset["id"], "mode": "visual-reconstruction",
                        "requestId": "offline-fixture", "contractVersion": "reconstruction-tags-json-v4-evidence", "analysisScope": "video",
                        "reconstructionPrompt": "整体设定：\n" + "主体在空间中移动，镜头稳定推进。\n\n" * 40 + "结尾证据。",
                        "includeTags": False, "tags": [], "uncertainties": ["无法读取音轨"], "finishReason": "stop"}]
                entries.append(entry)

    multi = base_entry("multi-image", "多图提示词归属", "案例共享", "content:prompt:image")
    multi["mediaAssets"] = [{"id": f"multi-{i}", "kind": "image", "usage": "content", "storageMode": "managed", "mimeType": "image/png"} for i in range(3)]
    multi["primaryMediaId"] = "multi-0"
    multi["mediaPrompts"] = [{"assetId": "multi-1", "source": "manual", "text": "第二张原始"},
                             {"assetId": "multi-2", "source": "ai-suggestion", "text": "第三张 AI"}]

    evidence = Path(os.environ.get("PROMPTDIRECTOR_LAB_EVIDENCE_DIR") or mkdtemp(prefix="prompt-panels-evidence-"))
    with extension_session("prompt-panels-") as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {"entries": entries + [multi], "uiPreferences": {"locale": "zh-CN", "theme": "light", "motion": "reduced"}})
        setup.evaluate("""async ({entries, png}) => {
          const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          for (const entry of entries) for (const asset of entry.mediaAssets.filter(a => a.kind === 'image')) {
            await saveMediaBlob(asset.id, new Blob([Uint8Array.from(atob(png), x => x.charCodeAt(0))], {type:'image/png'}), {checkCapacity:false});
          }
        }""", {"entries": entries + [multi], "png": PNG})
        page = session.open_page("library.html", wait_until="networkidle")
        for entry in entries:
            kind, original, ai = entry["id"].split("-")
            page.locator(f'.case-card[data-entry-id="{entry["id"]}"]').click()
            section = page.locator(".media-prompt-section")
            expect(section.locator(".original-prompt-panel")).to_have_count(int(original))
            expect(section.locator(f".{kind}-reconstruction-current")).to_have_count(int(ai))
            expect(section.get_by_role("button", name="以此创作", exact=True)).to_have_count(1)
            if ai == "1":
                panel = section.locator(f".{kind}-reconstruction-current")
                expect(panel.get_by_role("button", name="复制提示词", exact=True)).to_be_enabled()
                panel.get_by_role("button", name="复制提示词", exact=True).click()
                copied = page.evaluate("() => navigator.clipboard.readText()")
                expected = entry["videoAnalyses"][0]["reconstructionPrompt"] if kind == "video" else "AI 图片提示词内容"
                assert copied == expected
                expect(panel.get_by_role("button", name="复制提示词", exact=True).locator("svg")).to_have_count(1)
                if kind == "video":
                    body = panel.locator(".prompt-read-body")
                    expect(panel.get_by_role("button", name="展开全文", exact=True)).to_be_visible()
                    assert body.evaluate("e => getComputedStyle(e).overflowY") == "hidden"
                    panel.get_by_role("button", name="展开全文", exact=True).click()
                    assert body.evaluate("e => e.clientHeight >= e.scrollHeight - 1")
                    panel.get_by_role("button", name="收起", exact=True).click()
                    if entry["id"] == "video-0-1":
                        for width, name in ((1280, "desktop"), (390, "sidebar")):
                            page.set_viewport_size({"width": width, "height": 844})
                            panel.locator(".prompt-section-heading").scroll_into_view_if_needed()
                            assert section.evaluate("e => e.scrollWidth <= e.clientWidth")
                            page.screenshot(path=str(evidence / f"prompt-ai-only-long-{name}.png"))
                        page.set_viewport_size({"width": 1280, "height": 844})
                panel.get_by_role("button", name="编辑 AI 逆推提示词", exact=True).click()
                panel.locator("textarea").fill("人工编辑 AI 提示词")
                panel.get_by_role("button", name="保存", exact=True).click()
                expect(panel.locator(".prompt-read-body")).to_have_text("人工编辑 AI 提示词")
                stored = page.evaluate("id => chrome.storage.local.get('entries').then(s => s.entries.find(e => e.id === id))", entry["id"])
                assert stored["text"] == entry["text"], "AI 编辑不能覆盖原始内容"
                rules_action = panel.get_by_role("button", name="编辑分析规则", exact=True)
                rules_action.hover()
                reading_position = page.locator("#detail-content").evaluate("e => e.scrollTop")
                rules_action.click()
                expect(page.locator('[data-settings-tab="rules"]')).to_have_attribute("aria-selected", "true")
                expect(page.locator(f'[data-analysis-kind-panel="{"vision" if kind == "image" else "video"}"]')).to_be_visible()
                if entry["id"] == "video-0-1":
                    page.screenshot(path=str(evidence / "video-rules-settings.png"))
                    rules = page.locator("#video-settings-form")
                    default_method = rules.locator("#video-instructions-zh").input_value()
                    rules.locator("#video-instructions-zh").fill("我的完整视频方法：重点核对空间关系。")
                    rules.get_by_role("button", name="保存分析规则", exact=True).click()
                    page.wait_for_function("() => chrome.storage.local.get('aiPreferences').then(s => s.aiPreferences?.videoInstructionsByLocale?.['zh-CN'] === '我的完整视频方法：重点核对空间关系。')")
                    rules.get_by_role("button", name="恢复默认", exact=True).click()
                    expect(rules.locator("#video-instructions-zh")).to_have_value(default_method)
                    rules.get_by_role("button", name="保存分析规则", exact=True).click()
                    page.wait_for_function("method => chrome.storage.local.get('aiPreferences').then(s => s.aiPreferences?.version === 3 && s.aiPreferences?.videoInstructionsByLocale?.['zh-CN'] === method)", arg=default_method)
                page.get_by_role("button", name="关闭设置", exact=True).click()
                expect(section).to_be_visible()
                expect(rules_action).to_be_focused()
                assert abs(page.locator("#detail-content").evaluate("e => e.scrollTop") - reading_position) <= 1
            if original == "1":
                original_panel = section.locator(".original-prompt-panel")
                original_panel.get_by_role("button", name="编辑原始提示词", exact=True).click()
                original_panel.locator("textarea").fill("不应保存的草稿")
                original_panel.get_by_role("button", name="取消", exact=True).click()
                expect(original_panel.locator(".prompt-read-body")).to_have_text(entry["text"])
                expect(original_panel.get_by_role("button", name="编辑原始提示词", exact=True)).to_be_focused()
                original_panel.get_by_role("button", name="编辑原始提示词", exact=True).click()
                original_panel.locator("textarea").fill("修订原始提示词")
                original_panel.get_by_role("button", name="保存", exact=True).click()
                expect(original_panel.locator(".prompt-read-body")).to_have_text("修订原始提示词")
                if ai == "1":
                    expect(section.locator(f".{kind}-reconstruction-current .prompt-read-body")).to_have_text("人工编辑 AI 提示词")
            else:
                page.locator(".entry-editor-inline > summary").click()
                original_editor = page.locator(".entry-original-panel")
                expect(original_editor.locator("textarea:visible")).to_have_count(0)
                original_editor.get_by_role("button", name="编辑原始提示词", exact=True).click()
                expect(original_editor.locator("textarea:visible")).to_have_count(1)
                original_editor.get_by_role("textbox", name="编辑原始提示词", exact=True).fill("补充原始提示词")
                original_editor.get_by_role("button", name="保存", exact=True).click()
                expect(page.locator(".original-prompt-panel .prompt-read-body")).to_have_text("补充原始提示词")
                page.locator(".entry-editor-inline > summary").click()
            page.get_by_role("button", name="关闭详情", exact=True).click()

        page.locator('.case-card[data-entry-id="multi-image"]').click()
        for index, original in ((0, "案例共享"), (1, "第二张原始"), (2, "案例共享")):
            page.locator(".detail-visual-thumb").nth(index).click()
            expect(page.locator(".original-prompt-panel .prompt-read-body")).to_have_text(original)
            expect(page.locator(".image-reconstruction-current")).to_have_count(1 if index == 2 else 0)
        ai_panel = page.locator(".image-reconstruction-current")
        ai_panel.get_by_role("button", name="编辑 AI 逆推提示词", exact=True).click()
        ai_panel.locator("textarea").fill("第三张 AI 人工修订")
        ai_panel.get_by_role("button", name="保存", exact=True).click()
        expect(ai_panel.locator(".prompt-read-body")).to_have_text("第三张 AI 人工修订")
        stored = page.evaluate("() => chrome.storage.local.get('entries').then(s => s.entries.find(e => e.id === 'multi-image'))")
        assert stored["text"] == "案例共享"
        assert next(p for p in stored["mediaPrompts"] if p["assetId"] == "multi-2")["source"] == "ai-suggestion"
        assert next(p for p in stored["mediaPrompts"] if p["assetId"] == "multi-1")["text"] == "第二张原始"
        page.locator(".entry-editor-inline > summary").click()
        page.get_by_role("combobox", name="提示词范围", exact=True).select_option("multi-2")
        original_editor = page.locator(".entry-original-panel")
        original_editor.get_by_role("button", name="编辑原始提示词", exact=True).click()
        original_editor.get_by_role("textbox", name="编辑原始提示词", exact=True).fill("第三张独立原始")
        original_editor.get_by_role("button", name="保存", exact=True).click()
        expect(page.locator(".original-prompt-panel .prompt-read-body")).to_have_text("第三张独立原始")
        expect(ai_panel.locator(".prompt-read-body")).to_have_text("第三张 AI 人工修订")
        page.locator(".entry-editor-inline > summary").click()
        page.get_by_role("button", name="关闭详情", exact=True).click()

        page.locator('.case-card[data-entry-id="video-1-1"]').click()
        for width, name in ((1280, "desktop"), (390, "sidebar")):
            page.set_viewport_size({"width": width, "height": 844})
            section = page.locator(".media-prompt-section")
            section.scroll_into_view_if_needed()
            assert section.evaluate("e => e.scrollWidth <= e.clientWidth"), name
            assert section.locator(".prompt-read-body").last.evaluate("e => getComputedStyle(e).overflowY") == "hidden"
            page.screenshot(path=str(evidence / f"prompt-panels-{name}.png"))
        print({"promptMatrix": 8, "copyFullText": True, "sourceSafeEditing": True, "rulesShortcut": True, "responsive": True, "evidence": str(evidence)})


if __name__ == "__main__":
    main()
