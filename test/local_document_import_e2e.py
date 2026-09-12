"""Browser acceptance using an explicitly supplied DOCX with text, table and image.

Usage: python3 test/local_document_import_e2e.py /path/to/creative-brief.docx
The fixture must contain the Chinese markers asserted below; it is test data.
"""
import hashlib
import io
import sys
import zipfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session


def main():
    source = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).parent / "fixtures/documents/creative-brief.docx"
    with extension_session("pd-local-documents-") as run:
        page = run.open_page("library.html", wait_until="networkidle")
        page.wait_for_selector("body[data-library-state='ready']")
        if page.locator("#settings-dialog").is_visible():
            page.locator("#settings-close").click()
        # Real DOCX conversion and the reader must agree on one-column tables
        # and literal pipes; keep this synthetic variation separate from user data.
        table_xml = """<w:tbl><w:tr><w:tc><w:p><w:r><w:t>单列标题</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>A|B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"""
        sample = io.BytesIO()
        with zipfile.ZipFile(source) as original_docx, zipfile.ZipFile(sample, "w") as sample_docx:
            for item in original_docx.infolist():
                data = original_docx.read(item.filename)
                if item.filename == "word/document.xml":
                    data = data.replace(b"<w:body>", b"<w:body>" + table_xml.encode(), 1)
                sample_docx.writestr(item, data)
        table_result = page.evaluate("""async bytes => {
          const {ingestLocalDocument} = await import('./document-ingestion.js');
          const {renderMarkdownDocument} = await import('./markdown-renderer.js');
          const parsed = await ingestLocalDocument(new Blob([new Uint8Array(bytes)]), {extension:'docx'});
          const reader = renderMarkdownDocument(parsed.contentText);
          const table = [...reader.querySelectorAll('table')].find(t => t.textContent.includes('单列标题'));
          return {columns: table?.querySelectorAll('th').length, cell: table?.querySelector('td')?.textContent};
        }""", list(sample.getvalue()))
        assert table_result == {"columns": 1, "cell": "A|B"}, table_result
        page.evaluate("() => Object.defineProperty(window, 'showOpenFilePicker', {value: undefined, configurable: true})")
        run.context.set_offline(True)
        page.locator("#add-menu > summary").click()
        page.locator("#add-media").click()
        with page.expect_file_chooser() as chooser:
            page.locator("#import-choose-files").click()
        chooser.value.set_files([
            {"name": source.name, "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "buffer": source.read_bytes()},
            {"name": "archive.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "buffer": b"binary preservation fixture\x00\xff"},
            {"name": "source.psd", "mimeType": "application/octet-stream", "buffer": b"PSD preservation fixture\x00\xff"},
            {"name": "edit.prproj", "mimeType": "application/octet-stream", "buffer": b"Premiere preservation fixture\x00\xff"},
            {"name": "voice.wav", "mimeType": "audio/wav", "buffer": b"RIFF audio preservation fixture"},
            {"name": "broken.docx", "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "buffer": b"broken DOCX fixture"},
        ])
        expect(page.locator("#import-supported-count")).to_have_text("6", timeout=20000)
        assert "提取失败" not in page.locator(".import-file-row").filter(has_text=source.name).inner_text()
        expect(page.locator(".import-file-row").filter(has_text="broken.docx")).to_contain_text("提取失败")
        page.locator("#import-start").click()
        expect(page.locator("#feedback")).to_contain_text("导入完成", timeout=20000)
        page.locator(".case-card").filter(has_text=source.name).click()
        reader = page.locator(".document-text-reader .markdown-reader")
        expect(reader).to_contain_text("文档末尾校验")
        expect(reader.locator("table")).to_contain_text("出发吧")
        expect(reader.locator("img")).to_have_count(1)
        page.wait_for_function("() => [...document.querySelectorAll('.markdown-reader img')].every(i => i.complete && i.naturalWidth > 0)")
        result = page.evaluate("""async () => {
          const {entries} = await chrome.storage.local.get('entries');
          const entry = entries.find(e => e.title.endsWith('.docx') && e.title !== 'broken.docx');
          return {text: entry.text, path: entry.classification.pathIds, warnings: entry.mediaAssets[0].extractionWarnings};
        }""")
        assert result["path"] == ["content:reference"], result
        assert "data:image" not in result["text"], result
        assert "document-image:0" in result["text"], result
        assert result["text"].index("创作目标") < result["text"].index("document-image:0") < result["text"].index("图片后的脚本说明")
        with page.expect_download() as download:
            page.locator(".detail-visual-actions").get_by_role("button", name="下载副本").click()
        assert hashlib.sha256(Path(download.value.path()).read_bytes()).digest() == hashlib.sha256(source.read_bytes()).digest()
        page.locator("#detail-close").click()
        expected = {"archive.xlsx": "content:reference", "source.psd": "content:source-file", "edit.prproj": "content:source-file", "voice.wav": "content:audio", "broken.docx": "content:reference"}
        records = page.evaluate("() => chrome.storage.local.get('entries').then(s => Object.fromEntries(s.entries.map(e => [e.title, e.classification.pathIds[0]])))")
        for name, category in expected.items():
            assert records[name] == category, (name, records)
        for name, original_bytes in {"source.psd": b"PSD preservation fixture\x00\xff", "edit.prproj": b"Premiere preservation fixture\x00\xff"}.items():
            page.locator(".case-card").filter(has_text=name).click()
            with page.expect_download() as source_download:
                page.locator(".detail-visual-actions").get_by_role("button", name="下载副本").click()
            assert Path(source_download.value.path()).read_bytes() == original_bytes
            page.locator("#detail-close").click()
        page.locator(".case-card").filter(has_text="archive.xlsx").click()
        expect(page.locator(".detail-document")).to_contain_text("原文件已保存")
        assert "binary preservation fixture" not in page.locator(".detail-document").inner_text()
        with page.expect_download() as original:
            page.locator(".detail-visual-actions").get_by_role("button", name="下载副本").click()
        assert Path(original.value.path()).read_bytes() == b"binary preservation fixture\x00\xff"
        page.locator("#detail-close").click()
        page.locator(".case-card").filter(has_text="broken.docx").click()
        expect(page.locator(".detail-document")).to_contain_text("正文未提取")
        page.locator("#detail-close").click()
        page.locator(".case-card").filter(has_text=source.name).click()
        expect(page.locator(".document-text-reader img")).to_have_count(1)
        page.screenshot(path="/tmp/pd-docx-reader.png", full_page=True)
        print("PASS: six file kinds, DOCX text/table/image, failed-extraction visibility, source classifications and byte-identical DOCX/XLSX/PSD/PR downloads")


if __name__ == "__main__":
    main()
