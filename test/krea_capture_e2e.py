"""Reduced Krea detail DOM fixtures; verifies source selection, not live-site availability."""
import json
from e2e_support import extension_session

URL = 'https://www.krea.ai/feed/work-554bfb91-2a06-5e91-8a21-24a162f3b81f'
ORIGINAL = 'https://gen.krea.ai/images/554bfb91-2a06-5e91-8a21-24a162f3b81f.png'
PREVIEW = 'https://optim-images.krea.ai/work-preview.webp'
REFERENCE = 'https://app-uploads.krea.ai/style.webp'
PROXY = 'https://www.krea.ai/api/img?i=https%3A%2F%2Fapp-uploads.krea.ai%2Fstyle.webp&s=128'
PROMPT = 'A cinematic silhouette in a carefully composed moonlit landscape.'
HTML = f'''<!doctype html><html><head><title>Krea fixture</title><link rel="canonical" href="{URL}">
<script type="application/ld+json">{json.dumps({'@type':'ImageObject','contentUrl':ORIGINAL,'url':URL,'width':768,'height':1376})}</script></head><body>
<article><h1>{PROMPT}</h1><figure><img src="{PREVIEW}" style="width:280px;height:500px"></figure>
<button aria-label="Copy style reference image 1" style="width:100px;height:100px;background-image:url('{PROXY}')"></button>
<a href="/feed/recommendation-72324387-04f9-526e-ae96-e132f34ab60c"><div style="width:200px;height:200px;background-image:url('https://optim-images.krea.ai/recommended.webp')"></div></a>
</article></body></html>'''


def main():
    with extension_session('krea-capture-') as run:
        run.context.route('https://www.krea.ai/feed/**', lambda route: route.fulfill(body=HTML, content_type='text/html'))
        setup = run.open_page('collector.html')
        functions = setup.evaluate("""async () => ({
          site: (await import('./page-capture-site-adapters.js')).collectPageCaptureSitePayload.toString(),
          scan: (await import('./page-capture.js')).collectPageCaptureSnapshot.toString(),
          adapters: (await import('./page-capture-adapter-registry.js')).PAGE_CAPTURE_ADAPTERS,
          limits: (await import('./resource-limits.js')).PAGE_CAPTURE_LIMITS,
          maxTextCharacters: (await import('./resource-limits.js')).PORTABLE_LIBRARY_LIMITS.maxLibraryJsonBytes
        })""")
        page = run.context.new_page()
        page.goto(URL)
        payload = page.evaluate('options => ('+functions['site']+')(options)', {'maxMedia':functions['limits']['maxMediaPerCandidate'],'maxCandidates':functions['limits']['maxCandidates'],'maxTextCharacters':functions['maxTextCharacters']})
        assert payload['styleReferences'][0]['url'] == REFERENCE, payload
        site = setup.evaluate("async p => (await import('./page-capture-site-adapters.js')).normalizePageCaptureSitePayload(p,p.canonicalUrl)", payload)
        snapshot = page.evaluate('options => ('+functions['scan']+')(options)', {'siteData':site,'adapters':functions['adapters']})
        assert len(snapshot['candidates']) == 1, snapshot
        candidate = snapshot['candidates'][0]
        assert [m['url'] for m in candidate['media']] == [ORIGINAL, REFERENCE], candidate
        assert candidate['contentText'] == PROMPT, candidate
        assert candidate['media'][0]['originalPrompt'] == PROMPT, candidate
        assert not candidate['media'][1].get('originalPrompt'), candidate
        assert all('recommended' not in v['url'] for m in candidate['media'] for v in m.get('variants', [])), candidate
        selected = setup.evaluate("""async c => {
          const {applyPageCaptureSelections}=await import('./page-capture.js');
          return applyPageCaptureSelections({status:'ready',candidates:[c],selections:[{
            candidateId:c.id,includeText:true,selectedMediaIds:c.media.map(m=>m.id),mediaDecision:'confirmed'
          }]})[0];
        }""", candidate)
        assert len(selected['media']) == 2, selected
        assert selected['media'][0].get('originalPrompt') == PROMPT and not selected['media'][1].get('originalPrompt'), selected
        print({'krea_detail_one_case':True,'original_without_preview_duplicate':True,'style_reference_without_invented_prompt':True,'recommendations_excluded':True})


if __name__ == '__main__':
    main()
