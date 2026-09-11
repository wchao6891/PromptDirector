"""Synthetic image-wall post: a single prompt belongs to every gallery image."""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session
from article_cases_capture_e2e import image_bytes

URL = 'https://www.xiaoheihe.cn/app/bbs/link/synthetic-gallery-post'
PROMPT = 'One outfit, four viewpoints.\n\n完整提示词：Create an editorial lookbook.\nNegative prompt: blurry, duplicate limbs.'
IMAGES = [f'https://imgheybox.max-c.com/case-{i}.png' for i in range(17)]
HTML = '<html><head><meta charset="utf-8"><title>Gallery case</title></head><body><div class="hb-bbs-image-text"><div class="image-text__header-image"><div class="swiper-wrapper">' + ''.join(f'<div class="swiper-slide"><img src="{url}" width="160" height="120"></div>' for url in IMAGES) + '''</div><div class="header-image__indicator">4/17</div><button>Next image</button></div><div class="image-text__container"><div class="link-section-user"><img src="https://imgheybox.max-c.com/avatar.png"><div class="link-user__username">Fixture author</div></div><div class="section-title__content">Gallery case</div><div class="image-text__content">''' + PROMPT + '''</div><div class="link-section-tags"><button>Community tag</button></div></div></div><aside>Recommendations</aside><div class="comment-item"><p>A reply must not become the prompt.</p><img src="https://imgheybox.max-c.com/comment.png"></div></body></html>'''


def main():
    with tempfile.TemporaryDirectory(prefix='pd-gallery-post-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'manifest.json':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += ['https://www.xiaoheihe.cn/*', 'https://*.max-c.com/*']
        (ext / 'manifest.json').write_text(json.dumps(manifest))
        with extension_session('pd-gallery-post-', extension_dir=ext) as run:
            run.context.route('https://www.xiaoheihe.cn/**', lambda route: route.fulfill(body=HTML, content_type='text/html; charset=utf-8'))
            run.context.route('https://*.max-c.com/**', lambda route: route.fulfill(body=image_bytes(route.request.url), content_type='image/png'))
            panel = run.open_page('collector.html')
            run.seed_storage(panel, {'entries': [], 'capturePermissionOnboarding': {'version': 1, 'acknowledgedAt': '2026-09-12T00:00:00Z', 'clipboardIncluded': True}})
            source = run.context.new_page()
            source.goto(URL)
            source.bring_to_front()
            panel.locator('#start-page-capture').evaluate('e=>e.click()')
            expect(panel.locator('.page-capture-item')).to_have_count(1)
            result = panel.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert result['ok'] and len(result['batch']['candidates']) == 1, result
            case = result['batch']['candidates'][0]
            assert case['contentText'] == PROMPT, case['contentText']
            assert case['sourceFacts']['author'] == 'Fixture author'
            assert {m['url'] for m in case['media']} == set(IMAGES)
            assert case['textBlocks'] and PROMPT in '\n'.join(b['text'] for b in case['textBlocks'])
            assert case['completeness'] == 'complete'
            panel.locator('.page-capture-confirm').click()
            panel.locator('#page-capture-save').click()
            panel.wait_for_function("async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.entries.length===1}")
            entry = panel.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries[0]")
            assert entry['text'] == PROMPT, entry['text']
            assert len(entry['mediaAssets']) == 17
            assert all(asset['byteSize'] > 0 for asset in entry['mediaAssets'])
            assert {asset['sourceUrl'] for asset in entry['mediaAssets']} == set(IMAGES)
            split = panel.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'article'})")
            assert not split['ok'], 'A single shared prompt must not become one case per image.'
            run.context.route('https://www.xiaoheihe.cn/**', lambda route: route.fulfill(body='<html><body><nav>Home Community Login</nav><img src="https://imgheybox.max-c.com/site-logo.png"></body></html>', content_type='text/html'))
            source.reload()
            source.bring_to_front()
            empty = panel.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert not empty['ok'], 'An unloaded post must not become a navigation or logo case.'
            print('PASS: default capture/save retains one full prompt with all 17 images, excludes profile/replies/tags, and does not invent multiple cases')


if __name__ == '__main__':
    main()
