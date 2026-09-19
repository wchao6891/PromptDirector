"""Synthetic capture inputs, real save/readback and detail UI; no user library or network."""
import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session


def main():
    with extension_session('capture-classification-detail-', viewport={'width':1280,'height':844}) as run:
        page=run.open_page('collector.html')
        run.seed_storage(page, {'entries': [], 'uiPreferences': {'locale':'zh-CN','motion':'reduced'}})
        results=page.evaluate('''async()=>{
          const {saveScreenshotBlob}=await import('./image-store.js');
          const {normalizePageCaptureBatch,applyPageCaptureSelections}=await import('./page-capture.js');
          const {classifyCapturedContent}=await import('./classifier.js');
          const canvas=document.createElement('canvas');canvas.width=720;canvas.height=960;
          const ctx=canvas.getContext('2d');ctx.fillStyle='#476f87';ctx.fillRect(0,0,720,960);
          await saveScreenshotBlob('classification-image',await new Promise(r=>canvas.toBlob(r)));
          const results=[];
          for (const [id,text,pageType,manual] of [
            ['image-text','海面薄雾，孤舟行驶。\\n'.repeat(400),'artwork',false],
            ['image-only','','artwork',false],
            ['document','教程：第一步明确主体，第二步说明为什么这个方法适用于不同场景。','article',false],
            ['manual','海面薄雾，孤舟行驶。','artwork',true],
            ['video-text','图片参考，海面薄雾，孤舟行驶。','artwork',false],
            ['video-only','','artwork',false],
            ['platform-video','Prompt: create a cinematic video. 视频简介','video',false],
            ['platform-image','Prompt: portrait. 作品简介','artwork',false],
            ['platform-aigc','','artwork',false]]) {
            const sourceUrl=id==='platform-video'?'https://www.youtube.com/watch?v=fixture1234':id==='platform-image'?'https://www.pinterest.com/pin/123':id==='platform-aigc'?'https://www.midjourney.com/jobs/123':'https://example.com/'+id;
            const media=[{id:'image',kind:'image',localAssetId:'classification-image',width:720,height:960},
              ...(id.startsWith('video-')?[{id:'video',kind:'video',url:'https://www.youtube.com/watch?v=fixture1234',width:720,height:960}]:[])];
            const batch=normalizePageCaptureBatch({id,sourceUrl,
              candidates:[{id,title:id,canonicalUrl:sourceUrl,pageType,contentText:text,
                textBlocks:text?[{id:'text',kind:'section',text}]:[],
                media,
                sourceFacts:{provider:'example.com',pageType,extractionMethod:'dom'}}],
              selections:[{candidateId:id,includeText:true,selectedTextBlockIds:text?['text']:[],selectedMediaIds:media.map(m=>m.id),mediaDecision:'confirmed'}]});
            const candidate=applyPageCaptureSelections(batch)[0];
            const preview=classifyCapturedContent({url:candidate.canonicalUrl,text:candidate.contentText,sourceFacts:candidate.sourceFacts,mediaAssets:candidate.media});
            const result=await chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch,
              ...(manual?{contentTypeExplicit:true,contentTypeId:'content:video-case'}:{})});
            if (!result.ok || !result.results?.[0]?.entryId) throw new Error(JSON.stringify(result));
            const stored=await chrome.storage.local.get('entries');
            const entry=stored.entries.find(e=>e.id===result.results[0].entryId);
            results.push({id,preview:preview.pathIds[0],saved:entry.classification.pathIds[0],entryId:entry.id});
          }
          return results;
        }''')
        assert [r['saved'] for r in results]==['content:prompt:image','content:image-case','content:reference','content:video-case','content:prompt:video','content:video-case','content:video-case','content:image-case','content:prompt:image'],results
        assert all(r['saved']==r['preview'] for r in results if r['id']!='manual'),results
        page.goto(f'chrome-extension://{run.extension_id}/library.html')
        page.locator(f'.case-card[data-entry-id="{results[0]["entryId"]}"]').click()
        separator=page.get_by_role('separator',name='调整图文分栏宽度')
        expect(separator).to_be_visible()
        body=page.locator('.detail-primary > .detail-body')
        before=body.bounding_box()
        box=separator.bounding_box()
        page.mouse.move(box['x']+4,box['y']+100)
        page.mouse.down();page.mouse.move(box['x']-110,box['y']+100,steps=10);page.mouse.up()
        page.wait_for_function('async()=>!!(await chrome.storage.local.get("uiPreferences")).uiPreferences.detailPanelRatio')
        after=body.bounding_box()
        assert after['width']>before['width']+90,(before,after)
        separator.focus();separator.press('ArrowLeft')
        page.wait_for_function('(width)=>document.querySelector(".detail-primary > .detail-body").getBoundingClientRect().width>width+10',arg=after['width'])
        gallery=page.locator('.detail-primary > .detail-visual-gallery')
        media_before=gallery.bounding_box()
        expand=body.get_by_role('button',name='展开全文',exact=True)
        if expand.count(): expand.first.click()
        body.evaluate('e=>e.scrollTop=e.scrollHeight')
        assert body.evaluate('e=>e.scrollTop>0 && e.clientHeight<=innerHeight'), 'long prompt must scroll within viewport'
        assert abs(gallery.bounding_box()['y']-media_before['y'])<1
        saved_width=body.bounding_box()['width']
        page.get_by_role('button',name='关闭详情',exact=True).click()
        page.locator(f'.case-card[data-entry-id="{results[0]["entryId"]}"]').click()
        expect(separator).to_be_visible()
        page.wait_for_function('(w)=>Math.abs(document.querySelector(".detail-primary > .detail-body").getBoundingClientRect().width-w)<2',arg=saved_width)
        out=Path(os.environ.get('PD_TEST_SCREENSHOTS','/tmp/pd-capture-detail'))
        out.mkdir(parents=True,exist_ok=True)
        for theme in ['dark','light']:
            page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
            for width in [1280,900,390]:
                page.set_viewport_size({'width':width,'height':844})
                page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth')
                if width==390:
                    expect(separator).not_to_be_visible()
                    assert body.evaluate('e=>getComputedStyle(e).overflowY')=='visible'
                else: expect(separator).to_be_visible()
                page.screenshot(path=str(out/f'detail-{theme}-{width}.png'))
        assert not run.page_errors,run.page_errors
        print({'classificationReadback':results,'splitDragKeyboardRememberScroll':True,'screenshots':str(out)})

if __name__=='__main__': main()
