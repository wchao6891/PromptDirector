"""Synthetic site-shaped comments; real picker, capture snapshot, collector and save/readback."""
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session
ROOT = Path(__file__).resolve().parents[1]

def main():
    with extension_session('video-comments-') as run:
        run.context.route('https://wchao6891.github.io/comments-fixture', lambda r:r.fulfill(content_type='text/html',body='<html><title>Fixture</title><body></body></html>'))
        source=run.context.new_page();source.goto('https://wchao6891.github.io/comments-fixture')
        source.evaluate('''()=>{
          document.body.innerHTML='<style>ytd-comments,ytd-comment-thread-renderer,ytd-comment-view-model,ytd-comment-replies-renderer{display:block;margin:8px}</style><nav>Do not collect navigation</nav><ytd-comments></ytd-comments>';
          document.querySelector('ytd-comments').innerHTML=Array.from({length:40},(_,i)=>`<ytd-comment-thread-renderer><ytd-comment-view-model><a id="author-text">Author ${i}</a><div id="content-text">Comment ${i} full text</div></ytd-comment-view-model>${i===0?'<ytd-comment-replies-renderer><div id="more-replies"><button>1 reply</button></div></ytd-comment-replies-renderer>':''}</ytd-comment-thread-renderer>`).join('');
          document.querySelector('button').onclick=e=>{e.target.remove();const r=document.createElement('ytd-comment-view-model');r.innerHTML='<a id="author-text">Reply author</a><div id="content-text">Expanded reply text</div>';document.querySelector('ytd-comment-replies-renderer').append(r);};
        }''')
        setup=run.open_page('collector.html')
        run.seed_storage(setup,{'entries':[],'uiPreferences':{'motion':'reduced'},'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-19T00:00:00Z'}})
        # Only auto-entry's source fixture is substituted; picker messages and save run in the extension.
        site=setup.evaluate('''async()=>{const {normalizeVideoPagePayload}=await import('./video-page-capture.js');return normalizeVideoPagePayload({adapter:'youtube',itemId:'Wh3zKB3_ZHw',canonicalUrl:'https://www.youtube.com/watch?v=Wh3zKB3_ZHw',title:'Primary video title',description:'Full video introduction',author:'Video author'},'https://www.youtube.com/watch?v=Wh3zKB3_ZHw');}''')
        page=run.context.new_page()
        import json
        page.add_init_script('''(()=>{const site=SITE;const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.permissions.contains=async()=>true;chrome.permissions.request=async()=>true;chrome.runtime.sendMessage=async m=>{if(m.type==='START_PAGE_CAPTURE')return {ok:true,batch:{id:'video',sourceUrl:'https://www.youtube.com/watch?v=Wh3zKB3_ZHw',candidates:site.candidates}};if(m.type==='TRY_ACTIVE_SELECTION_TO_DRAFT')return {ok:true,added:false};const result=await send(m);if(m.type==='COMMIT_PAGE_CAPTURE')window.commitResult=result;return result;};})()'''.replace('SITE',json.dumps(site)))
        source.bring_to_front()
        page.goto(f'chrome-extension://{run.extension_id}/collector.html')
        expect(page.locator('.page-capture-item.confirmed')).to_have_count(1)
        expect(page.locator('.page-capture-article')).to_contain_text('Full video introduction')
        expect(page.locator('.page-capture-article')).not_to_contain_text('Comment 0')
        source.bring_to_front()
        page.evaluate("()=>document.querySelector('#add-selection').click()")
        expect(source.locator('#promptdirector-content-picker')).to_be_attached()
        source.locator('#author-text').first.click()
        expect(page.locator('.page-capture-article')).to_contain_text('Expanded reply text')
        expect(page.locator('.page-capture-article')).to_contain_text('Comment 28 full text')
        expect(page.locator('.page-capture-article')).not_to_contain_text('Comment 29 full text')
        expect(page.locator('.page-capture-item')).to_have_count(1)
        expect(page.locator('.page-capture-item')).to_contain_text('Primary video title')
        expect(page.locator('.page-capture-article')).to_contain_text('Full video introduction')
        # Continuation is explicit: the user scrolls to later comments and selects again.
        source.bring_to_front()
        page.evaluate("()=>document.querySelector('#add-selection').click()")
        expect(source.locator('#promptdirector-content-picker')).to_be_attached()
        source.locator('#author-text').filter(has_text='Author 30').click()
        expect(page.locator('.page-capture-article')).to_contain_text('Comment 39 full text')
        page.locator('#page-capture-undo-region').click()
        expect(page.locator('.page-capture-article')).not_to_contain_text('Comment 39 full text')
        for theme in ['light','dark']:
            page.evaluate('(value)=>document.documentElement.dataset.theme=value',theme)
            for width in [390,1280]:
                page.set_viewport_size({'width':width,'height':844})
                page.screenshot(path=f'/tmp/pd-b12-comments-{theme}-{width}.png',full_page=True,animations='disabled')
        page.locator('#page-capture-save').click()
        try: expect(page.locator('#page-capture')).to_be_hidden(timeout=20000)
        except Exception:
            print(page.evaluate('()=>({commit:window.commitResult,body:document.body.innerText})'),flush=True)
            raise
        entries=page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        assert len(entries)==1,entries
        entry=entries[0]
        assert entry['title']=='Primary video title' and entry['sourceFacts']['author']=='Video author',entry
        assert 'Full video introduction' in entry['text'] and 'Expanded reply text' in entry['text'],entry
        assert len(entry['mediaAssets'])==1 and entry['mediaAssets'][0]['kind']=='video',entry
        assert 'Comment 29 full text' not in entry['text'] and 'Do not collect' not in entry['text'],entry
        assert 'captureWarnings' not in entry['sourceFacts'],entry
        print('PASS: video stays primary; comments opt-in; username selects comments; expanded reply included; 30 total cap; explicit continuation/undo; video+description+comments saved as one case')
        # Bilibili nested open shadow roots use the same bounded contract.
        source.evaluate('''()=>{
          document.body.innerHTML='<bili-comments></bili-comments>';
          const area=document.querySelector('bili-comments').attachShadow({mode:'open'});
          area.innerHTML='<bili-comment-thread-renderer></bili-comment-thread-renderer>';
          const thread=area.firstElementChild.attachShadow({mode:'open'});
          thread.innerHTML='<bili-comment-renderer></bili-comment-renderer>';
          const comment=thread.firstElementChild.attachShadow({mode:'open'});
          comment.innerHTML='<bili-comment-user-info></bili-comment-user-info><bili-rich-text></bili-rich-text>';
          comment.firstElementChild.attachShadow({mode:'open'}).innerHTML='<div id="user-name">Bili author</div>';
          comment.lastElementChild.attachShadow({mode:'open'}).innerHTML='<p id="contents">Bili complete comment<img alt="[笑]" src="data:,"></p>';
        }''')
        picker=(ROOT/'extension/page-content-picker.js').read_text().replace('export function','function',1)
        source.add_script_tag(content=picker)
        source.evaluate('()=>{window.picked=pickPageContent({commentLimit:30,timeoutMs:1000});}')
        source.locator('#user-name').click()
        result=source.evaluate('()=>window.picked')
        assert result['supplement']=='comments' and result['commentCount']==1 and 'Bili complete comment[笑]' in result['html'],result
        assert '<img' not in result['html'],result
        print('PASS: Bilibili shadow-root comment text/author/emoji, no avatar or extra media')

if __name__=='__main__':main()
