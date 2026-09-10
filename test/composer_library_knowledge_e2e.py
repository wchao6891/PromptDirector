from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import expect

from composer_e2e_support import composer_request_payload
from e2e_support import ai_configuration_fixture, base_entry, extension_session, wait_for_async_condition


def main() -> None:
    notes = base_entry("notes", "策划笔记", "雾夜角色的服饰使用银色披风。" + "短片段。" * 70 + "仅正文尾部可见", "content:unclassified")
    guide = base_entry("guide", "布光教程", "雾夜角色先确定轮廓光。", "content:tutorial")
    guide["mediaAssets"] = [{"id":"guide-cover", "kind":"image", "usage":"content", "storageMode":"managed", "mimeType":"image/png"}]
    document = base_entry("document", "导演文档", "资料导言", "content:reference")
    document["mediaAssets"] = [{"id": "director-document", "kind": "document", "usage": "content",
                                "storageMode": "managed", "mimeType": "text/plain", "byteSize": 60}]
    unrelated = base_entry("unrelated", "田园资料", "晴天里的白色建筑。", "content:prompt:image")
    empty = base_entry("empty", "尚无正文资料", "", "content:unclassified")
    with extension_session("prompt-director-library-knowledge-") as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [notes, guide, document, unrelated, empty],
            **ai_configuration_fixture(providers={"deepseek": {
                "apiKey": "isolated-test-key", "consent": True,
                "models": {"creativePlanning": "deepseek-v4-flash"}
            }}, assignments={"creativePlanning": {"providerId": "deepseek", "model": "deepseek-v4-flash"}}),
        })
        setup.evaluate("""async () => {
          const {saveDerivedMedia, saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
          await saveMediaBlob('guide-cover', new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], {type:'image/png'}));
          await saveDerivedMedia('director-document', {searchText: '雾夜角色的镜头采用低机位，让披风形成对角线。'});
        }""")
        page = run.open_page("composer.html")
        requests = []

        mode = "ordinary"

        def reply(route):
            request = route.request.post_data_json
            requests.append(request)
            tool_results = [message for message in request["messages"] if message["role"] == "tool"]
            delta = {"content": '{"route":"compose","status":"ready"}\n雾夜角色的银色披风在轮廓光下展开。'}
            finish = "stop"
            if mode in ["search", "read"] and not tool_results:
                assert {"search_cases", "read_case_text", "use_case_images", "get_plugin_help", "draft_skill"} <= {tool["function"]["name"] for tool in request.get("tools", [])}, request
                delta = {"tool_calls": [{"index": 0, "id": "search-1", "type": "function", "function": {
                    "name": "search_cases", "arguments": json.dumps({"query": "雾夜"})}}]}
                finish = "tool_calls"
            elif mode == "read" and len(tool_results) == 1:
                delta = {"tool_calls": [{"index": 0, "id": "read-1", "type": "function", "function": {
                    "name": "read_case_text", "arguments": json.dumps({"caseId": "document", "part": "document", "offset": 0, "length": 200})}}]}
                finish = "tool_calls"
            route.fulfill(status=200, content_type="text/event-stream", body=(
                "data: " + json.dumps({"model": "deepseek-v4-flash", "choices": [{
                    "delta": delta, "finish_reason": finish
                }]}, ensure_ascii=False) + "\n\ndata: [DONE]\n\n"
            ))

        page.route("https://api.deepseek.com/**", reply)
        toggle = page.locator("#composer-library-search")
        expect(toggle).to_have_attribute("aria-pressed", "true")
        expect(page.locator("#composer-reference-count")).to_have_text("0")

        def send(instruction, expected_requests=1):
            before = len(requests)
            messages_before = page.locator(".composer-message.prompt").count()
            page.locator("#composer-instruction").fill(instruction)
            page.locator("#composer-action").click()
            expect(page.locator(".composer-message.prompt")).to_have_count(messages_before + 1)
            wait_for_async_condition(page, """async () => {
              const sessionId = new URL(location.href).searchParams.get('session');
              const {session} = await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION', sessionId});
              return session && !session.activeTurn;
            }""")
            assert len(requests) == before + expected_requests, requests[before:]
            return composer_request_payload(requests[before])

        payload = send("写一个雾夜角色")
        assert not payload["retrievedSources"] and not payload["libraryCandidates"], payload
        assert "仅正文尾部可见" not in json.dumps(requests[-1], ensure_ascii=False)
        expect(page.locator(".composer-tool-event")).to_have_count(0)
        mode = "search"
        send("找一下我收藏的雾夜案例", 2)
        search_result = json.loads(requests[-1]["messages"][-1]["content"])
        assert search_result["total"] == 3, search_result
        assert len(search_result["candidates"]) == 3
        assert "仅正文尾部可见" not in json.dumps(requests[-1], ensure_ascii=False)
        assert "image_url" not in json.dumps(requests[-1])
        expect(page.locator("#composer-timeline .composer-library-candidate")).to_have_count(3)
        expect(page.locator(".composer-input-area .composer-library-candidate")).to_have_count(0)
        expect(page.locator("#composer-reference-count")).to_have_text("0")
        cover = page.locator('.composer-library-candidate img').first
        expect(cover).to_be_visible()
        expect(cover).to_have_js_property('complete', True)
        assert cover.evaluate('node => node.naturalWidth') > 0
        assert 'data:image' not in json.dumps(requests[-1]) and 'blob:' not in json.dumps(requests[-1])
        expect(page.locator(".composer-retrieved-source")).to_have_count(0)
        expect(page.locator("#composer-send-note")).to_contain_text("本轮已请求 2 次")
        expect(page.locator("#composer-send-note")).to_contain_text("用量未知")
        mode = "read"
        send("参考案例库的雾夜导演文档写一个场景", 3)
        read_result = json.loads(requests[-1]["messages"][-1]["content"])
        assert "低机位" in read_result["text"], read_result
        assert "仅正文尾部可见" not in json.dumps(requests[-1], ensure_ascii=False)
        expect(page.locator("#composer-timeline .composer-retrieved-source")).to_have_count(1)
        expect(page.locator("#composer-reference-count")).to_have_text("0")
        expect(page.locator("#composer-timeline .composer-library-candidate")).to_have_count(6)
        expect(page.locator(".composer-tool-event.completed")).to_have_count(3)
        expect(page.locator("#composer-send-note")).to_contain_text("本轮已请求 3 次")
        artifact_dir = os.environ.get("PROMPTDIRECTOR_E2E_ARTIFACT_DIR")
        if artifact_dir:
            Path(artifact_dir).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(artifact_dir) / "composer-library-tools.png"), full_page=True)
        mode = "ordinary"
        payload = send("缩短一点")
        assert not payload["retrievedSources"], payload
        expect(page.locator(".composer-tool-event.completed")).to_have_count(3)

        toggle.click()
        expect(toggle).to_have_attribute("aria-pressed", "false")
        wait_for_async_condition(page, """async () => {
          const sessionId = new URL(location.href).searchParams.get('session');
          const {session} = await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION', sessionId});
          return session?.libraryRetrievalEnabled === false;
        }""")
        page.reload()
        expect(toggle).to_have_attribute("aria-pressed", "false")
        expect(page.locator("#composer-timeline .composer-library-candidate")).to_have_count(6)
        payload = send("继续完善雾夜角色")
        assert payload["retrievedSources"] == [], payload

        page.locator("#composer-reference-open").click()
        expect(page.locator(".composer-case-option")).to_have_count(5)
        expect(page.locator('.composer-case-option[data-entry-id="empty"] input')).to_be_disabled()
        for entry_id in ["notes", "document"]:
            page.locator(f'.composer-case-option[data-entry-id="{entry_id}"] > input').check()
        if artifact_dir:
            page.screenshot(path=str(Path(artifact_dir) / "composer-text-document-picker.png"), full_page=True)
        page.locator("#composer-reference-apply").click()
        expect(page.locator("#composer-reference-count")).to_have_text("2")
        session = page.evaluate("""async () => {
          const sessionId = new URL(location.href).searchParams.get('session');
          return (await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION', sessionId})).session;
        }""")
        references = session["referenceSnapshots"]
        assert {item["entryId"] for item in references} == {"notes", "document"}, references
        text = json.dumps(references, ensure_ascii=False)
        assert "资料导言" in text and "低机位" in text and "银色披风" in text, references
        assert all(not item.get("imageRefs") for item in references), references
        payload = send("结合这两项文字参考继续创作")
        sent = json.dumps(payload["references"], ensure_ascii=False)
        assert "资料导言" in sent and "低机位" in sent and "银色披风" in sent, payload
        assert not run.page_errors, run.page_errors
        print("PASS: native search/read loop, ordinary zero search, bounded previews, zero automatic images, actual request counts, missing usage, persisted off, document selection")


if __name__ == "__main__":
    main()
