"""Run the production DOM scanner on a synthetic X conversation in an isolated browser."""
from playwright.sync_api import expect
from e2e_support import extension_session

URL = 'https://x.com/director/status/123'
HTML = '''<!doctype html><html><head><link rel="canonical" href="https://x.com/director/status/123"></head><body><main>
<article data-testid="tweet">
<div data-testid="User-Name"><a href="/director"><span>Director</span></a><a href="/director">@director</a></div>
<button>Subscribe</button><button>Show translation</button>
<div data-testid="tweetText">Main filmmaking notes: preserve clear positions and continuous action. Subscribe is a word in this author's sentence and must survive. <a href="https://example.com/prompt-notes">Reference notes</a></div>
<video poster="https://pbs.twimg.com/main.jpg" style="width:600px;height:340px"></video>
<div role="link" tabindex="0"><div data-testid="User-Name"><a href="/other"><span>Other author</span></a></div>
<a href="/other/status/456"><time datetime="2026-09-05T00:00:00Z">Old quote date</time></a>
<div data-testid="tweetText">Quoted filmmaking reference: preserve this separate source and its genuine second video.</div>
<video poster="https://pbs.twimg.com/quote.jpg" style="width:600px;height:340px"></video></div>
<a href="/director/status/123"><time datetime="2026-09-07T00:00:00Z">Main post date</time></a>
<a href="/director/status/123/analytics">Views 9000</a><a href="/director/status/123/quotes">View quotes</a>
<button data-testid="like">123</button><button data-testid="retweet">45</button>
</article>
<article data-testid="tweet"><div data-testid="User-Name"><a href="/director"><span>Director</span></a></div>
<div data-testid="tweetText">Author prompt: generate a cinematic palace scene with six continuous shots.</div>
<button data-testid="tweet-text-show-more-link">Show more</button>
<a href="/director/status/124"><time datetime="2026-09-07T01:00:00Z">Reply date</time></a></article>
<article data-testid="tweet"><div data-testid="User-Name"><a href="/outsider"><span>Outsider</span></a></div>
<div data-testid="tweetText">UNRELATED COMMENT must not join the main case.</div><a href="/outsider/status/125"><time>Now</time></a></article>
</main></body></html>'''


