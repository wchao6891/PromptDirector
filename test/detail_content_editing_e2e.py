from __future__ import annotations

import os
from pathlib import Path
from tempfile import mkdtemp
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session

PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def main():
    article = base_entry("article-edit", "文章编辑回归", "文章正文只读一次。", "content:prompt:image")
    article["sourceFacts"] = {"pageType": "article"}
    article["articleDocument"] = {"version": 1, "blocks": [{"kind": "paragraph", "text": article["text"]}]}
    article["mediaAssets"] = [{"id": f"article-image-{i}", "kind": "image", "usage": "content", "storageMode": "managed", "mimeType": "image/png"} for i in range(2)]
    article["primaryMediaId"] = "article-image-0"
    article["articleDocument"]["blocks"].append({"kind": "image", "assetId": "article-image-0"})
    independent = {**article, "id": "article-independent", "title": "文章独立提示词"}
    independent["mediaPrompts"] = [{"assetId": "article-image-0", "source": "manual", "text": "图片独立原始"},
                                  {"assetId": "article-image-0", "source": "ai-suggestion", "text": "图片独立AI"}]
    video = base_entry("video-edit", "视频缩略区回归", "视频原始提示词", "content:prompt:video")
    video["mediaAssets"] = [
        {"id": "reference-video", "kind": "video", "usage": "content", "storageMode": "reference", "mimeType": "video/mp4", "sourceUrl": "https://example.com/watch/1", "posterAssetId": "video-poster"},
        {"id": "no-poster-video", "kind": "video", "usage": "content", "storageMode": "reference", "mimeType": "video/mp4", "sourceUrl": "https://example.com/watch/2"},
        {"id": "video-poster", "kind": "image", "usage": "poster", "storageMode": "managed", "mimeType": "image/png", "derivedFromAssetId": "reference-video"},
    ]
    video["primaryMediaId"] = "reference-video"
    evidence = Path(os.environ.get("PROMPTDIRECTOR_LAB_EVIDENCE_DIR") or mkdtemp(prefix="detail-content-evidence-"))
    with extension_session("detail-content-editing-") as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {"entries": [article, independent, video], "uiPreferences": {"locale": "zh-CN", "theme": "light", "motion": "reduced"}})
        setup.evaluate("""async png => {
          const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          for (const id of ['article-image-0','article-image-1','video-poster'])
            await saveMediaBlob(id, new Blob([Uint8Array.from(atob(png), c=>c.charCodeAt(0))], {type:'image/png'}), {checkCapacity:false});
        }""", PNG)
        page = session.open_page("library.html", wait_until="networkidle")
        page.locator('[data-entry-id="article-edit"].case-card').click()
        expect(page.locator('#detail-drawer')).to_have_attribute('data-entry-id', 'article-edit')
        expect(page.locator('.article-document-reader')).to_contain_text(article["text"])
        defects = []
        expect(page.locator('.original-prompt-panel')).to_have_count(0)
        expect(page.locator('#detail-content').get_by_role('button', name='以此创作', exact=True)).to_have_count(1)
        expect(page.locator('#detail-content').get_by_role('button', name='分析文字标签', exact=True)).to_have_count(1)
        page.locator('.entry-editor-inline > summary').click()
        if page.locator('.entry-editor-inline textarea:visible').count():
            defects.append("打开编辑案例就出现多个正文输入区")
        page.locator('.entry-editor-inline > summary').click()
        reader = page.locator('.article-document-reader')
        reader.evaluate('e=>{window.articleReader=e;window.articleImage=e.querySelector("img")}')
        reader.get_by_role('button', name='编辑正文', exact=True).click()
        reader.get_by_role('textbox', name='编辑正文段落', exact=True).fill('取消的草稿')
        reader.get_by_role('button', name='取消', exact=True).click()
        expect(reader).to_contain_text(article['text'])
        expect(reader.get_by_role('button', name='编辑正文', exact=True)).to_be_focused()
        reader.get_by_role('button', name='编辑正文', exact=True).click()
        # Hold the actual save boundary to verify input cannot race a persisted snapshot.
        page.evaluate("""() => {
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          window.releaseArticleSave = null;
          chrome.runtime.sendMessage = (message, ...args) => message?.type === 'UPDATE_ENTRY_ARTICLE_TEXT'
            ? new Promise(resolve => { window.releaseArticleSave = () => resolve({ok:false, message:'测试保存失败'}); })
            : send(message, ...args);
          window.restoreArticleTransport = () => { chrome.runtime.sendMessage = send; };
        }""")
        reader.get_by_role('textbox', name='编辑正文段落', exact=True).fill('失败后仍可编辑的草稿')
        reader.get_by_role('button', name='保存', exact=True).click()
        page.wait_for_function('() => typeof window.releaseArticleSave === "function"')
        expect(reader.get_by_role('textbox', name='编辑正文段落', exact=True)).not_to_be_editable()
        expect(reader.get_by_role('button', name='保存', exact=True)).to_be_disabled()
        expect(reader.get_by_role('button', name='取消', exact=True)).to_be_disabled()
        page.evaluate('() => {window.restoreArticleTransport(); window.releaseArticleSave()}')
        expect(reader.get_by_role('textbox', name='编辑正文段落', exact=True)).to_be_editable()
        expect(reader.get_by_role('textbox', name='编辑正文段落', exact=True)).to_contain_text('失败后仍可编辑的草稿')
        expect(reader.get_by_role('button', name='保存', exact=True)).to_be_enabled()
        reader.get_by_role('textbox', name='编辑正文段落', exact=True).fill('保存后的文章正文。')
        reader.get_by_role('button', name='保存', exact=True).click()
        expect(reader).to_contain_text('保存后的文章正文。')
        expect(reader.get_by_role('button', name='编辑正文', exact=True)).to_be_focused()
        assert reader.evaluate('e=>e===window.articleReader && e.querySelector("img")===window.articleImage'), '文章保存不应重建媒体'
        stored = page.evaluate("async()=>{const {entries}=await chrome.storage.local.get('entries');return entries.find(e=>e.id==='article-edit')}")
        assert stored['text'] == '保存后的文章正文。'
        assert any(block.get('assetId') == 'article-image-0' for block in stored['articleDocument']['blocks'])
        page.locator('#detail-close').click()
        page.locator('[data-entry-id="article-independent"].case-card').click()
        expect(page.locator('#detail-drawer')).to_have_attribute('data-entry-id', 'article-independent')
        expect(page.locator('.original-prompt-panel').filter(has_text='图片独立原始')).to_have_count(1)
        expect(page.locator('.image-reconstruction-current').filter(has_text='图片独立AI')).to_have_count(1)
        if page.locator('.article-actions-section > .detail-core-actions').get_by_role('button', name='分析文字标签', exact=True).count():
            defects.append("底部只保留以此创作，文字标签分析应在右上动作区")
        page.locator('#detail-close').click()
        page.locator('[data-entry-id="video-edit"].case-card').click()
        expect(page.locator('.detail-visual-rail')).to_be_visible()
        if not page.locator('.detail-visual-thumb').first.locator('img').count():
            defects.append("视频已有封面但缩略区未使用")
        if page.locator('.detail-visual-gallery').get_by_text('附加本地视频', exact=True).count() != 1:
            defects.append("附加本地视频在播放器区域重复出现")
        expect(page.locator('.platform-playback-fallback > img')).to_have_count(1)
        for theme in ('light', 'dark'):
            page.evaluate("async theme => {const {initializeUi}=await import('./i18n.js');await initializeUi({theme,locale:'zh-CN',motion:'reduced'});}", theme)
            for width in (1280, 390):
                page.set_viewport_size({"width": width, "height": 844})
                for index in (0, 1):
                    thumb = page.locator('.detail-visual-thumb').nth(index)
                    thumb.click()
                    expect(thumb).to_have_attribute('aria-pressed', 'true')
                    if index == 1:
                        expect(thumb.locator('.media-thumb-label')).to_contain_text('视频')
                        expect(page.locator('.platform-playback-fallback > img')).to_have_count(0)
                    assert page.locator('.detail-visual-gallery').evaluate('e=>e.scrollWidth<=e.clientWidth'), (theme, width)
                    remove = page.get_by_role('button', name='此媒体移入回收站', exact=True)
                    remove.scroll_into_view_if_needed()
                    assert remove.evaluate('e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}'), (theme, width)
                    contrast = page.locator('.platform-link-actions button').evaluate(r"""e => {
                      const luminance = color => {const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]};
                      const s=getComputedStyle(e), a=luminance(s.color), b=luminance(s.backgroundColor);
                      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
                    }""")
                    assert contrast >= 4.5, (theme, width, index, contrast)
                    page.screenshot(path=str(evidence / f'video-controls-{theme}-{width}-{index}.png'))
        assert not defects, defects
        print({"articleShownOnce": True, "articleActionsAndSources": True, "onDemandEditor": True, "videoPoster": True, "singleAttachAction": True, "themes": 2, "widths": 2, "evidence": str(evidence)})


if __name__ == '__main__':
    main()
