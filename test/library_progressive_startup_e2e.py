"""The real gallery shell and first cases stay usable while the remaining case read is held.

Only an isolated profile's page reads are delayed. The library, click handlers, detail view and
search are real; a unique word in the oldest case distinguishes incomplete search from no match.
"""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session
from library_incremental_refresh_e2e import SEED

COUNT = 120
FIRST_BATCH_SIZE = 24  # Current gallery PAGE_SIZE; the remainder is held immediately after this batch.
TAIL_WORD = '渐进加载尾部独有搜索词'

HOLD_TAIL_READ = """() => {
  if (!location.pathname.endsWith('/library.html')) return;
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  const heldCase = new URLSearchParams(location.search).get('pdHoldCase') || sessionStorage.getItem('pd.test.progressiveHoldCase');
  const heldRecord = heldCase ? 'case:' + heldCase : '__PD_FIRST_UNREAD_RECORD__';
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  window.pdProgressiveRead = { blocked: false, released: false, requests: [], release: () => {
    window.pdProgressiveRead.released = true; release();
  }};
  chrome.storage.local.get = async (keys, ...args) => {
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
    const records = names.filter(key => key.startsWith('case:'));
    if (records.length) window.pdProgressiveRead.requests.push(records);
    if (keys == null || names.includes(heldRecord)) {
      window.pdProgressiveRead.blocked = true;
      await gate;
    }
    return get(keys, ...args);
  };
}"""

SNAPSHOT = """() => {
  const visible = node => Boolean(node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
    && getComputedStyle(node).display !== 'none');
  const topbar = document.querySelector('.topbar');
  const search = document.querySelector('#search-input');
  const rect = search.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return {
    state: document.body.dataset.libraryState,
    shellVisible: visible(topbar), searchVisible: visible(search), searchReceivesClicks: hit === search,
    cards: [...document.querySelectorAll('#case-list .case-card')].filter(visible).map(card => card.dataset.entryId),
    statuses: [...document.querySelectorAll('[role=status]')].filter(visible).map(node => node.textContent.trim()).filter(Boolean),
    emptyShown: visible(document.querySelector('#empty-filter')) || visible(document.querySelector('#empty-library')),
    blocked: window.pdProgressiveRead.blocked, released: window.pdProgressiveRead.released,
    recordReadSizes: window.pdProgressiveRead.requests.map(request => request.length)
  };
}"""


