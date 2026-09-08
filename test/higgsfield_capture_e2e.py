"""Reduced Higgsfield DOM fixtures; proves local extension behavior, not live-site acceptance."""
from __future__ import annotations

import json
import base64
import io
import zipfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session
from page_capture_e2e import PNG

SITE = "https://higgsfield.ai"
CDN = "https://d2ol7oe51mr4n9.cloudfront.net"
VIDEO = f"{CDN}/test/movie.mp4"
PUBLICATION = f"{SITE}/publications/test-publication"
PROJECT = f"{SITE}/@test-creator/projects/test-project"


def document(url, body, video=False):
    work = {"@type": "CreativeWork", "url": url, "name": "Capture regression fixture", "description": "Original test prompt: a continuous camera movement.", "author": {"@type": "ProfilePage", "mainEntity": {"@type": "Person", "name": "Test creator", "identifier": "test-creator"}}}
    if video:
        work["video"] = {"@type": "VideoObject", "contentUrl": VIDEO, "thumbnailUrl": f"{CDN}/test/poster.png"}
    else:
        work["image"] = f"{CDN}/test/cover.png"
    return f'''<!doctype html><html><head><title>Capture regression fixture</title><link rel="canonical" href="{url}"><script type="application/ld+json">{json.dumps(work)}</script></head><body><header>Navigation to exclude</header><main>{body}</main></body></html>'''


