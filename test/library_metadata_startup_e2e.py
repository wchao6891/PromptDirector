"""Stored first-screen ratios render without waiting for unrelated derived metadata."""
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, base_entry, extension_session

with tempfile.TemporaryDirectory(prefix='pd-metadata-source-') as directory:
    extension = Path(directory)
    for path in EXTENSION_DIR.iterdir():
        if path.name != 'library.js':
            (extension / path.name).symlink_to(path, target_is_directory=path.is_dir())
    source = (EXTENSION_DIR / 'library.js').read_text()
    assert '  getAllDerivedMetadata,' in source
    source = source.replace('  getAllDerivedMetadata,', '  getAllDerivedMetadata as readAllDerivedMetadata,')
    source += '''
async function getAllDerivedMetadata() {
  const snapshot = await readAllDerivedMetadata();
  globalThis.pdMetadataReadPending = true;
  await new Promise(resolve => {globalThis.pdReleaseMetadata = resolve;});
  return snapshot;
}
'''
    (extension / 'library.js').write_text(source)
    with extension_session('pd-metadata-profile-', extension_dir=extension) as run:
        setup = run.open_page('collector.html')
        entries = [base_entry('first', '首屏比例', '完整原词', 'content:image-case'),
                   base_entry('color', '颜色资料', '完整原词', 'content:image-case')]
        for entry in entries:
            entry['mediaAssets'] = [{'id': entry['id'] + '-image', 'kind': 'image', 'mimeType': 'image/png', 'storageMode': 'managed'}]
            entry['primaryMediaId'] = entry['mediaAssets'][0]['id']
        run.seed_storage(setup, {'entries': entries, 'dataSafetyOnboardingSeen': True})
        setup.evaluate('''async () => {
          const {saveDerivedMetadata} = await import('./media-store.js');
          await saveDerivedMetadata('first-image', {width:900,height:300});
          await saveDerivedMetadata('color-image', {width:300,height:900,palette:{version:1,colors:['#aa3300']}});
        }''')
        page = run.open_page('library.html')
        expect(page.locator('body')).to_have_attribute('data-library-state', 'ready', timeout=5000)
        ratios = page.locator('.case-image-wrap').evaluate_all('(wraps)=>wraps.map(w=>w.style.aspectRatio).sort()')
        assert ratios == ['300 / 900', '900 / 300'], ratios
        page.wait_for_function('()=>globalThis.pdMetadataReadPending')
        # A maintenance update during the blocked scan must win over its older snapshot.
        setup.evaluate("() => chrome.runtime.sendMessage({type:'LIBRARY_DERIVED_METADATA_UPDATED',assetId:'color-image',metadata:{width:300,height:900,palette:{version:1,colors:['#00aa66']}}})")
        page.locator('#search-input').fill('color:#00aa66')
        page.evaluate('()=>globalThis.pdReleaseMetadata()')
        expect(page.locator('.case-card')).to_have_count(1)
        expect(page.locator('.case-card')).to_have_attribute('data-entry-id', 'color')
        print('PASS: first-screen stored ratios ready before whole metadata scan; pending color query uses completed metadata and newer maintenance color')
