"""Real Chrome ingestion and existing detail UI; constructed PNG is a boundary fixture.
Set PROMPTDIRECTOR_GENERATION_SAMPLES to a provenance JSON for real-file acceptance.
"""
import base64, hashlib, json, os, struct, zlib
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session


def png_bytes():
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    prompt = '雨夜书店\nNegative prompt: watermark\nSteps: 28, Sampler: Euler, Seed: 18446744073709551615'
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)) + chunk(b'iTXt', b'parameters\0\0\0\0\0' + prompt.encode()) + chunk(b'IDAT', zlib.compress(b'\0\xff\0\0\xff')) + chunk(b'IEND', b'')


def main():
    with extension_session('image-generation-') as session:
        page = session.open_page('library.html', wait_until='networkidle')
        page.evaluate("async () => { const {SCHEMA_VERSION}=await import('./taxonomy.js'); await chrome.runtime.sendMessage({type:'GET_STATE'}); await chrome.storage.local.set({entries:[],schemaVersion:SCHEMA_VERSION}); }")
        original = png_bytes()
        prepared = page.evaluate("""async encoded => {
          const {prepareLocalMedia}=await import('./local-media.js'); const {saveMediaBlob}=await import('./media-store.js');
          const file=new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'boundary.png',{type:'image/png'});
          const prepared=await prepareLocalMedia(file,'generation:e2e'); await saveMediaBlob(prepared.asset.id,prepared.blob);
          window.generationAsset=prepared.asset; return prepared.asset;
        }""", base64.b64encode(original).decode())
        assert prepared['generationInfo']['candidates'][0]['prompt'] == '雨夜书店'
        saved = page.evaluate("async () => chrome.runtime.sendMessage({type:'CREATE_MEDIA_CASE',asset:window.generationAsset,title:'Generation boundary'})")
        assert saved['ok'], saved
        entry_id = saved['entry']['id']
        page.goto(f'chrome-extension://{session.extension_id}/library.html?case={entry_id}', wait_until='networkidle')
        expect(page.locator('.original-prompt-panel .prompt-text').first).to_contain_text('雨夜书店')
        expect(page.locator('.metadata-section')).to_contain_text('18446744073709551615')
        assert page.locator('.metadata-section').count() == 1
        for width in [1280, 390]:
            page.set_viewport_size({'width':width,'height':900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        page.set_viewport_size({'width':1280,'height':900})
        page.get_by_role('button',name='编辑原始提示词',exact=True).click()
        editor=page.get_by_role('textbox',name='编辑原始提示词',exact=True)
        editor.fill('用户编辑后的原始提示词')
        page.locator('.original-prompt-panel').get_by_role('button',name='保存',exact=True).click()
        expect(page.locator('.original-prompt-panel .prompt-text').first).to_contain_text('用户编辑后的原始提示词')
        page.get_by_role('button',name='编辑原始提示词',exact=True).click()
        editor.fill('')
        page.locator('.original-prompt-panel').get_by_role('button',name='保存',exact=True).click()
        expect(page.locator('.original-prompt-panel')).to_have_count(0)
        state=page.evaluate("async () => chrome.runtime.sendMessage({type:'GET_STATE'})")
        entry=next(e for e in state['entries'] if e['id']==entry_id)
        assert entry['mediaPrompts']==[]
        retried=page.evaluate("async args=>chrome.runtime.sendMessage({type:'ADD_UPLOADED_MEDIA',entryId:args.id,asset:args.asset})",{'id':entry_id,'asset':prepared})
        assert retried['ok'] and retried['entry']['mediaPrompts']==[], retried
        after=page.evaluate("""async () => {
          const {getMediaBlob}=await import('./media-store.js');const {sha256Blob}=await import('./blob-digest.js');return sha256Blob(await getMediaBlob('generation:e2e'));
        }""")
        assert after==hashlib.sha256(original).hexdigest()
        # An older exporter strips optional media fields. Viewing its original
        # must recover parameter visibility without restoring a cleared prompt.
        stored = page.evaluate("""async () => {
          const {entries}=await chrome.storage.local.get('entries');
          for (const entry of entries) for (const asset of entry.mediaAssets ?? []) delete asset.generationInfo;
          await chrome.storage.local.set({entries});return entries;
        }""")
        page.goto(f'chrome-extension://{session.extension_id}/library.html?case={entry_id}', wait_until='networkidle')
        expect(page.locator('.metadata-section')).to_contain_text('18446744073709551615')
        expect(page.locator('.original-prompt-panel')).to_have_count(0)
        assert page.evaluate("async () => (await chrome.storage.local.get('entries')).entries") == stored
        # The existing confirmation dialog resolves before any new case commit.
        for action in ['跳过','覆盖']:
            page.evaluate("""async ({asset,action}) => {
              const {saveMediaBlob,getMediaBlob}=await import('./media-store.js');
              const next={...asset,id:'conflict:'+action};await saveMediaBlob(next.id,await getMediaBlob(asset.id));
              const {sendWithGenerationPromptConfirmation}=await import('./image-generation-confirmation.js');
              window.conflictResult=null;window.pendingConflict=sendWithGenerationPromptConfirmation({type:'CREATE_MEDIA_CASE',asset:next,title:'Conflict '+action,text:'已有原始提示词'}).then(result=>window.conflictResult=result);
            }""",{'asset':prepared,'action':action})
            dialog=page.locator('#promptdirector-app-dialog')
            expect(dialog).to_be_visible();expect(dialog).to_contain_text('已有原始提示词');expect(dialog).to_contain_text('雨夜书店')
            dialog.get_by_role('button',name=action,exact=True).click()
            page.wait_for_function('() => window.conflictResult !== null')
            result=page.evaluate('window.conflictResult');assert result['ok'],result
            assert result['entry']['text']=='已有原始提示词'
            assert bool(result['entry']['mediaPrompts']) == (action=='覆盖')
        proof=[]
        if os.environ.get('PROMPTDIRECTOR_GENERATION_SAMPLES'):
            for sample in json.loads(Path(os.environ['PROMPTDIRECTOR_GENERATION_SAMPLES']).read_text()):
                path=Path(sample['path']);data=path.read_bytes()
                parsed=page.evaluate("""async encoded => {
                  const {readImageGenerationInfo}=await import('./image-generation-info.js');return readImageGenerationInfo(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))]));
                }""",base64.b64encode(data).decode())
                assert hashlib.sha256(path.read_bytes()).hexdigest()==sample['sha256']
                proof.append({'name':path.name,'status':parsed.get('status') if parsed else 'no-generation-info','candidates':len(parsed.get('candidates',[])) if parsed else 0,'originalUnchanged':True})
        print(json.dumps({'ingestion':'passed','existingDetailEditClear':'passed','conflictSkipOverwrite':'passed','retryDoesNotRefill':'passed','originalHash':after,'realSamples':proof},ensure_ascii=False))

if __name__=='__main__':main()
