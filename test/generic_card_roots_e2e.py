"""Unregistered card lists: a card's title and prompt stay with its own thumbnails."""
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://cards.example.test'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')


def image(name):
    return f'<img src="{ORIGIN}/{name}.png" width="300" height="200" alt="{name}">'


def card(name, body):
    return f'<div class="card"><h3>{name}</h3><p>Prompt for {name}: a detailed cinematic description.</p>{body}</div>'


PAGES = {
    # Cards that contain their own repeated thumbnail list.
    'nested': ''.join(card(f'Work {i}', '<ul class="thumbs">' + ''.join(f'<li>{image(f"n{i}-{k}")}</li>' for k in range(2)) + '</ul>') for i in range(3)),
    'flat': ''.join(card(f'Work {i}', image(f'f{i}')) for i in range(3)),
    # Captioned sections of captioned cards remain one case per card.
    'sections': ''.join(f'<section class="chapter"><h2>Chapter {s}</h2><div class="grid">' + ''.join(card(f'Work {s}-{i}', image(f's{s}-{i}')) for i in range(2)) + '</div></section>' for s in range(2)),
}
EXPECTED = {
    'nested': [('Work 0', ['n0-0', 'n0-1']), ('Work 1', ['n1-0', 'n1-1']), ('Work 2', ['n2-0', 'n2-1'])],
    'flat': [(f'Work {i}', [f'f{i}']) for i in range(3)],
    'sections': [(f'Work {s}-{i}', [f's{s}-{i}']) for s in range(2) for i in range(2)],
}


def main():
    source = (ROOT / 'extension/page-capture.js').read_text()
    function = source[source.index('export async function collectPageCaptureSnapshot'):]
    function = function[:function.index('\nexport ', 10)].replace('export async', 'async', 1)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={'width': 1200, 'height': 4000})
        page.route(ORIGIN + '/**', lambda r: r.fulfill(body=PNG, content_type='image/png') if r.request.url.endswith('.png') else
                   r.fulfill(body=f'<html><head><title>Gallery</title></head><body><main><div class="grid">{PAGES[r.request.url.rsplit("/", 1)[1]]}</div></main></body></html>', content_type='text/html'))
        for name, expected in EXPECTED.items():
            page.goto(f'{ORIGIN}/{name}')
            snapshot = page.evaluate('async()=>{' + function + ';return collectPageCaptureSnapshot({mode:"whole",listMode:true,maxMedia:100,maxCandidates:100});}')
            cases = [(c['title'], [m['url'].rsplit('/', 1)[1][:-4] for m in c['media']]) for c in snapshot['candidates']]
            assert cases == expected, (name, cases)
            for case in snapshot['candidates']:
                assert f"Prompt for {case['title']}" in case['contentText'], (name, case['title'], case['contentText'])
        browser.close()
    print('PASS: unregistered card lists keep each title and prompt with its own nested thumbnails, without merging captioned cards')


if __name__ == '__main__':
    main()
