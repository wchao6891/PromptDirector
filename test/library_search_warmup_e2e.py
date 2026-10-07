"""The first real query is complete before idle work; idle preparation removes its build cost."""
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session
from library_incremental_refresh_e2e import SEED

COUNT = 1000
HOLD_IDLE = '''() => {
  const request=window.requestIdleCallback.bind(window),cancel=window.cancelIdleCallback.bind(window);
  const jobs=new Map();let held=true,id=0;
  const schedule=(key,job)=>{job.native=request(deadline=>{job.native=null;if(held)return;jobs.delete(key);job.callback(deadline)},job.options)};
  window.requestIdleCallback=(callback,options)=>{const key=++id,job={callback,options};jobs.set(key,job);schedule(key,job);return key};
  window.cancelIdleCallback=key=>{const job=jobs.get(key);if(job?.native!=null)cancel(job.native);jobs.delete(key)};
  window.pdReleaseIdle=()=>{held=false;for(const[key,job]of jobs)if(job.native==null)schedule(key,job)};
}'''


def query(page):
    page.evaluate('''() => {
      const started=performance.now(); const observer=new MutationObserver(()=>{
        const cards=document.querySelectorAll('#case-list .case-card');
        if(cards.length===1&&cards[0].dataset.entryId==='case-0'){window.pdQueryMs=performance.now()-started;observer.disconnect()}
      });observer.observe(document.querySelector('#case-list'),{childList:true,subtree:true});
      const input=document.querySelector('#search-input');input.value='unique-search-target';input.dispatchEvent(new Event('input',{bubbles:true}));
    }''')
    page.wait_for_function('() => Number.isFinite(window.pdQueryMs)')
    expect(page.locator('.case-card')).to_have_count(1)
    return page.evaluate('() => ({queryMs:pdQueryMs,indexed:window.pdIndexed})')


with tempfile.TemporaryDirectory(prefix='pd-search-warmup-source-') as directory:
    extension=Path(directory)
    for path in EXTENSION_DIR.iterdir():
        if path.name!='search-index.js':(extension/path.name).symlink_to(path,target_is_directory=path.is_dir())
    source=(EXTENSION_DIR/'search-index.js').read_text()
    needle='function indexEntry(entry, catalog, nodeById, documentTextByAsset, derivedMetadataByAsset) {'
    assert needle in source
    source=source.replace(needle,needle+'\n  globalThis.pdIndexed=(globalThis.pdIndexed||0)+1;')
    (extension/'search-index.js').write_text(source)
    with extension_session('pd-search-warmup-profile-',extension_dir=extension) as run:
        setup=run.open_page('collector.html');setup.evaluate(SEED,COUNT)
        setup.evaluate('''async()=>{const{getLibraryStorage}=await import('./library-storage.js');const store=getLibraryStorage();
          const{entries}=await store.get('entries');for(const entry of entries)entry.text='完整案例正文。'.repeat(600)+(entry.id==='case-0'?'unique-search-target':'');
          await store.set({entries,dataSafetyOnboardingSeen:true});}''')
        run.context.add_init_script('('+HOLD_IDLE+')()')
        immediate=run.open_page('library.html');immediate.wait_for_selector('body[data-library-state=ready]')
        assert immediate.evaluate('window.pdIndexed||0')==0, 'opening must not eagerly build search text'
        cold=query(immediate);assert cold['indexed']>=COUNT,cold
        immediate.close()
        idle=run.open_page('library.html');idle.wait_for_selector('body[data-library-state=ready]')
        assert idle.evaluate('window.pdIndexed||0')==0
        idle.evaluate('window.pdReleaseIdle()')
        idle.wait_for_function('(count)=>(window.pdIndexed||0)>=count',arg=COUNT)
        warm=query(idle)
        print({'cases':COUNT,'before_idle':cold,'after_idle':warm,'both_complete':True})
