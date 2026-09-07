from __future__ import annotations

import os
from pathlib import Path
from tempfile import mkdtemp

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def main() -> None:
    entry = base_entry(
        "captured-x-post",
        "Director Name · A practical lighting breakdown",
        "A practical lighting breakdown for a midnight chase: keep the street cyan, reserve warm light for the character, and let the wet road carry the contrast.",
        "content:prompt:image",
        1,
    )
    entry.update({
        "url": "https://x.com/director/status/123",
        "sourceFacts": {
            "provider": "x",
            "pageType": "post",
            "itemId": "123",
            "author": "Director Name",
            "handle": "director",
            "publishedAt": "2026-08-16T09:30:00.000Z",
            "capturedAt": "2026-08-16T09:31:00.000Z",
            "engagement": {"likes": 42, "reposts": 7},
            "captureScope": "document",
            "extractionMethod": "page",
            "status": "complete",
        },
        "mediaAssets": [
            {
                "id": "post-image",
                "kind": "image",
                "usage": "content",
                "storageMode": "managed",
                "mimeType": "image/png",
                "width": 1600,
                "height": 1067,
                "capturedAt": "2026-08-16T09:31:00.000Z",
                "reviewStatus": "verified",
                "palette": {"colors": ["#080808"], "source": "screenshot", "version": 2},
            },
            {
                "id": "post-video",
                "kind": "video",
                "usage": "content",
                "storageMode": "reference",
                "sourceUrl": "https://x.com/director/status/123/video/1",
                "sourceTitle": "Attached clip",
                "originalWorkUrl": "https://x.com/director/status/123",
                "reference": {
                    "url": "https://x.com/director/status/123/video/1",
                    "provider": "x",
                    "playbackMode": "embed",
                },
                "reviewStatus": "verified",
            },
        ],
        "primaryMediaId": "post-image",
        "articleDocument": {
            "version": 1,
            "blocks": [
                {"id": "post-copy", "kind": "paragraph", "text": "A practical lighting breakdown for a midnight chase: keep the street cyan, reserve warm light for the character, and let the wet road carry the contrast.", "sourceOrder": 0},
                {"id": "post-image-block", "kind": "image", "assetId": "post-image", "sourceUrl": "https://x.com/post-image.png", "sourceOrder": 1},
                {"id": "post-video-block", "kind": "video", "assetId": "post-video", "sourceUrl": "https://x.com/director/status/123/video/1", "sourceOrder": 2},
            ],
        },
    })

    entry["articleDocument"]["blocks"].extend([
        {"id": "quote", "kind": "quote", "text": "引用：先明确人物站位，再描述镜头运动。", "sourceOrder": 3},
        {"id": "steps", "kind": "list", "ordered": True, "text": "确定主体位置\n安排运动方向\n检查前后衔接", "sourceOrder": 4},
        {"id": "code", "kind": "code", "text": "camera: tracking\n  subject: walking", "sourceOrder": 5},
        {"id": "link", "kind": "link", "label": "原始参考资料 " + "reference/" * 15,
         "sourceUrl": "https://example.com/reference", "sourceOrder": 6},
    ])
    evidence = Path(os.environ.get("PROMPTDIRECTOR_LAB_EVIDENCE_DIR") or mkdtemp(prefix="post-detail-evidence-"))
    evidence.mkdir(parents=True, exist_ok=True)
    with extension_session("prompt-director-x-post-") as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {"entries": [entry], "uiPreferences": {"theme": "dark", "locale": "zh-CN", "motion": "reduced"}})
        setup.evaluate(
            """async png => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              await saveMediaBlob('post-image', new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
            }""", PNG_BASE64)
        library = run.open_page("library.html", wait_until="networkidle")
        expect(library.locator(".case-card")).to_have_count(1)
        library.locator(".case-card").click()
        expect(library.locator(".detail-visual-gallery")).to_be_visible(timeout=8000)
        expect(library.locator(".original-prompt-panel")).to_contain_text("practical lighting breakdown")
        expect(library.locator(".captured-post-view, .article-document-reader")).to_have_count(0)
        expect(library.locator("#detail-content")).to_have_class("detail-content has-primary-media")
        before = setup.evaluate("async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.entries[0]}")

        def classify(category):
            result = setup.evaluate("""async category => chrome.runtime.sendMessage({
              type:'CONFIRM_CLASSIFICATION', entryId:'captured-x-post', pathIds:[category], rememberSource:false
            })""", category)
            assert result['ok'], result

        classify('content:reference')
        reader = library.locator('.article-document-reader')
        expect(reader).to_be_visible(timeout=8000)
        expect(library.locator('.detail-visual-gallery, .captured-post-view')).to_have_count(0)
        expect(library.locator('.original-prompt-panel')).to_have_count(0)
        expect(reader.locator('blockquote')).to_have_text('引用：先明确人物站位，再描述镜头运动。')
        expect(reader.locator('ol > li')).to_have_count(3)
        expect(reader.locator('pre')).to_have_text('camera: tracking\n  subject: walking')
        expect(reader.locator('.article-document-image')).to_have_count(1)
        expect(reader.locator('.compact-media-link')).to_have_count(1)
        assert reader.locator('.compact-media-link').bounding_box()['height'] < 80, '没有封面的视频不能撑成空白大卡片'
        expect(reader.locator('iframe')).to_have_count(0)
        for theme in ('dark', 'light'):
            library.evaluate("async theme=>{const {initializeUi}=await import('./i18n.js');await initializeUi({theme,locale:'zh-CN',motion:'reduced'})}", theme)
            for width in (1280, 390, 320):
                library.set_viewport_size({'width': width, 'height': 900})
                assert reader.evaluate('e=>e.scrollWidth<=e.clientWidth'), (theme, width, 'article overflow')
                header = library.locator('.detail-header-section')
                assert header.evaluate('e=>e.scrollWidth<=e.clientWidth'), (theme, width, 'header overflow')
                title = header.locator('.detail-title').bounding_box()
                edit = header.locator('.entry-editor-inline > summary').bounding_box()
                assert title['x'] + title['width'] <= edit['x'] + 1, (theme, width, 'title overlap')
                resource = reader.locator('.article-document-resource')
                assert resource.evaluate('e=>{const t=e.querySelector("strong").getBoundingClientRect(), a=e.querySelector("a").getBoundingClientRect();return a.x>=t.right-1 && a.y<t.bottom && a.bottom>t.y}'), (theme,width,'resource action must stay beside its label')
                assert reader.locator('p').first.evaluate('e=>getComputedStyle(e).fontWeight') == '400'
                library.screenshot(path=str(evidence / f'article-detail-{theme}-{width}.png'))

        # A category change on the open article must remount the existing case template.
        classify('content:prompt:video')
        expect(library.locator('.detail-visual-gallery')).to_be_visible(timeout=8000)
        expect(reader).to_have_count(0)
        expect(library.locator('.original-prompt-panel')).to_contain_text('practical lighting breakdown')
        library.locator('.detail-visual-thumb').nth(1).click()
        expect(library.locator('.detail-visual-gallery')).to_have_class(__import__('re').compile('is-video-detail'))
        expect(library.locator('.original-prompt-panel')).to_contain_text('practical lighting breakdown')
        classify('content:reference')
        expect(reader).to_be_visible(timeout=8000)
        after = setup.evaluate("async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.entries[0]}")
        for key in ('text', 'mediaAssets', 'articleDocument', 'sourceFacts'):
            assert before[key] == after[key], (key, before[key], after[key])

        # List editing stays a plain-text edit, then restores the reading structure.
        reader.get_by_role('button', name='编辑正文', exact=True).click()
        steps = reader.locator('[data-article-block-id="steps"]')
        steps.fill('取消的修改')
        reader.get_by_role('button', name='取消', exact=True).click()
        expect(reader.locator('ol > li')).to_have_count(3)
        reader.get_by_role('button', name='编辑正文', exact=True).click()
        steps.fill('新的第一步\n新的第二步')
        reader.get_by_role('button', name='保存', exact=True).click()
        expect(reader.locator('ol > li')).to_have_count(2)
        expect(reader.locator('ol')).to_contain_text('新的第二步')
        reader.get_by_role('button', name='复制文字', exact=True).click()
        copied = library.evaluate('async()=>navigator.clipboard.readText()')
        assert '新的第二步' in copied and '取消的修改' not in copied
        assert reader.get_by_role('button', name='复制文字', exact=True).locator('svg').count() == 1
        library.reload(wait_until='networkidle')
        library.locator('.case-card').click()
        expect(library.locator('.article-document-reader ol > li')).to_have_count(2)
        stored = setup.evaluate("async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.entries[0]}")
        assert stored['mediaAssets'] == before['mediaAssets']
        assert next(b for b in stored['articleDocument']['blocks'] if b['id']=='steps')['text'] == '新的第一步\n新的第二步'
        print({'classification_routes_detail': True, 'live_mode_switch': True, 'structured_article': True,
               'list_edit_readback': True, 'media_unchanged': True, 'widths': [1280,390,320], 'themes': 2, 'evidence': str(evidence)})


if __name__ == "__main__":
    main()
