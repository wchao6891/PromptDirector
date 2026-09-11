"""Reduced observed Feishu DOM; isolated capture/save regression, not installed-site acceptance."""
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session
from page_capture_e2e import PNG

VIRTUAL = """<div id="scroll" style="height:400px;overflow:auto"><div class="docx-page-block"><div class="page-block root-block" style="height:7440px;position:relative"><h1 class="page-block-content">虚拟长文</h1><div id="rendered"></div><div data-record-id="mindmap" style="position:absolute;top:7200px"><img src="" style="display:none"><canvas width="160" height="160"></canvas></div></div></div></div><script>
const scroller=document.querySelector('#scroll');
const ctx=document.querySelector('canvas').getContext('2d');ctx.fillStyle='blue';ctx.fillRect(0,0,160,160);
let sessionImage='';fetch('/session-image.png').then(r=>r.blob()).then(b=>{sessionImage=URL.createObjectURL(b);render();});
function render(){const first=Math.max(0,Math.floor(scroller.scrollTop/240)-1);document.querySelector('#rendered').innerHTML=Array.from({length:Math.min(4,30-first)},(_,n)=>{const i=first+n;return `<div data-block-type="table" data-record-id="table-${Math.floor(i/10)}" style="position:absolute;top:${i*240}px"><table><tr data-index="${i%10}"><td data-record-id="cell-${i}"><div data-record-id="text-${i}"><div class="zone-container text-editor"><div class="ace-line">正文段落 ${i} 必须保留</div></div></div><div data-record-id="image-${i}"><img width="160" height="160" src="${i===29 && sessionImage ? sessionImage : `/image-${i}.png`}"></div></td></tr></table></div>`}).join('');}
scroller.addEventListener('scroll',()=>setTimeout(render,30));render();
</script>"""

SITE = 'https://capture-fixture.feishu.cn'
BODY = '''<aside><article><h1>侧边栏</h1><p>最近访问 收藏 目录 导航</p></article></aside>
<div class="ai-recommend-content-hidden"><div class="docx-page-block"><div class="page-block root-block" contenteditable="false">
<h1 class="page-block-content">文档正文测试</h1><div class="block-comment callout-block-comment local-comment-all-third-party"><div class="zone-container text-editor"><div class="ace-line"><span data-leaf="true">版更阶段性目标：维护口碑，提高留存。此处是应该保存的正文，不能用侧边栏取代。</span></div></div></div>
<div class="block-comment table-block-comment local-comment-all-third-party"><table><tr><td>名称</td><td>最佳实践</td></tr><tr><td rowspan="2">版本预约</td><td><p>图片前说明</p><img src="/case.png" width="640" height="480"><p>更新图文素材</p></td></tr><tr><td></td></tr></table></div>
</div></div></div>'''


