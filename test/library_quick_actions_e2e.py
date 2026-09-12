"""Real browser downloads of repository fixtures; isolated profile, no user library."""
import base64
import hashlib
import tempfile
import wave
import io
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session

ROOT = Path(__file__).resolve().parent

def main():
    wav = io.BytesIO()
    with wave.open(wav, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(8000); f.writeframes(b'\0\0' * 800)
    fixtures = [
        ('image', 'image/gif', 'original.gif', (ROOT/'fixtures/transfer-media/original.gif').read_bytes()),
        ('image', 'image/avif', 'original.avif', (ROOT/'fixtures/transfer-media/original.avif').read_bytes()),
        ('video', 'video/mp4', 'clip.mp4', (ROOT/'fixtures/detail-portrait-smoke.mp4').read_bytes()),
        ('audio', 'audio/wav', 'sound.wav', wav.getvalue()),
        ('attachment', 'application/zip', 'source.skill', (ROOT/'fixtures/zip/optional-zip64.zip').read_bytes()),
    ]
    assets = [dict(id=f'quick-{i}', kind=kind, mimeType=mime, sourceTitle=name,
                   sourceFormat=name.rsplit('.', 1)[1], storageMode='managed', usage='content', byteSize=len(data))
              for i,(kind,mime,name,data) in enumerate(fixtures)]
    entry = base_entry('quick-case', '快捷测试', '提示词保持在右侧', 'content:prompt:image', 1)
    entry.update(mediaAssets=assets, primaryMediaId=assets[0]['id'])
    other = base_entry('quick-other', '另一案例', '其他', 'content:prompt:image', 2)
    other.update(mediaAssets=[{**assets[0], 'id':'other-file'}], primaryMediaId='other-file')
    with extension_session('pd-quick-actions-', viewport={'width':1440,'height':900}) as session:
        setup = session.open_page('collector.html')
        setup.evaluate('''async ({entries, files}) => {
          const {savePortableAssetBlob}=await import(chrome.runtime.getURL('media-store.js'));
          await chrome.storage.local.clear();
          await chrome.storage.local.set({schemaVersion:28,entries,uiPreferences:{locale:'zh-CN',theme:'dark'},
            organizerState:{version:5,collections:[{id:'parent',name:'父项目',entryIds:[],order:0,visibility:'library'},
            {id:'project-quick',name:'子项目',parentId:'parent',entryIds:['quick-case'],order:0,visibility:'library'}]}});
          for (const f of files) await savePortableAssetBlob(f.id,new Blob([Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))],{type:f.mime}),{checkCapacity:false});
        }''', {'entries':[entry,other], 'files':[
            {'id':a['id'],'mime':a['mimeType'],'data':base64.b64encode(fixtures[i][3]).decode()} for i,a in enumerate(assets)
        ]+[{'id':'other-file','mime':'image/gif','data':base64.b64encode(fixtures[0][3]).decode()}]})
        # Long project tree: target is the final nested project.
        page = session.open_page('library.html', wait_until='networkidle')
        page.evaluate("""async()=>{const {organizerState}=await chrome.storage.local.get('organizerState');
          organizerState.collections=[...Array.from({length:45},(_,i)=>({id:'p'+i,name:'项目'+i,entryIds:[],order:i,visibility:'library'})),
          {id:'parent',name:'父项目',entryIds:[],order:46,visibility:'library'},
          {id:'project-quick',name:'子项目',parentId:'parent',entryIds:['quick-case'],order:47,visibility:'library'}];
          await chrome.storage.local.set({organizerState});}""")
        page.reload(wait_until='networkidle')
        card = page.locator('[data-entry-id="quick-case"].case-card')
        expect(card).to_be_visible()
        expect(page.locator('.case-card button')).to_have_count(0)
        expect(page.locator('#selection-download')).to_have_count(0)
        card.focus(); page.keyboard.press('Shift+F10')
        expect(page.get_by_role('menuitem')).to_have_text(['下载副本','导出案例','定位项目','项目管理','移至回收站'])
        page.keyboard.press('End'); expect(page.get_by_role('menuitem',name='移至回收站')).to_be_focused()
        page.keyboard.press('Escape'); expect(card).to_be_focused()
        downloads=[]
        page.on('download', lambda d: downloads.append(d))
        with tempfile.TemporaryDirectory(prefix='pd-copy-check-') as tmp:
            def verify(index, expected):
                deadline=__import__('time').monotonic()+15
                while len(downloads)<=index and __import__('time').monotonic()<deadline: page.wait_for_timeout(50)
                assert len(downloads)>index
                target=Path(tmp)/str(index); downloads[index].save_as(target)
                assert hashlib.sha256(target.read_bytes()).digest()==hashlib.sha256(expected).digest()
            card.click(button='right'); page.get_by_role('menuitem',name='下载副本').click()
            for i,fixture in enumerate(fixtures): verify(i,fixture[3])
            expect(page.get_by_role('dialog',name='下载副本')).to_have_count(0)
            expect(page.locator('#detail-drawer')).not_to_have_class(__import__('re').compile(r'.*open.*'))
            card.click(); page.locator('.detail-visual-thumb').nth(1).click()
            expect(page.locator('.detail-visual-actions button')).to_have_text(['下载副本','设为主图','移除媒体'])
            page.locator('.detail-visual-actions').get_by_role('button',name='下载副本').click()
            verify(5,fixtures[1][3])
            page.locator('.detail-visual-actions').get_by_role('button',name='下载副本').click()
            verify(6,fixtures[1][3])
            paths=page.evaluate("async()=> (await chrome.downloads.search({})).map(d=>d.filename)")
            assert len(paths)==len(set(paths)), paths
        # Locating from an open detail changes only the sidebar.
        page.locator('#detail-content').evaluate("node=>node.dataset.stabilityProbe='kept'")
        page.locator('.detail-project-summary-text').click()
        expect(page.locator('#detail-content')).to_have_attribute('data-stability-probe','kept')
        expect(page.locator('#detail-drawer')).to_have_class(__import__('re').compile(r'.*open.*'))
        page.get_by_role('button',name='关闭详情',exact=True).click()
        page.locator('#search-input').fill('快捷测试')
        expect(page.locator('#case-list > .case-card')).to_have_count(1)
        page.locator('#project-search').fill('不存在的项目')
        before=page.evaluate("""()=>{document.querySelector('.case-card').dataset.probe='same';return {url:location.href,scroll:scrollY,count:history.length};}""")
        card.click(button='right'); page.get_by_role('menuitem',name='定位项目').click()
        expect(card).to_have_attribute('data-probe','same')
        expect(page.locator('#search-input')).to_have_value('快捷测试')
        expect(page.locator('#project-search')).to_have_value('')
        after=page.evaluate("()=>({url:location.href,scroll:scrollY,count:history.length})")
        assert before==after,(before,after)
        def check_alignment():
            bounds=page.evaluate("""()=>{const row=document.querySelector('.project-located');const tools=document.querySelector('.project-tree-tools');
              return {target:row.getBoundingClientRect().top,header:tools.getBoundingClientRect().bottom,scroll:document.querySelector('#filter-sidebar').scrollTop};}""")
            assert abs(bounds['target']-bounds['header'])<2,bounds
            assert bounds['scroll']>0,bounds
        check_alignment()
        expect(page.locator('.project-located')).to_have_attribute('data-collection-id','project-quick')
        expect(page.locator('.project-located .project-filter')).to_have_attribute('aria-pressed','false')
        page.screenshot(path='/tmp/pd-project-locate-revised.png')
        # Same behavior for a project in the middle and at the top of the tree.
        for project_id in ['p20','p0']:
            page.evaluate("""async id=>{const {organizerState}=await chrome.storage.local.get('organizerState');
              for(const project of organizerState.collections) project.entryIds=project.id===id?['quick-case']:[];
              await chrome.storage.local.set({organizerState});}""",project_id)
            page.reload(wait_until='networkidle')
            card.click(button='right'); page.get_by_role('menuitem',name='定位项目').click(); check_alignment()
        # Project management selects only the right-clicked case and reuses the top menu.
        page.locator('#search-input').fill('')
        expect(page.locator('#case-list > .case-card')).to_have_count(2)
        page.locator('#select-cases').click()
        page.locator('[data-entry-id="quick-other"].case-card').click(); card.click()
        page.locator('#case-list').evaluate("node=>node.dataset.probe='same-wall'")
        card.click(button='right'); page.get_by_role('menuitem',name='项目管理').click()
        expect(page.locator('#selection-project-menu')).to_have_attribute('open','')
        expect(page.locator('#share-count')).to_have_text('已选 1')
        expect(card).to_have_class(__import__('re').compile(r'.*selected-for-share.*'))
        expect(page.locator('[data-entry-id="quick-other"].case-card')).not_to_have_class(__import__('re').compile(r'.*selected-for-share.*'))
        expect(page.locator('#case-list')).to_have_attribute('data-probe','same-wall')
        expect(page.locator('#detail-drawer')).not_to_have_class(__import__('re').compile(r'.*open.*'))
        page.locator('#selection-project-target').select_option('p1')
        page.locator('#selection-add-project').click()
        expect(page.locator('#share-bar')).to_be_hidden()
        memberships=page.evaluate("async()=> (await chrome.storage.local.get('organizerState')).organizerState.collections.find(p=>p.id==='p1').entryIds")
        assert memberships==['quick-case'],memberships
        # Multiple memberships select a path without filtering the gallery.
        card.click(button='right'); page.get_by_role('menuitem',name='定位项目').click()
        expect(page.get_by_role('menuitem')).to_have_count(2)
        page.get_by_role('menuitem',name='项目1',exact=True).click(); check_alignment()
        other_card=page.locator('[data-entry-id="quick-other"].case-card')
        other_card.click(button='right'); page.get_by_role('menuitem',name='定位项目').click()
        expect(page.locator('#workspace-unassigned')).to_have_class(__import__('re').compile(r'.*project-located.*'))
        expect(page.locator('#case-list > .case-card')).to_have_count(2)
        # Moving removes only the current project membership, retaining other projects.
        page.locator('[data-collection-id="p1"] .project-filter').click()
        card.click(button='right'); page.get_by_role('menuitem',name='项目管理').click()
        page.locator('#selection-project-target').select_option('p2')
        page.locator('#selection-move-project').click()
        expect(page.locator('#share-bar')).to_be_hidden()
        memberships=page.evaluate("async()=> (await chrome.storage.local.get('organizerState')).organizerState.collections.filter(p=>p.entryIds.includes('quick-case')).map(p=>p.id)")
        assert set(memberships)=={'p0','p2'},memberships
        page.locator('#workspace-library').click()
        expect(page.locator('#case-list > .case-card')).to_have_count(2)
        # Batch takeout still uses Share, without a separate download command.
        page.locator('#select-cases').click(); card.click(); other_card.click()
        page.locator('#selection-more-menu > summary').click()
        page.locator('#share-export').click()
        expect(page.locator('#share-dialog')).to_be_visible()
        page.locator('#share-dialog-close').click(); page.locator('#share-cancel').click()
        # The current shared-case export remains the existing dialog.
        card.click(button='right'); page.get_by_role('menuitem',name='导出案例').click()
        expect(page.locator('#share-dialog')).to_be_visible(); page.locator('#share-dialog-close').click()
        # Missing file does not prevent the other originals downloading.
        page.evaluate("async()=>{const {deleteMediaBlob}=await import(chrome.runtime.getURL('media-store.js'));await deleteMediaBlob('quick-1')}")
        before_count=len(downloads)
        card.click(button='right'); page.get_by_role('menuitem',name='下载副本').click()
        expect(page.locator('#feedback')).to_contain_text('original.avif',timeout=20000)
        expect(page.locator('#feedback')).to_contain_text('缺失')
        assert len(downloads)==before_count+4,(len(downloads),before_count)
        # Hidden sidebar opens through the established responsive behavior.
        page.set_viewport_size({'width':390,'height':844})
        expect(page.locator('.workspace')).to_have_class(__import__('re').compile(r'.*filters-collapsed.*'))
        other_card.click(button='right'); page.get_by_role('menuitem',name='定位项目').click()
        expect(page.locator('.workspace')).not_to_have_class(__import__('re').compile(r'.*filters-collapsed.*'))
        assert not session.page_errors, session.page_errors
        print({'direct_original_hashes':5,'no_picker':True,'single_media':True,'same_name_safe':True,
          'sidebar_top_middle_bottom':True,'gallery_unchanged':True,'detail_retained':True,'project_management':True,
          'multiple_and_unassigned':True,'partial_failure_continues':True,'responsive_sidebar':True})

if __name__=='__main__': main()