def main():
    evidence = Path(tempfile.mkdtemp(prefix='pd-progressive-startup-evidence-'))
    with extension_session('pd-progressive-startup-', viewport={'width': 1440, 'height': 900}) as run:
        setup = run.open_page('collector.html')
        setup.evaluate(SEED, COUNT)
        setup.evaluate("""async word => {
          const {getLibraryStorage}=await import('./library-storage.js');const store=getLibraryStorage();
          const {entries}=await store.get('entries'); entries.reverse(); entries.find(entry=>entry.id==='case-0').text=word;
          const first=entries[0];first.sourceFacts={originalPromptAvailable:true};
          first.mediaAssets=[{id:'first-preview',kind:'image',usage:'content',storageMode:'managed',mimeType:'image/png',width:320,height:180}];
          first.primaryMediaId='first-preview';
          const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
          const context=canvas.getContext('2d');context.fillStyle='#26355e';context.fillRect(0,0,320,180);
          context.fillStyle='#e7ca75';context.beginPath();context.arc(240,52,25,0,Math.PI*2);context.fill();
          context.fillStyle='#58857e';context.beginPath();context.moveTo(0,180);context.lineTo(95,62);context.lineTo(195,180);context.fill();
          context.fillStyle='#405f58';context.beginPath();context.moveTo(115,180);context.lineTo(222,87);context.lineTo(320,180);context.fill();
          const {saveMediaBlob}=await import('./media-store.js');
          await saveMediaBlob('first-preview',await new Promise(resolve=>canvas.toBlob(resolve,'image/png')));
          await store.set({entries,dataSafetyOnboardingSeen:true,uiPreferences:{locale:'zh-CN',motion:'reduced'}});
        }""", TAIL_WORD)
        run.context.add_init_script('(' + HOLD_TAIL_READ.replace('__PD_FIRST_UNREAD_RECORD__', f'case:case-{COUNT-FIRST_BATCH_SIZE-1}') + ')()')
        page = run.open_page('library.html')
        page.wait_for_function('() => window.pdProgressiveRead?.blocked')
        snapshot = page.evaluate(SNAPSHOT)
        print(json.dumps({'before_release': snapshot, 'evidence': str(evidence)}, ensure_ascii=False), flush=True)
        page.screenshot(path=str(evidence / 'held-tail-read.png'))
        try:
            expect(page.locator('.topbar')).to_be_visible(timeout=1000)
            expect(page.locator('#search-input')).to_be_visible(timeout=1000)
            assert page.evaluate(SNAPSHOT)['searchReceivesClicks'], 'a full-screen loading layer still intercepts the visible shell'
            first = page.locator(f'#case-list .case-card[data-entry-id="case-{COUNT-1}"]')
            expect(first).to_be_visible(timeout=1000)
            page.wait_for_function('''() => {const image=document.querySelector('#case-list img[data-visual-id="first-preview"]');
              return image?.complete && image.naturalWidth > 0;}''',timeout=3000)
            page.screenshot(path=str(evidence / 'first-batch-real-preview.png'))
            assert page.locator('#case-list .case-card').count() == FIRST_BATCH_SIZE, 'the first page must be usable before any later batch arrives'
            snapshot = page.evaluate(SNAPSHOT)
            assert snapshot['state'] == 'partial' and snapshot['statuses'], 'partial cases need a visible, truthful loading status'
            assert not snapshot['released'], 'first cases must work before the rest of the library arrives'
            first.click()
            expect(page.locator('#detail-drawer')).to_have_attribute('aria-hidden', 'false')
            expect(page.locator('.detail-title')).to_have_text(f'增量案例{COUNT-1}')
            expect(page.locator('.prompt-read-body')).to_contain_text(f'第{COUNT-1}条参考内容')
            editor = page.locator('.entry-editor-inline')
            editor.locator('summary').click()
            draft = editor.locator('.entry-edit-row input').first
            draft.fill('补齐资料期间保留的标题草稿')
            draft.evaluate('node=>window.pdFirstDraft=node')
            page.screenshot(path=str(evidence / 'partial-detail-and-draft.png'))
            page.evaluate('() => window.pdProgressiveRead.release()')
            expect(page.locator('body')).to_have_attribute('data-library-state', 'ready')
            expect(draft).to_have_value('补齐资料期间保留的标题草稿')
            assert draft.evaluate('node=>node===window.pdFirstDraft'), 'finishing startup must not replace an active editor'
            page.screenshot(path=str(evidence / 'ready-detail-draft-preserved.png'))
            page.close()
            # A fresh partial page independently proves a tail-only query does not become a false empty result.
            page = run.open_page('library.html')
            page.wait_for_function('() => window.pdProgressiveRead?.blocked')
            expect(page.locator('body')).to_have_attribute('data-library-state', 'partial')
            page.locator('#search-input').fill(TAIL_WORD)
            # One frame pair drains the input render; the held read cannot accidentally finish.
            page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            pending = page.evaluate(SNAPSHOT)
            assert not pending['released'] and pending['statuses'], pending
            assert not pending['emptyShown'], 'a query over unread cases must not claim there are no matches'
            page.screenshot(path=str(evidence / 'partial-search-waiting.png'))
            page.evaluate('() => window.pdProgressiveRead.release()')
            expect(page.locator('#case-list .case-card')).to_have_count(1)
            expect(page.locator('#case-list .case-card')).to_have_attribute('data-entry-id', 'case-0')
            expect(page.locator('body')).to_have_attribute('data-library-state', 'ready')
            page.screenshot(path=str(evidence / 'ready-search-tail-result.png'))
            print(json.dumps({'pending_search': pending, 'tail_result': 'case-0', 'passed': True}, ensure_ascii=False), flush=True)
            page.close()
            verify_startup_boundaries(run, setup, evidence)
        except Exception:
            if not page.is_closed():
                print(json.dumps({'failure_state': page.evaluate(SNAPSHOT)}, ensure_ascii=False), flush=True)
            raise
        finally:
            if not page.is_closed():
                page.evaluate('() => window.pdProgressiveRead.release()')