def main():
    with tempfile.TemporaryDirectory(prefix="higgsfield-extension-") as temp:
        extension = Path(temp)
        # Isolated test permissions only. The product manifest and installed Chrome are untouched.
        for file in EXTENSION_DIR.iterdir():
            if file.name not in {"manifest.json", ".git", "node_modules", "dist"}:
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / "manifest.json").read_text())
        manifest["host_permissions"] += [f"{SITE}/*", f"{CDN}/*", "https://images.higgs.ai/*"]
        (extension / "manifest.json").write_text(json.dumps(manifest))
        with extension_session("higgsfield-capture-", extension_dir=extension) as run:
            video_bytes = (Path(__file__).resolve().parent / "fixtures/zhipu-local-video-smoke.mp4").read_bytes()
            publication = document(PUBLICATION, f'<h1>Capture regression fixture</h1><p>Original test prompt: a continuous camera movement.</p><video controls poster="{CDN}/test/poster.png" src="{VIDEO}" style="width:640px;height:360px"></video>', True)
            original = f"{CDN}/test/reference.png"
            proxy = "https://images.higgs.ai/?url=" + original.replace(":", "%3A").replace("/", "%2F") + "&w=1920&q=85"
            brief = f'''<h1>Capture regression fixture</h1><section aria-label="Project brief: Capture regression fixture"><div role="textbox" contenteditable="false"><p>Production breakdown test introduction.</p><h2>Assets and tools</h2><p>Reference image used for a consistent character.</p><div style="height:1400px"></div><div id="lazy-reference" class="rde-asset-embed" data-lexical-decorator="true" style="width:640px;height:360px"></div><h2>Prompting</h2><code class="rde-code" data-language="javascript"><span>style → references</span><br><span>action → sound</span></code><p><a href="{CDN}/test/skill.md" download="skill.md">Download skill</a></p><p>Skill archive: <a href="{CDN}/test/skill.zip" download>Download archive</a></p><h2>Conclusions</h2><p>Test closing paragraph.</p></div></section><section class="recommendations"><h2>Recommended projects</h2><img src="{CDN}/test/recommended.png" style="width:640px;height:360px"></section>'''
            # One unavailable embed must not prevent the later lazy image from loading.
            brief = brief.replace('<div id="lazy-reference"', '<div class="rde-asset-embed" data-asset-id="unavailable-fixture"></div><div id="lazy-reference"')
            archive_buffer = io.BytesIO()
            with zipfile.ZipFile(archive_buffer, 'w') as archive:
                archive.writestr('fixture/SKILL.md', '# Fixture skill\nNever executed by capture.')
            archive_bytes = archive_buffer.getvalue()
            archive_encoded = base64.b64encode(archive_bytes).decode()
            button_documents = ''.join(f'<div class="rde-asset-embed"><span>Test skill {index}.md</span><button aria-label="Download file" onclick="downloadTestSkill({index})">Download</button></div>' for index in range(3))
            button_documents += '<div class="rde-asset-embed"><span>fixture.skill</span><button aria-label="Download file" onclick="downloadTestArchive()">Download</button></div>'
            brief = brief.replace('<h2>Conclusions</h2>', button_documents + '<h2>Conclusions</h2>')
            project = document(PROJECT, brief) + f'''<script>
              window.downloadTestArchive = () => {{
                const blob = new Blob([Uint8Array.from(atob({json.dumps(archive_encoded)}), c=>c.charCodeAt(0))], {{type:'application/gzip'}});
                const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'fixture.skill'; link.click(); URL.revokeObjectURL(link.href);
              }};
              window.downloadTestSkill = index => {{
                const blob = new Blob(['# Test skill ' + index + '\\nActual fixture attachment bytes.'], {{type:'text/markdown'}});
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob); link.download = 'Test skill ' + index + '.md';
                link.click(); URL.revokeObjectURL(link.href);
              }};
              window.originalDownloadHooks = [URL.createObjectURL, HTMLAnchorElement.prototype.click];
              const target = document.getElementById('lazy-reference');
              const observer = new IntersectionObserver(entries => {{
                if (!entries.some(entry=>entry.isIntersecting)) return;
                observer.disconnect();
                const image = document.createElement('img');
                image.src = {json.dumps(proxy)}; image.alt = 'Reference';
                image.style = 'width:640px;height:360px';
                target.append(image);
              }}); observer.observe(target);
            </script>'''
            def route(request):
                url = request.request.url
                if url in {PUBLICATION, PROJECT}:
                    request.fulfill(status=200, content_type="text/html; charset=utf-8", body=publication if url == PUBLICATION else project)
                elif url.endswith("movie.mp4"):
                    request.fulfill(status=200, content_type="video/mp4", body=video_bytes)
                elif url.endswith("skill.md"):
                    request.fulfill(status=200, content_type="text/markdown", body=b"# Test skill\nFixture-only reusable instructions.\n")
                elif url.endswith("skill.zip"):
                    raise AssertionError("ZIP must remain a source link, never silently installed or fetched")
                else:
                    request.fulfill(status=200, content_type="image/png", body=PNG)
            for origin in (SITE, CDN, "https://images.higgs.ai"):
                run.context.route(f"{origin}/**", route)
            collector = run.open_page("collector.html")
            run.seed_storage(collector, {"schemaVersion": 24, "entries": [], "capturePermissionOnboarding": {"version": 1, "acknowledgedAt": datetime.now(timezone.utc).isoformat(), "clipboardIncluded": True}})
            source = run.context.new_page()
            native_downloads = []
            source.on('download', lambda download: native_downloads.append(download.suggested_filename))
            def capture(url):
                source.goto(url, wait_until="networkidle")
                source.bring_to_front()
                return collector.evaluate('''async () => {
                  const {pageCaptureDefaultMediaIds} = await import('./page-capture.js');
                  const response = await chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'});
                  if (!response?.ok) throw new Error(response?.message || 'Capture failed');
                  const batch = response.batch;
                  batch.selections = batch.candidates.map(candidate=>({candidateId:candidate.id,includeText:true,selectedMediaIds:pageCaptureDefaultMediaIds(candidate),mediaDecision:'confirmed'}));
                  return batch;
                }''')
            video_batch = capture(PUBLICATION)
            assert len(video_batch["candidates"]) == 1, video_batch
            candidate = video_batch["candidates"][0]
            assert candidate["sourceFacts"]["author"] == "Test creator", candidate
            assert len(candidate["media"]) == 1, candidate
            assert candidate["media"][0]["kind"] == "video", candidate
            assert candidate["media"][0]["id"] in video_batch["selections"][0]["selectedMediaIds"], candidate
            result = collector.evaluate("async batch => chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", video_batch)
            assert result.get("ok"), result
            stored = collector.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            asset = next(a for a in stored[0]["mediaAssets"] if a["kind"] == "video")
            poster = next(a for a in stored[0]["mediaAssets"] if a.get("usage") == "poster")
            assert asset["posterAssetId"] == poster["id"], stored[0]
            assert stored[0]["primaryMediaId"] == asset["id"], stored[0]
            assert stored[0]["classification"]["pathIds"] == ["content:prompt:video"], stored[0]
            assert asset["storageMode"] == "managed" and asset["mimeType"] == "video/mp4", asset
            saved_bytes = collector.evaluate("async id => {const {getMediaBlob}=await import('./media-store.js'); const b=await getMediaBlob(id); return {size:b.size,type:b.type};}", asset["id"])
            assert saved_bytes == {"size": len(video_bytes), "type": "video/mp4"}, saved_bytes
            # Reproduce a previously saved page-only video, with user edits worth preserving.
            legacy_id = stored[0]['id']
            collector.evaluate('''async id => {
              const {deleteMediaBlob}=await import('./media-store.js');
              const {entries}=await chrome.storage.local.get('entries');
              const entry=entries.find(item=>item.id===id);
              for (const media of entry.mediaAssets) await deleteMediaBlob(media.id);
              const video=entry.mediaAssets.find(item=>item.kind==='video');
              entry.mediaAssets=[{id:video.id,kind:'video',storageMode:'reference',sourceUrl:entry.url,reference:{url:entry.url,provider:'higgsfield',playbackMode:'source'}}];
              entry.title='User edited title'; entry.text='User preserved original prompt';
              entry.customLabels=['Keep my tag'];
              entry.mediaPrompts=[{assetId:video.id,source:'manual',text:'User media prompt',updatedAt:'2026-09-05T00:00:00.000Z'}];
              entry.sourceFacts.pageType='article';
              entry.classification={pathIds:['content:tutorial'],status:'confirmed',source:'auto'};
              await chrome.storage.local.set({entries});
            }''', legacy_id)
            repaired = collector.evaluate("async batch => chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", video_batch)
            assert repaired.get('ok') and repaired['results'][0].get('repaired'), repaired
            restored = collector.evaluate("async id => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.find(entry=>entry.id===id)", legacy_id)
            assert restored['title'] == 'User edited title' and restored['text'] == 'User preserved original prompt', restored
            assert restored['customLabels'] == ['Keep my tag'], restored
            assert any(item['text'] == 'User media prompt' for item in restored['mediaPrompts']), restored
            assert restored['classification']['pathIds'] == ['content:prompt:video'], restored
            assert restored['sourceFacts']['pageType'] == 'video', restored
            assert any(item['id']==asset['id'] and item['storageMode']=='managed' for item in restored['mediaAssets']), restored
            duplicate = collector.evaluate("async batch => chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", video_batch)
            assert duplicate['results'][0]['status'] == 'duplicate', duplicate
            source.goto(PROJECT, wait_until='networkidle')
            source.bring_to_front()
            collector.evaluate("() => document.querySelector('#start-page-capture').click()")
            collector.wait_for_function("() => document.querySelector('#page-capture-cancel').textContent === '停止扫描' && !document.querySelector('#page-capture-cancel').disabled")
            assert collector.locator('#page-capture-list-setup').is_hidden()
            collector.evaluate("() => document.querySelector('#page-capture-cancel').click()")
            collector.wait_for_function("() => !document.querySelector('#page-capture-help').textContent.includes('正在扫描')", timeout=3000)
            collector.wait_for_function("() => !document.querySelector('#start-page-capture').disabled", timeout=4000)
            assert source.evaluate('window.scrollY') == 0
            article_batch = capture(PROJECT)
            assert not native_downloads, native_downloads
            assert source.evaluate('() => originalDownloadHooks[0] === URL.createObjectURL && originalDownloadHooks[1] === HTMLAnchorElement.prototype.click')
            assert source.evaluate("window.scrollY") == 0, "Lazy-media scan must restore reading position"
            assert len(article_batch["candidates"]) == 1, article_batch
            article = article_batch["candidates"][0]
            embedded_documents = [m for m in article["media"] if m.get("downloadDataUrl")]
            assert len(embedded_documents) == 4, article
            assert article["pageType"] == "article", article
            assert article["extraction"]["pendingMediaCount"] == 1, article
            assert "Recommended projects" not in article["contentText"], article
            blocks = article["articleDocument"]["blocks"]
            assert len([b for b in blocks if b["kind"] == "heading"]) == 3, blocks
            assert any(b["kind"] == "code" and "references\naction" in b["text"] for b in blocks), blocks
            assert "Test closing paragraph." in article["contentText"], article
            assert any(b["kind"] == "link" and b["sourceUrl"].endswith("skill.zip") for b in blocks), blocks
            selected_ids = article_batch["selections"][0]["selectedMediaIds"]
            selected = [m for m in article["media"] if m["id"] in selected_ids]
            assert {m["kind"] for m in selected} == {"image", "document", "attachment"}, selected
            assert any(m["kind"] == "image" and m["url"] == original for m in selected), selected
            assert not any("recommended" in m["url"] for m in article["media"]), article
            result = collector.evaluate("async batch => chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", article_batch)
            assert result.get("ok"), result
            assert result["results"][0]["status"] == "partial", result
            assert any("1 项媒体未加载" in warning for warning in result["results"][0]["warnings"]), result
            stored = collector.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            saved_article = next(e for e in stored if e["url"] == PROJECT)
            assert {a["kind"] for a in saved_article["mediaAssets"]} == {"image", "document", "attachment"}, saved_article
            assert all(a["storageMode"] == "managed" for a in saved_article["mediaAssets"]), saved_article
            assert any(b["kind"] == "code" for b in saved_article["articleDocument"]["blocks"]), saved_article
            for index in range(3):
                asset = next(a for a in saved_article['mediaAssets'] if a['sourceTitle'] == f'Test skill {index}.md')
                contents = collector.evaluate("async id => {const {getMediaBlob}=await import('./media-store.js');return (await getMediaBlob(id)).text();}", asset['id'])
                assert contents == f'# Test skill {index}\nActual fixture attachment bytes.', contents
            skill_asset = next(a for a in saved_article['mediaAssets'] if a['kind'] == 'attachment')
            assert skill_asset['sourceTitle'] == 'fixture.skill' and skill_asset['sourceFormat'] == 'skill', skill_asset
            archive_readback = collector.evaluate("async id => {const {getMediaBlob}=await import('./media-store.js');return Array.from(new Uint8Array(await (await getMediaBlob(id)).arrayBuffer()));}", skill_asset['id'])
            assert bytes(archive_readback) == archive_bytes
            assert any(b['kind'] == 'attachment' and b['assetId'] == skill_asset['id'] for b in saved_article['articleDocument']['blocks'])
            # Existing saved videos must recover a missing poster without being recaptured.
            collector.evaluate('''async id => {
              const {getMediaBlob,deleteMediaBlob}=await import('./media-store.js');
              const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
              const entry=state.entries.find(e=>e.url===id);
              for (const asset of entry.mediaAssets.filter(a=>a.usage==='poster')) await deleteMediaBlob(asset.id);
              entry.mediaAssets=entry.mediaAssets.filter(a=>a.usage!=='poster').map(a=>{delete a.posterAssetId;return a;});
              await chrome.storage.local.set({entries:state.entries});
            }''',PUBLICATION)
            library = run.open_page('library.html')
            library.locator(f'.case-card[data-entry-id="{stored[0]["id"]}"]').first.wait_for()
            video_entry = next(e for e in stored if e['url'] == PUBLICATION)
            video_card = library.locator(f'.case-card[data-entry-id="{video_entry["id"]}"]')
            video_card.locator('.case-video-poster img').wait_for()
            library.wait_for_function("id => document.querySelector(`[data-entry-id='${id}'] .case-video-poster img`)?.naturalWidth > 0", arg=video_entry['id'])
            video_card.click()
            library.locator('#detail-content video').wait_for()
            assert library.locator('#detail-content .article-document-reader').count() == 0
            assert 'has-primary-media' in library.locator('#detail-content').get_attribute('class')
            print(json.dumps({"publication_video": saved_bytes, "article_block_count": len(blocks), "article_saved_media": len(saved_article["mediaAssets"]), "status": "passed"}))

if __name__ == "__main__":
    main()
