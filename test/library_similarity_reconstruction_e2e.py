from __future__ import annotations

from playwright.sync_api import expect
from e2e_support import base_entry, extension_session


def video(entry_id: str, original: str = "") -> dict:
    entry = base_entry(entry_id, entry_id, original, "content:prompt:video")
    entry["sourceFacts"] = {"originalPromptAvailable": bool(original)}
    entry["mediaAssets"] = [{"id": f"{entry_id}-video", "kind": "video", "usage": "content",
                             "storageMode": "managed", "mimeType": "video/mp4", "playbackCapability": "external"}]
    entry["primaryMediaId"] = f"{entry_id}-video"
    return entry


def main() -> None:
    current = video("current")
    current["videoAnalyses"] = [{"id": "analysis", "assetId": current["primaryMediaId"],
        "mode": "visual-reconstruction", "reconstructionPrompt": "copper robot city",
        "requestId": "request", "contractVersion": "test", "analysisScope": "video",
        "includeTags": False, "tags": [], "uncertainties": [], "finishReason": "stop",
        "createdAt": "2026-09-27T00:00:00Z"}]
    with extension_session("prompt-director-similarity-reconstruction-") as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {"schemaVersion": 25, "entries": [current, video("robot", "copper robot city"), video("ocean", "ocean coral")],
                                     "uiPreferences": {"locale": "zh-CN", "motion": "reduced"}})
        library = session.open_page("library.html", wait_until="networkidle")
        library.locator('#case-list > .case-card[data-entry-id="current"]').click()
        cards = library.locator('.local-discovery-item')
        expect(cards).to_have_count(1)
        expect(cards.first).to_have_attribute('aria-label', '查看相似案例：robot；提示词参考')
        # Edit through the real save path; the open detail must update without reopening it.
        library.get_by_role('button', name='编辑 AI 逆推提示词', exact=True).click()
        editor = library.locator('textarea.prompt-editor:visible')
        editor.fill('ocean coral')
        library.locator('.prompt-edit-actions:visible').get_by_role('button', name='保存', exact=True).click()
        expect(editor).not_to_be_visible()
        expect(cards).to_have_count(1)
        expect(cards.first).to_have_attribute('aria-label', '查看相似案例：ocean；提示词参考')
        for prompt, count in [("glacier mountain", 0), ("ocean coral", 1)]:
            response = library.evaluate("""async ({prompt}) => {
                const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
                const entry = state.entries.find(item => item.id === 'ocean');
                return chrome.runtime.sendMessage({type: 'UPDATE_ENTRY_TEXT', entryId: entry.id,
                    text: prompt, textRevision: entry.textRevision ?? 1});
            }""", {"prompt": prompt})
            assert response["ok"], response
            expect(cards).to_have_count(count)
        expect(cards.first).to_have_attribute('aria-label', '查看相似案例：ocean；提示词参考')
        print({'reconstruction_only_video_match': True, 'saved_edit_refreshes_open_recommendations': True,
               'candidate_edit_removes_and_restores_section': True})


if __name__ == '__main__':
    main()
