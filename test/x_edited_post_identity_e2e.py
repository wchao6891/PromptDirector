"""Edited X posts must stay independent through capture, deletion and recapture."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from base64 import b64decode
from e2e_support import extension_session


class PosterHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.end_headers()
        self.wfile.write(b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))

    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), PosterHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        verify(server.server_port)
    finally:
        server.shutdown()
        server.server_close()


def verify(port):
    with extension_session('pd-x-edited-identity-') as run:
        setup = run.open_page('collector.html')
        scanner = setup.evaluate("""async () => ({
          fn: (await import('./page-capture.js')).collectPageCaptureSnapshot.toString(),
          adapters: (await import('./page-capture-adapter-registry.js')).PAGE_CAPTURE_ADAPTERS
        })""")
        run.seed_storage(setup, {'entries': []})
        page = run.context.new_page()
        candidates = []
        for author, post_id in [('first', '101'), ('second', '202')]:
            url = f'https://x.com/{author}/status/{post_id}'
            html = f'''<html><head><link rel="canonical" href="{url}"></head><body><main>
              <article data-testid="tweet"><div data-testid="User-Name"><a href="/{author}">{author}</a></div>
              <div data-testid="tweetText">Independent creative prompt from {author}, belonging only to post {post_id}.</div>
              <video poster="http://127.0.0.1:{port}/{post_id}.png" style="width:600px;height:340px"></video>
              <a href="/{author}/status/{post_id}/history"><time datetime="2026-09-23T02:32:27Z">Last edited</time></a>
              </article></main></body></html>'''
            page.route(url, lambda route: route.fulfill(body=html, content_type='text/html'))
            page.goto(url)
            snapshot = page.evaluate('options => (' + scanner['fn'] + ')(options)', {'adapters': scanner['adapters']})
            candidate = snapshot['candidates'][0]
            candidates.append(candidate)
            result = save(setup, candidate)
            assert result['ok'], result
        entries = setup.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        print({'identities': [c['sourceFacts']['itemId'] for c in candidates], 'saved_cases': len(entries)}, flush=True)
        assert len(entries) == 2, 'Different edited posts were merged into one case'
        for candidate, post_id in zip(candidates, ['101', '202']):
            assert candidate['sourceFacts']['itemId'] == post_id, candidate
            assert candidate['canonicalUrl'].endswith('/status/' + post_id), candidate
            assert candidate['media'][0]['originalWorkUrl'] == candidate['canonicalUrl'], candidate
            assert not candidate['media'][0].get('quotedPostUrl'), candidate
        assert all(len([m for m in e['mediaAssets'] if m['kind'] == 'video']) == 1 for e in entries), entries
        # A reference-only video may retry media repair; it must reuse the case.
        assert save(setup, candidates[1])['results'][0]['entryId'] == entries[1]['id']
        assert setup.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.length") == 2
        deleted = entries[1]['id']
        result = setup.evaluate("id => chrome.runtime.sendMessage({type:'DELETE_ENTRY',entryId:id})", deleted)
        assert result['ok'], result
        assert save(setup, candidates[1])['ok']
        entries = setup.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        assert len(entries) == 2, entries
        recaptured = next(e for e in entries if e['sourceFacts']['itemId'] == '202')
        assert 'first' not in recaptured['text'] and recaptured['id'] != deleted, recaptured
        print({'different_authors_independent': True, 'delete_recapture_independent': True})

        # The real library has old mixed copies in several projects. Deleting one
        # copy must not cause recapture to adopt a surviving, unrelated old copy.
        old = {**entries[0], 'id': 'old-copy', 'url': 'https://x.com/first/status/101/history',
               'sourceFacts': {**entries[0]['sourceFacts'], 'itemId': 'history'}}
        removed = {**old, 'id': 'deleted-copy'}
        run.seed_storage(setup, {'entries': [old, removed], 'organizerState': {'collections': [
            {'id': 'elsewhere', 'name': 'Other project', 'entryIds': ['old-copy']},
            {'id': 'target', 'name': 'Capture project', 'entryIds': ['deleted-copy']}]}})
        assert setup.evaluate("() => chrome.runtime.sendMessage({type:'DELETE_ENTRY',entryId:'deleted-copy'})")['ok']
        before = setup.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        stale_candidate = {**candidates[1], 'canonicalUrl': candidates[1]['canonicalUrl'] + '/history',
                           'sourceFacts': {**candidates[1]['sourceFacts'], 'itemId': 'history'}}
        assert save(setup, stale_candidate, 'target')['ok']
        state = setup.evaluate("() => chrome.runtime.sendMessage({type:'GET_STATE'})")
        target = next(c for c in state['organizerState']['collections'] if c['id'] == 'target')
        assert len(target['entryIds']) == 1 and target['entryIds'][0] != 'old-copy', target
        assert next(e for e in state['entries'] if e['id'] == 'old-copy') == before[0]
        assert len(state['entries']) == 2, state['entries']
        print({'old_history_copy_unchanged': True, 'recapture_does_not_resurrect_other_copy': True})


def save(page, candidate, collection_id=''):
    return page.evaluate("""async ({candidate,collectionId}) => chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',collectionId,batch:{
      candidates:[candidate],selections:[{candidateId:candidate.id,includeText:true,selectedMediaIds:candidate.media.map(m=>m.id),mediaDecision:'confirmed'}]
    }})""", {'candidate': candidate, 'collectionId': collection_id})


if __name__ == '__main__':
    main()
