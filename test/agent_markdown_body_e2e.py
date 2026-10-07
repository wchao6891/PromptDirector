"""Disposable library: existing MCP Markdown body reads and edits losslessly."""
from pathlib import Path
import json
import sys
from playwright.sync_api import expect
from e2e_support import extension_session


def main():
    text = "# 白模方法\n\n## 核心方法\n\n**先锁定空间**，再做镜头。\n\n| 步骤 | 目标 |\n| --- | --- |\n| 白模 | 空间 |\n\n- 保留原件\n- 保留来源\n\n[来源](https://example.com/)\n\n```js\n    keep();\n```"
    with extension_session("pd-markdown-body-") as run:
        page = run.open_page("library.html")
        entry = {"id": "md-body", "title": "白模创作方法", "text": text, "textRevision": 1,
                 "savedAt": "2026-10-02T00:00:00Z", "primaryMediaId": "md-original",
                 "agentProvenance": {"kind": "creation", "sources": []},
                 "mediaAssets": [{"id": "md-original", "kind": "document", "mimeType": "text/markdown", "storageMode": "managed", "sourceTitle": "方法.md"}],
                 "articleDocument": {"version": 1, "blocks": [
                     {"id": "body", "kind": "paragraph", "text": text, "sourceOrder": 0},
                     {"id": "file", "kind": "document", "assetId": "md-original", "sourceOrder": 1}]}}
        run.seed_storage(page, {"entries": [entry]})
        page.evaluate("""async text => { const {saveMediaBlob} = await import('./media-store.js');
          await saveMediaBlob('md-original', new Blob([text], {type:'text/markdown'})); }""", text)
        page.goto(f"chrome-extension://{run.extension_id}/library.html?case=md-body")
        reader = page.locator(".article-document-reader")
        expect(reader.locator("h1")).to_have_text("白模方法")
        expect(reader.locator("table")).to_contain_text("白模")
        expect(reader.locator("strong").first).to_have_text("先锁定空间")
        expect(reader.locator("ul li")).to_have_count(2)
        expect(reader.get_by_role("link", name="来源")).to_have_attribute("href", "https://example.com/")
        stored = page.evaluate("async()=> (await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries[0]")
        original_text = stored["articleDocument"]["blocks"][0]["text"]
        reader.get_by_role("button", name="编辑正文", exact=True).click()
        editor = reader.get_by_role("textbox", name="编辑正文段落")
        expect(editor).to_have_value(original_text)
        editor.fill("## 不应保存的临时修改")
        reader.get_by_role("button", name="取消", exact=True).click()
        expect(reader.locator("h1")).to_have_text("白模方法")
        assert page.evaluate("async()=> (await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries[0].text") == stored["text"]
        reader.get_by_role("button", name="编辑正文", exact=True).click()
        updated_text = text.replace("# 白模方法", "# 白模方法修订")
        reader.get_by_role("textbox", name="编辑正文段落").fill(updated_text)
        reader.get_by_role("button", name="保存", exact=True).click()
        expect(reader.locator("h1")).to_have_text("白模方法修订")
        page.reload()
        page.locator('.case-card').filter(has_text='白模创作方法').click()
        expect(reader.locator("h1")).to_have_text("白模方法修订")
        saved = page.evaluate("async()=> (await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries[0]")
        assert saved["text"] == updated_text, {"saved": saved["text"], "expected": updated_text, "block": saved["articleDocument"]["blocks"][0]}
        assert saved["articleDocument"]["blocks"][0]["mimeType"] == "text/markdown"
        assert saved["mediaAssets"] == stored["mediaAssets"]
        assert page.evaluate("async()=> {const {getMediaBlob}=await import('./media-store.js');return (await getMediaBlob('md-original')).text()}") == text
        # The same shared renderer handles future explicitly typed bodies, and
        # a Markdown-looking plain-text paragraph remains literal.
        result = page.evaluate("""async () => {
          const {renderArticleBlockText} = await import('./article-text-view.js');
          const node = document.createElement('div');
          renderArticleBlockText(node, {kind:'paragraph', mimeType:'text/plain', text:'## literal'});
          const plain = node.textContent === '## literal' && !node.querySelector('h2');
          renderArticleBlockText(node, {kind:'paragraph', mimeType:'text/markdown', text:'## rendered'});
          return {plain, markdown:node.querySelector('h2')?.textContent === 'rendered'};
        }""")
        assert result == {"plain": True, "markdown": True}, result
        if len(sys.argv) > 1:
            # Optional actual method file is displayed only in the isolated fixture.
            real_text = Path(sys.argv[1]).read_text()
            reader.get_by_role("button", name="编辑正文", exact=True).click()
            reader.get_by_role("textbox", name="编辑正文段落").fill(real_text)
            reader.get_by_role("button", name="保存", exact=True).click()
            expect(reader.locator("table")).to_have_count(3)
            expect(reader.locator("h1")).to_contain_text("白模创作方法")
        output = Path(__file__).resolve().parents[1] / 'output/playwright'
        output.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(output / 'markdown-body.png'))
        assert not run.page_errors, run.page_errors
        print(json.dumps({"headings_tables_lists_links": True, "cancel_preserves_text": True,
                          "edit_reload_preserves_markdown": True, "original_attachment_unchanged": True,
                          "plain_text_stays_literal": True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
