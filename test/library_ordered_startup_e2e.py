"""Current sorting determines the first batch; loading more cases never reshuffles its cards.

Physical record order intentionally disagrees with every tested display order. Reads after the
first case batch are held, so sorting an incomplete batch cannot masquerade as correct startup.
"""
import argparse
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session
from library_incremental_refresh_e2e import SEED

COUNT = 96
FIRST_BATCH = 24  # Existing gallery PAGE_SIZE.
SORTS = ['added-desc', 'updated-desc', 'title', 'project-manual', 'title-to-added']

HOLD_AFTER_FIRST_BATCH = '''() => {
  if(!location.pathname.endsWith('/library.html'))return;
  const get=chrome.storage.local.get.bind(chrome.storage.local);let release;
  const gate=new Promise(resolve=>release=resolve);
  window.pdOrderedRead={requests:[],blocked:false,released:false,release:()=>{pdOrderedRead.released=true;release()}};
  chrome.storage.local.get=async(keys,...args)=>{
    const names=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys||{});
    const records=names.filter(key=>key.startsWith('case:'));
    if(records.length){pdOrderedRead.requests.push(records);if(pdOrderedRead.requests.length>1){pdOrderedRead.blocked=true;await gate}}
    return get(keys,...args);
  };
}'''


def main(modes):
    evidence = Path(tempfile.mkdtemp(prefix='pd-ordered-startup-evidence-'))
    failures = []
    with extension_session('pd-ordered-startup-', viewport={'width':1440,'height':900}) as run:
        setup=run.open_page('collector.html');setup.evaluate(SEED,COUNT)
        # Keep the physical index 0..95, while dates, titles and project order give independent ranks.
        setup.evaluate('''async count=>{
          const{getLibraryStorage}=await import('./library-storage.js');const store=getLibraryStorage();
          const{entries}=await store.get('entries');
          for(const[index,entry]of entries.entries()){
            entry.title='案例'+String((count-index+17)%count).padStart(3,'0');
            entry.libraryUpdatedAt=new Date(Date.UTC(2026,9,1,0,0,(index+32)%count)).toISOString();
            entry.mediaAssets=[{id:'order-image-'+index,kind:'image',usage:'content',storageMode:'managed',mimeType:'image/png',width:320,height:180}];
            entry.primaryMediaId='order-image-'+index;
          }
          const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');
          const{saveMediaBlob}=await import('./media-store.js');
          for(const[index,entry]of entries.entries()){
            ctx.fillStyle=`hsl(${index*137.5%360} 35% 28%)`;ctx.fillRect(0,0,320,180);
            ctx.fillStyle='#f5edcf';ctx.font='bold 42px sans-serif';ctx.fillText(String(index).padStart(2,'0'),25,108);
            await saveMediaBlob(entry.primaryMediaId,await new Promise(resolve=>canvas.toBlob(resolve,'image/png')));
          }
          const projectIds=[...entries.filter((_,i)=>i%2),...entries.filter((_,i)=>!(i%2))].map(entry=>entry.id).reverse();
          await store.set({entries,dataSafetyOnboardingSeen:true,
            organizerState:{collections:[{id:'order-project',name:'手动顺序项目',entryIds:projectIds,visibility:'library',parentId:null,order:0}]},
            uiPreferences:{locale:'zh-CN',motion:'reduced',gallerySort:'added-desc',galleryView:'waterfall'}});
        }''',COUNT)
        run.context.add_init_script('('+HOLD_AFTER_FIRST_BATCH+')()')
        for mode in modes:
            expected=setup.evaluate('''async mode=>{
              const{getLibraryStorage}=await import('./library-storage.js');const store=getLibraryStorage();
              const{entries,organizerState,uiPreferences}=await store.get(['entries','organizerState','uiPreferences']);
              await store.set({uiPreferences:{...uiPreferences,gallerySort:mode==='title-to-added'?'title':mode,galleryView:mode==='title-to-added'?'list':'waterfall'}});
              const{sortLibraryCases}=await import('./library-view.js');
              return sortLibraryCases(entries,{mode:mode==='title-to-added'?'added-desc':mode,projectEntryIds:organizerState.collections[0].entryIds}).map(entry=>entry.id);
            }''',mode)
            page=run.open_page('library.html'+('?project=order-project' if mode=='project-manual' else ''))
            try:
                page.wait_for_function('()=>window.pdOrderedRead?.blocked')
                expect(page.locator('body')).to_have_attribute('data-library-state','partial')
                page.wait_for_function('''()=>{const images=[...document.querySelectorAll('#case-list .case-card img[data-visual-id]')];
                  return images.length===24&&images[0].complete&&images[0].naturalWidth>1}''')
                expected_partial=expected[:FIRST_BATCH]
                if mode=='title-to-added':
                    initial_ids=page.locator('#case-list .case-card').evaluate_all('(cards)=>cards.map(card=>card.dataset.entryId)')
                    expected_partial=[]
                    for entry_id in expected:
                        if entry_id not in initial_ids:break
                        expected_partial.append(entry_id)
                    assert 0<len(expected_partial)<FIRST_BATCH, 'fixture must expose an incomplete new-sort prefix'
                    page.locator('button[data-sort-column="added"]').click()
                    expect(page.locator('#case-list .case-card')).to_have_count(len(expected_partial))
                    page.wait_for_function('''()=>{const image=document.querySelector('#case-list .case-card img[data-visual-id]');return image?.complete&&image.naturalWidth>1}''')
                before=page.evaluate('''expected=>{
                  const cards=[...document.querySelectorAll('#case-list .case-card')];
                  window.pdFirstCards=cards;window.pdFirstImages=cards.map(card=>card.querySelector('img[data-visual-id]'));
                  window.pdStableImages=pdFirstImages.filter(image=>image.complete&&image.naturalWidth>1);
                  window.pdFirstPositions=cards.map(card=>({x:card.getBoundingClientRect().x,y:card.getBoundingClientRect().y}));
                  window.pdSourceChanges=[];window.pdWrongPrefixes=[];
                  window.pdSourceObserver=new MutationObserver(changes=>{
                    for(const change of changes)if(pdStableImages.includes(change.target))pdSourceChanges.push(change.target.closest('.case-card')?.dataset.entryId);
                    const ids=[...document.querySelectorAll('#case-list .case-card')].slice(0,24).map(card=>card.dataset.entryId);
                    if(ids.some((id,index)=>id!==expected[index]))pdWrongPrefixes.push(ids)
                  });pdSourceObserver.observe(document.querySelector('#case-list'),{subtree:true,childList:true,attributes:true,attributeFilter:['src','srcset']});
                  return{ids:cards.map(card=>card.dataset.entryId),reads:pdOrderedRead.requests.map(ids=>ids.length),decodedPreviews:pdStableImages.length};
                }''',expected)
                page.screenshot(path=str(evidence/f'{mode}-partial.png'))
                page.evaluate('()=>pdOrderedRead.release()')
                expect(page.locator('body')).to_have_attribute('data-library-state','ready')
                # Startup preparation can queue an 80 ms external refresh; cover it and painting.
                page.wait_for_timeout(250)
                page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                after=page.evaluate('''()=>{
                  const first=[...document.querySelectorAll('#case-list .case-card')].slice(0,24);
                  const retained=first.slice(0,pdFirstCards.length);
                  return{ids:first.map(card=>card.dataset.entryId),sameNodes:retained.every((card,i)=>card===pdFirstCards[i]),
                    sameImages:retained.every((card,i)=>card.querySelector('img[data-visual-id]')===pdFirstImages[i]),
                    samePositions:retained.every((card,i)=>Math.abs(card.getBoundingClientRect().x-pdFirstPositions[i].x)<1&&Math.abs(card.getBoundingClientRect().y-pdFirstPositions[i].y)<1),
                    srcChanges:pdSourceChanges,wrongPrefixes:pdWrongPrefixes,
                    replacedIds:retained.filter((card,i)=>card!==pdFirstCards[i]).map(card=>card.dataset.entryId)};
                }''')
                page.screenshot(path=str(evidence/f'{mode}-complete.png'))
                reasons=[]
                if before['ids']!=expected_partial:reasons.append('first batch does not match the current full-library sort')
                if after['ids']!=expected[:FIRST_BATCH]:reasons.append('completed first page does not match the current sort')
                if not after['sameNodes'] or not after['sameImages']:reasons.append('loading more cases replaced or reordered first-page nodes')
                if not after['samePositions']:reasons.append('loading more cases moved first-page cards')
                if after['srcChanges']:reasons.append('loading more cases reassigned first-page image sources')
                if after['wrongPrefixes']:reasons.append('an intermediate render displayed the wrong sort prefix')
                result={'mode':mode,'expectedFirst':expected[:FIRST_BATCH],'expectedPartial':expected_partial,'before':before,'after':after,'failures':reasons,'evidence':str(evidence)}
                print(json.dumps(result,ensure_ascii=False),flush=True)
                failures.extend([mode+': '+reason for reason in reasons])
            finally:
                page.evaluate('()=>window.pdOrderedRead.release()');page.close()
    assert not failures,'; '.join(failures)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--sort',action='append',choices=SORTS)
    main(parser.parse_args().sort or SORTS)
