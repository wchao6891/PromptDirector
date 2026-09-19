"""Large tag catalog, fake model responses; real UI chunking, retry and atomic application."""
from playwright.sync_api import expect
from e2e_support import extension_session, ai_configuration_fixture

def main():
    with extension_session('tag-organization-') as run:
        setup=run.open_page('collector.html')
        run.seed_storage(setup,{'entries':[],**ai_configuration_fixture(providers={'deepseek':{'apiKey':'fixture','consent':True,'models':{'textTags':'deepseek-v4-flash'}}},assignments={'textTags':{'providerId':'deepseek','model':'deepseek-v4-flash'}})})
        count=setup.evaluate('''async()=>{
          const {createFixedFacetCatalog,createDetailOrganizationChunks}=await import('./tag-taxonomy.js');
          const facetCatalog=createFixedFacetCatalog();
          for(let i=0;i<400;i++)facetCatalog.nodes.push({id:'detail:'+i,name:'电影写实标签'+i,parentId:'style.render',facetId:'style',status:'active',kind:'detail',origin:'ai',order:i,aliases:[],patterns:[]});
          await chrome.storage.local.set({facetCatalog});return createDetailOrganizationChunks(facetCatalog).length;
        }''')
        page=run.open_page('library.html',wait_until='networkidle')
        page.evaluate('''()=>{
          window.calls=[];window.failOnce=true;const original=window.fetch;
          window.fetch=async(url,options)=>{
            if(!String(url).includes('api.deepseek.com'))return original(url,options);
            const body=JSON.parse(options.body);const chunk=JSON.parse(body.messages.at(-1).content);window.calls.push(chunk.d.map(r=>r[0]));
            if(window.calls.length===2&&window.failOnce){window.failOnce=false;return new Response(JSON.stringify({error:{message:'fixture length limit'}}),{status:400});}
            return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({m:[]})}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{status:200,headers:{'Content-Type':'application/json'}});
          };
        }''')
        if page.locator('#settings-dialog').is_visible(): page.locator('#settings-close').click()
        page.locator('#manage-facets').click();page.locator('[data-manager-tab="vocabulary"]').click()
        button=page.locator('#organize-detail-tags');button.click()
        dialog=page.locator('#promptdirector-app-dialog');expect(dialog).to_contain_text(f'{count} 次付费请求')
        dialog.get_by_role('button',name='确认并开始',exact=True).click()
        expect(page.locator('#organize-detail-status')).to_contain_text('HTTP 400')
        assert page.evaluate('window.calls.length')==2
        button.click();expect(dialog).to_contain_text(f'{count-1} 次付费请求')
        dialog.get_by_role('button',name='确认并开始',exact=True).click()
        expect(page.locator('#organize-detail-status')).to_contain_text('tokens')
        calls=page.evaluate('window.calls')
        assert len(calls)==count+1 and calls[0] not in calls[1:] and calls[1]==calls[2],calls
        print({'chunks':count,'failedChunkRetried':True,'successfulChunkNotRecharged':True,'noRealModelCalls':True})

if __name__=='__main__':main()