def main():
    with extension_session('pd-x-extraction-') as run:
        run.context.route('https://x.com/**', lambda r:r.fulfill(body=HTML, content_type='text/html'))
        run.context.route('https://pbs.twimg.com/**', lambda r:r.abort())
        setup=run.open_page('collector.html')
        scanner=setup.evaluate("""async () => ({
          fn: (await import(chrome.runtime.getURL('page-capture.js'))).collectPageCaptureSnapshot.toString(),
          adapters: (await import(chrome.runtime.getURL('page-capture-adapter-registry.js'))).PAGE_CAPTURE_ADAPTERS
        })""")
        page=run.context.new_page();page.goto(URL)
        snapshot=page.evaluate('async options => ('+scanner['fn']+')(options)', {'adapters':scanner['adapters']})
        assert len(snapshot['candidates'])==1, snapshot
        c=snapshot['candidates'][0]
        assert c['canonicalUrl']==URL,c
        assert 'https://example.com/prompt-notes' in c['contentHtml'],c['contentHtml']
        assert c['sourceFacts']['publishedAt']=='2026-09-07T00:00:00Z',c['sourceFacts']
        assert c['sourceFacts']['author']=='Director',c['sourceFacts']
        assert 'Subscribe is a word' in c['contentText'],c['contentText']
        assert 'Quoted filmmaking' in c['contentText'],c['contentText']
        for noise in ['Show translation','Views 9000','View quotes','UNRELATED COMMENT','Author prompt:']:
            assert noise not in c['contentText'],(noise,c['contentText'])
        assert len(c['media'])==2 and all(m['kind']=='video' for m in c['media']),c['media']
        assert all(not m['url'] for m in c['media']),c['media'] # no invented video route
        assert c['media'][0]['originalWorkUrl'] == URL, c['media']
        assert c['media'][1]['quotedPostUrl'] == 'https://x.com/other/status/456', c['media']
        default_ids = setup.evaluate("async c=>(await import('./page-capture.js')).pageCaptureDefaultMediaIds(c)", c)
        assert default_ids == [c['media'][0]['id']], (default_ids, c['media'])
        # Current X quote cards can expose only a clickable container, with no public source URL.
        page.locator('[role="link"][tabindex="0"] a[href*="/status/"]').evaluate('(link) => link.removeAttribute("href")')
        unresolved = page.evaluate('async options => ('+scanner['fn']+')(options)', {'adapters':scanner['adapters']})['candidates'][0]
        assert unresolved['media'][1]['isQuoted'] and not unresolved['media'][1].get('quotedPostUrl'), unresolved['media']
        default_ids = setup.evaluate("async c=>(await import('./page-capture.js')).pageCaptureDefaultMediaIds(c)", unresolved)
        assert default_ids == [unresolved['media'][0]['id']], (default_ids, unresolved['media'])

        assert len(c['supplements'])==1 and c['supplements'][0]['partial'],c['supplements']
        normalized=setup.evaluate("""async snapshot => {
          const {normalizePageCaptureBatch, applyPageCaptureSelections} = await import(chrome.runtime.getURL('page-capture.js'));
          const candidate=snapshot.candidates[0];
          const batch=normalizePageCaptureBatch({...snapshot,status:'ready',selections:[{candidateId:candidate.id,includeText:true,selectedMediaIds:candidate.media.map(m=>m.id),mediaDecision:'confirmed'}]});
          return {batch, saved:applyPageCaptureSelections(batch)};
        }""",snapshot)
        assert len(normalized['batch']['candidates'][0]['supplements'])==1
        saved=normalized['saved'][0]
        assert len(saved['media'])==2,saved['media']
        doc='\n'.join(b.get('text','') for b in saved['articleDocument']['blocks'])
        assert 'Main filmmaking' in doc and 'Quoted filmmaking' in doc,doc
        assert 'View quotes' not in doc and 'Show translation' not in doc,doc
        # Real X carousel shape: NAV + transparent IMG + visible CSS background.
        carousel = '<nav>' + ''.join(f'<a href="/director/status/{post}/photo/{i}"><div style="width:200px;height:300px;background-image:url(https://pbs.twimg.com/media/{post}-{i}?format=jpg&amp;name=small)"><img alt="Prompt: portrait photography" src="https://pbs.twimg.com/media/{post}-{i}?format=jpg&amp;name=small" style="width:200px;height:300px;opacity:0"></div></a>' for post in [123,456] for i in range(1,5)) + '</nav>'
        page.locator('article[data-testid="tweet"]').first.evaluate('(root,html)=>root.insertAdjacentHTML("beforeend",html)', carousel)
        grouped=page.evaluate('async options => ('+scanner['fn']+')(options)', {'adapters':scanner['adapters']})['candidates'][0]
        images=[m for m in grouped['media'] if m['kind']=='image']
        assert len(images)==8, images
        assert len([m for m in images if m.get('quotedPostUrl')])==4, images
        selected_ids=setup.evaluate("async c=>(await import('./page-capture.js')).pageCaptureDefaultMediaIds(c)",grouped)
        assert len([m for m in images if m['id'] in selected_ids])==4, (selected_ids,images)
        print({'carousel_images':8,'main_default':4,'quoted_optional':4})
        # Use actual scanner output in the sidebar; mock only browser dispatch of this already-read fixture.
        setup.evaluate("""snapshot=>{
          window.captureSnapshot=snapshot;
          const contains=chrome.permissions.contains.bind(chrome.permissions);
          chrome.permissions.contains=async q=>q.origins?.includes('https://x.com/*')?true:contains(q);
          const query=chrome.tabs.query.bind(chrome.tabs);
          chrome.tabs.query=async q=>q.active?[{id:999,url:'https://x.com/director/status/123'}]:query(q);
          const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage=async m=>m.type==='START_PAGE_CAPTURE'?{ok:true,batch:{...window.captureSnapshot,status:'ready'}}:send(m);
        }""",snapshot)
        run.seed_storage(setup,{'entries':[],'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-07T00:00:00Z','clipboardIncluded':True}})
        setup.locator('#start-page-capture').click()
        expect(setup.locator('.page-capture-confirm')).to_be_visible()
        setup.locator('.page-capture-confirm').click()
        setup.locator('.page-capture-supplements > summary').click()
        setup.get_by_role('button',name='补入已显示内容',exact=True).click()
        expect(setup.locator('.page-capture-excerpt')).to_contain_text('Author prompt:')
        expect(setup.locator('.page-capture-supplements')).to_have_count(0)
        setup.locator('#page-capture-save-text-only').click()
        expect(setup.locator('#page-capture')).to_be_hidden(timeout=10000)
        entries=setup.evaluate("() => chrome.runtime.sendMessage({type:'GET_STATE'}).then(r=>r.entries)")
        assert len(entries)==1,entries
        for kept in ['Main filmmaking','Quoted filmmaking','Author prompt:']:
            assert kept in entries[0]['text'],(kept,entries[0]['text'])
        assert entries[0]['sourceFacts']['status']=='partial',entries[0]['sourceFacts']
        # Group additions are independently selectable and undoable in the production sidebar.
        setup.evaluate("candidate=>window.captureSnapshot={candidates:[candidate]}",grouped)
        setup.locator('#start-page-capture').click();setup.locator('.page-capture-confirm').click()
        expect(setup.locator('.page-capture-media-group').filter(has_text="引用帖 · 4 张图")).to_have_count(1)
        baseline=setup.locator('.page-capture-thumbnail').count()
        setup.locator('.page-capture-media-group').filter(has_text='引用帖 · 4 张图').get_by_role('button',name='加入这组',exact=True).click()
        expect(setup.locator('.page-capture-thumbnail')).to_have_count(baseline+4)
        setup.locator('#page-capture-undo-region').click()
        expect(setup.locator('.page-capture-thumbnail')).to_have_count(baseline)
        setup.locator('.page-capture-thumbnail-remove').first.click()
        expect(setup.locator('.page-capture-thumbnail')).to_have_count(baseline-1)
        setup.locator('#page-capture-undo-region').click()
        expect(setup.locator('.page-capture-thumbnail')).to_have_count(baseline)
        setup.locator('#page-capture-cancel').click()
        print({'group_add_undo':True,'single_media_remove_undo':True})
        # Explicit selection must outrank site auto-detection.
        page.evaluate("""() => {const text=document.querySelector('[data-testid=tweetText]');const r=document.createRange();r.selectNodeContents(text);getSelection().removeAllRanges();getSelection().addRange(r)}""")
        selection=page.evaluate('async options => ('+scanner['fn']+')(options)', {'adapters':scanner['adapters']})
        assert len(selection['candidates'])==1,selection
        assert 'Quoted filmmaking' not in selection['candidates'][0]['contentText'],selection
        assert not selection['candidates'][0]['media'],selection
        print({'saved_reply_readback':True,'selection_scope':True,'x_primary_scope':True,'quote_preserved':True,'two_real_videos_only':True,'own_date':True,'optional_author_reply':True,'partial_reply_explicit':True})

if __name__=='__main__':main()
