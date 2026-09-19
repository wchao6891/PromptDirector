"""Replay Midjourney detail and feed DOM with observed media URL shapes."""
from e2e_support import extension_session

JOB='5fad7004-2cf7-4480-a037-5c187e33dfb1'
VIDEO='d5901844-7fe3-4c50-b901-f5f51c731723'

def main():
    with extension_session('midjourney-capture-') as run:
        setup=run.open_page('collector.html')
        funcs=setup.evaluate("""async()=>({collect:(await import('./page-capture-site-adapters.js')).collectPageCaptureSitePayload.toString()})""")
        page=run.context.new_page()
        def read(url,html):
            run.context.route(url,lambda route:route.fulfill(body=html,content_type='text/html'))
            page.goto(url)
            raw=page.evaluate('options=>('+funcs['collect']+')(options)',{'maxMedia':24,'maxCandidates':100,'maxTextCharacters':30000})
            return setup.evaluate("async raw=>(await import('./page-capture-site-adapters.js')).normalizePageCaptureSitePayload(raw)",raw)
        sidebar='<aside><a href="/@artist">Artist</a><div class="notranslate"><p>Full original prompt</p></div><button><span>--ar 3:4</span><span>ar 3:4</span></button><button title="Style Reference (--sref)"><img alt="https://s.mj.run/reference" src="https://s.mj.run/reference?thumb=true"></button><button>Copy Prompt</button></aside>'
        image=read(f'https://www.midjourney.com/jobs/{JOB}?index=2',f'<img src="https://cdn.midjourney.com/{JOB}/0_0_640_N.webp"><img src="https://cdn.midjourney.com/{JOB}/0_2_640_N.webp"><img src="https://cdn.midjourney.com/{JOB}/0_2.jpeg">'+sidebar)
        candidate=image['candidates'][0]
        assert len(candidate['media'])==1 and candidate['media'][0]['url'].endswith('/0_2.jpeg'),image
        assert candidate['contentText']=='Full original prompt --ar 3:4 --sref https://s.mj.run/reference',candidate
        assert candidate['sourceFacts']['itemId']==JOB+':2'
        video=read(f'https://www.midjourney.com/jobs/{VIDEO}?index=0',f'<video src="https://cdn.midjourney.com/video/{VIDEO}/0.mp4"></video><video src="https://cdn.midjourney.com/video/{VIDEO}/0.mp4" poster="https://cdn.midjourney.com/video/{VIDEO}/0_640_N.webp"></video>'+sidebar)
        assert video['candidates'][0]['media'][0]['kind']=='video',video
        assert video['candidates'][0]['media'][0]['posterUrl'].endswith('/0_640_N.webp'),video
        feed=read('https://www.midjourney.com/explore?tab=top',f'<a href="/jobs/{JOB}?index=2" style="background-image:image-set(url(https://cdn.midjourney.com/{JOB}/0_2_384_N.webp) 1x,url(https://cdn.midjourney.com/{JOB}/0_2_640_N.webp) 2x)"></a>')
        assert len(feed['candidates'])==1 and not feed['candidates'][0]['sourceFacts']['originalPromptAvailable'],feed
        assert feed['candidates'][0]['media'][0]['url'].endswith('640_N.webp'),feed
        print({'selectedImageOnly':True,'videoOriginal':True,'promptParametersReferences':True,'feedPartialPreviewHonest':True})

if __name__=='__main__':main()