def verify_startup_boundaries(run, setup, evidence):
    project_ids = [f'case-{index}' for index in range(35, -1, -1)]
    created = setup.evaluate("() => chrome.runtime.sendMessage({type:'CREATE_COLLECTION',name:'尾部案例项目'})")
    assert created['ok'], created
    project_id = created['created']['id']
    assigned = setup.evaluate("message => chrome.runtime.sendMessage(message)", {
        'type': 'REPLACE_COLLECTION_ENTRIES', 'collectionId': project_id, 'entryIds': project_ids})
    assert assigned['ok'], assigned
    before = setup.evaluate("async()=> (await chrome.storage.local.get('organizerState')).organizerState")
    project = run.open_page(f'library.html?project={project_id}&pdHoldCase=case-11')
    try:
        for route in ['url', 'session-return']:
            project.wait_for_function('() => window.pdProgressiveRead?.blocked')
            expect(project.locator('body')).to_have_attribute('data-library-state', 'partial')
            expect(project.locator('#library-title')).to_have_text('尾部案例项目')
            first_read = project.evaluate('window.pdProgressiveRead.requests[0]')
            assert first_read == ['case:' + item for item in project_ids[:FIRST_BATCH_SIZE]], first_read
            shown = project.locator('#case-list .case-card').evaluate_all('(cards)=>cards.map(card=>card.dataset.entryId)')
            assert set(shown) == set(project_ids[:FIRST_BATCH_SIZE]), shown
            assert not project.locator('.case-card[data-entry-id="case-0"]').count(), 'the project still has unread members'
            project.screenshot(path=str(evidence / f'project-{route}-partial.png'))
            project.evaluate('() => window.pdProgressiveRead.release()')
            expect(project.locator('body')).to_have_attribute('data-library-state', 'ready')
            expect(project.locator('#case-list .case-card')).to_have_count(len(project_ids))
            expect(project.locator('.case-card[data-entry-id="case-0"]')).to_have_count(1)
            if route == 'url':
                project.evaluate("sessionStorage.setItem('pd.test.progressiveHoldCase','case-11')")
                project.locator('#start-compose').click()
                project.wait_for_url('**/composer.html*')
                project.locator('.composer-library-exit').click()
                project.wait_for_url('**/library.html')
        after = setup.evaluate("async()=> (await chrome.storage.local.get('organizerState')).organizerState")
        assert after == before, 'partial project rendering must preserve every unread membership'
    finally:
        if not project.is_closed():
            project.evaluate('() => window.pdProgressiveRead?.release()')
            project.close()

    combined = setup.evaluate("() => chrome.runtime.sendMessage({type:'CREATE_COMPOUND_CASE',title:'跨批次完整组合',memberEntryIds:['case-119','case-80']})")
    assert combined['ok'], combined
    compound_id = combined['compoundCase']['id']
    compound = run.open_page('library.html')
    try:
        compound.wait_for_function('() => window.pdProgressiveRead?.blocked')
        expect(compound.locator('body')).to_have_attribute('data-library-state', 'partial')
        group = compound.locator(f'.case-card[data-entry-id="{compound_id}"]')
        expect(group).to_be_visible()
        expect(compound.locator('.case-card[data-entry-id="case-119"], .case-card[data-entry-id="case-80"]')).to_have_count(0)
        read_ids = compound.evaluate('window.pdProgressiveRead.requests[0]')
        assert 'case:case-119' in read_ids and 'case:case-80' in read_ids, read_ids
        group.click()
        expect(compound.locator('.compound-part')).to_have_count(2)
        expect(compound.locator('.compound-part').nth(1)).to_contain_text('第80条参考内容')
        compound.screenshot(path=str(evidence / 'compound-cross-batch-complete.png'))
        compound.evaluate('() => window.pdProgressiveRead.release()')
        expect(compound.locator('body')).to_have_attribute('data-library-state', 'ready')
        expect(compound.locator('.compound-part')).to_have_count(2)
    finally:
        compound.evaluate('() => window.pdProgressiveRead.release()')
        compound.close()

    concurrent = run.open_page('library.html')
    try:
        concurrent.wait_for_function('() => window.pdProgressiveRead?.blocked')
        expect(concurrent.locator('body')).to_have_attribute('data-library-state', 'partial')
        expect(concurrent.locator('.case-card[data-entry-id="case-118"]')).to_have_count(1)
        renamed = setup.evaluate("() => chrome.runtime.sendMessage({type:'UPDATE_ENTRY_TITLE',entryId:'case-117',title:'载入期间另一页面的最新标题'})")
        assert renamed['ok'], renamed
        deleted = setup.evaluate("() => chrome.runtime.sendMessage({type:'DELETE_ENTRY',entryId:'case-118'})")
        assert deleted['ok'], deleted
        concurrent.evaluate('() => window.pdProgressiveRead.release()')
        expect(concurrent.locator('body')).to_have_attribute('data-library-state', 'ready')
        expect(concurrent.locator('.case-card[data-entry-id="case-117"]')).to_contain_text('载入期间另一页面的最新标题')
        expect(concurrent.locator('.case-card[data-entry-id="case-118"]')).to_have_count(0)
        concurrent.screenshot(path=str(evidence / 'concurrent-title-and-deletion-preserved.png'))
        print(json.dumps({'project_url_and_return_priority': True, 'unread_project_memberships_preserved': True,
                          'cross_batch_compound_complete': True, 'concurrent_edit_and_delete_preserved': True}, ensure_ascii=False), flush=True)
    finally:
        concurrent.evaluate('() => window.pdProgressiveRead.release()')
        concurrent.close()


if __name__ == '__main__':
    main()