def main():
    with tempfile.TemporaryDirectory(prefix='feishu-capture-extension-') as temp:
        extension = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name != 'manifest.json':
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += [SITE + '/*']
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        with extension_session('feishu-capture-', extension_dir=extension) as run:
            def route(r):
                if r.request.url.endswith('.png'):
                    r.fulfill(body=PNG, content_type='image/png')
                else:
                    body = VIRTUAL if r.request.url.endswith('/docx/virtual') else BODY if r.request.url.endswith('/docx/test') else '<aside><h1>侧边栏</h1><p>最近访问 收藏 目录 导航</p></aside>'
                    r.fulfill(body='<html><head><title>飞书云文档</title></head><body>'+body+'</body></html>', content_type='text/html; charset=utf-8')
            run.context.route(SITE + '/**', route)
            collector = run.open_page('collector.html')
            run.seed_storage(collector, {'schemaVersion':24,'entries':[], 'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-11T00:00:00Z','clipboardIncluded':True}})
            source = run.context.new_page()
            source.goto(SITE + '/docx/test', wait_until='networkidle')
            source.bring_to_front()
            response = collector.evaluate("async () => chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert response['ok'], response
            batch = response['batch']
            assert len(batch['candidates']) == 1, batch
            case = batch['candidates'][0]
            assert case['title'] == '文档正文测试', case
            assert '最近访问' not in case['contentText'], case
            assert '版更阶段性目标' in case['contentText'] and '更新图文素材' in case['contentText'], case
            assert case['completeness'] == 'partial', case
            assert case['extraction']['method'] == 'page', case
            assert len(case['media']) == 1, case
            assert any(t['kind'] == 'text' for t in case['region']['contentTargets']), case
            preview = collector.evaluate("async c => chrome.runtime.sendMessage({type:'PREVIEW_PAGE_CAPTURE_REGION',tabId:c.tabId,preview:c.preview})", {'tabId':batch['tabId'],'preview':{'marker':case['region']['marker'],'targets':case['region']['contentTargets'],'text':case['contentText'],'mediaIds':[m['id'] for m in case['media']]}})
            assert preview['ok'], preview
            batch['selections'] = [{'candidateId':case['id'],'includeText':True,'selectedMediaIds':[m['id'] for m in case['media']],'mediaDecision':'confirmed'}]
            saved = collector.evaluate("async batch => chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", batch)
            assert saved['ok'], saved
            entries = collector.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(entries) == 1, entries
            assert '版更阶段性目标' in json.dumps(entries, ensure_ascii=False), entries
            assert '最近访问' not in json.dumps(entries, ensure_ascii=False), entries
            library = run.open_page('library.html?case=' + entries[0]['id'])
            table = library.locator('.article-structured-table')
            table.wait_for()
            assert table.locator('tr').count() == 3
            assert table.locator('tr').nth(1).locator('td').first.get_attribute('rowspan') == '2'
            cell = table.locator('tr').nth(1).locator('td').nth(1)
            assert cell.locator('img').count() == 1
            assert cell.evaluate("e => [...e.children].map(n => n.tagName)") == ['P', 'FIGURE', 'P']
            assert library.locator('.article-document-reader > figure').count() == 0
            assert table.locator('tr').nth(2).locator('td').inner_text() == ''
            library.reload()
            library.locator('.case-card[data-entry-id="' + entries[0]['id'] + '"]').click()
            library.locator('.article-structured-table img').wait_for()
            source.goto(SITE + '/docx/loading' , wait_until='networkidle')
            source.bring_to_front()
            empty = collector.evaluate("async () => chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert not empty.get('batch',{}).get('candidates'), empty
            source.goto(SITE + '/docx/virtual', wait_until='networkidle')
            source.bring_to_front()
            source.locator('#scroll').evaluate('(e)=>e.scrollTop=720')
            long_result = collector.evaluate("async () => chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert long_result['ok'], long_result
            long_batch = long_result['batch']
            long_case = long_batch['candidates'][0]
            assert any(m.get('dataUrl','').startswith('data:image/png;base64,') for m in long_case['media']), 'Session image bytes must survive virtual unmount'
            assert any(m.get('captureMethod') == 'pixel-fallback' for m in long_case['media']), 'Mindmap canvas must be retained'
            assert len(long_case['media']) == 31, (len(long_case['media']),long_case['contentText'])
            for i in range(30):
                assert f'正文段落 {i} 必须保留' in long_case['contentText'], (i,long_case['contentText'])
            assert long_case['completeness'] == 'complete', long_case['extraction']
            assert len([b for b in long_case['articleDocument']['blocks'] if b['kind']=='table']) == 3
            assert source.locator('#scroll').evaluate('(e)=>e.scrollTop') == 720
            long_batch['selections']=[{'candidateId':long_case['id'],'includeText':True,'selectedMediaIds':[m['id'] for m in long_case['media']],'mediaDecision':'confirmed'}]
            result=collector.evaluate("async batch => chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})",long_batch)
            assert result['ok'],result
            entries=collector.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            saved=next(e for e in entries if e.get('sourceUrl','').endswith('/docx/virtual') or '正文段落 29' in json.dumps(e,ensure_ascii=False))
            assert '正文段落 0' in json.dumps(saved,ensure_ascii=False) and '正文段落 29' in json.dumps(saved,ensure_ascii=False)
            library.goto('chrome-extension://' + run.extension_id + '/library.html?case=' + saved['id'])
            library.locator('.article-structured-table').first.wait_for()
            assert library.locator('.article-structured-table').count() == 3
            for i in range(30):
                cell = library.locator('.article-structured-table td').nth(i)
                assert f'正文段落 {i} 必须保留' in cell.inner_text()
                assert cell.locator('img').count() == 1
            assert library.locator('.article-document-reader > figure').count() == 1
            print('PASS: rendered body/save/highlight; virtual document retains 30 images plus mindmap, all paragraphs, 3 tables and restores scroll')

if __name__ == '__main__':
    main()
