"""Count original scans with real IndexedDB and the production composer host."""
import json
from e2e_support import extension_session


def main():
    with extension_session('pd-sha256-performance-') as run:
        page = run.open_page('library.html')
        run.seed_storage(page, {'entries': [{
            'id': 'a', 'title': '案例a', 'text': 'Image reference',
            'mediaAssets': [{'id': 'original-image', 'kind': 'image', 'usage': 'content',
                             'storageMode': 'managed', 'mimeType': 'image/png'}]
        }]})
        result = page.evaluate('''async () => {
          const {saveMediaBlob, savePortableAssetBlob, getMediaBlob} = await import('./media-store.js');
          const {createCreativeSkill} = await import('./creative-skills.js');
          const {createSkillOperations} = await import('./skill-operations.js');
          const {createLocalComposerLibraryTools} = await import('./composer-library-host.js');
          const {createComposerSession} = await import('./composer.js');
          const {prepareAgentFile} = await import('./agent-file-preparation.js');
          const {sha256Blob} = await import('./blob-digest.js');
          const assert = (ok, reason) => { if (!ok) throw Error(reason); };
          // A "scan" is any full read of the original bytes. Small originals are now hashed with
          // native crypto.subtle via arrayBuffer() (blob-digest.js, RESOURCE_POLICY.nativeDigestFraction);
          // larger ones stream. Both read paths are counted so the once-only budget stays as strict.
          const originalStream = Blob.prototype.stream, originalArrayBuffer = Blob.prototype.arrayBuffer;
          let counted = () => true;
          const restoreReads = () => { Blob.prototype.stream = originalStream; Blob.prototype.arrayBuffer = originalArrayBuffer; };
          const countReads = (filter, onRead) => {
            counted = filter;
            Blob.prototype.stream = function() { if (counted(this)) onRead(); return originalStream.call(this); };
            Blob.prototype.arrayBuffer = function() { if (counted(this)) onRead(); return originalArrayBuffer.call(this); };
          };
          let scans = 0;
          countReads(() => true, () => scans++);
          try {
            const original = new Blob(['verified transfer text'], {type:'text/plain'});
            const hash = await sha256Blob(original);
            await savePortableAssetBlob('agent-file:verified', original);
            scans = 0;
            const prepared = await prepareAgentFile({assetId:'agent-file:verified', name:'original.txt',
              mimeType:original.type, byteSize:original.size, sha256:hash});
            assert(scans === 0, 'Preparation must reuse the verified transfer hash');
            assert(prepared.asset.contentHash === hash && prepared.contentText === 'verified transfer text', 'Preparation must preserve original identity and text');

            const bytes = new Uint8Array(1024 * 1024).fill(65);
            await savePortableAssetBlob('skill-file:original', new Blob([bytes]));
            const skill = createCreativeSkill({}, {callName:'Snapshot', portableId:'snapshot', description:'Original file', skillMarkdown:'Read.',
              packageFiles:[{path:'references/original.bin', assetId:'skill-file:original'}]});
            const reader = createSkillOperations({loadState:async()=>({creativeSkills:skill.state}), readBlob:getMediaBlob});
            const {revision} = await reader.execute('read_skill', {skillId:skill.skill.id});
            let fileScans = 0;
            countReads(blob => blob.size === bytes.length, () => fileScans++);
            let part, pages = 0, length = 0;
            do {
              part = await reader.execute('read_skill_file', {skillId:skill.skill.id, source:'package', path:'references/original.bin',
                expectedRevision:revision, encoding:'binary', ...(part ? {offset:part.nextOffset,expectedHash:part.sha256} : {})});
              const chunk = atob(part.data);
              assert([...chunk].every(value=>value==='A'), 'Every byte must be from the same original');
              length += chunk.length; pages++;
            } while(part.nextOffset !== null);
            assert(length === bytes.length && fileScans === 1, 'Real IndexedDB paging must scan the original once');

            const canvas = new OffscreenCanvas(4,4), context = canvas.getContext('2d');
            const image = async color => { context.fillStyle=color;context.fillRect(0,0,4,4);return canvas.convertToBlob({type:'image/png'}); };
            await saveMediaBlob('original-image', await image('red'));
            const session = createComposerSession({messages:[{id:'user', role:'user', content:'使用案例a的图片'}]});
            const host = createLocalComposerLibraryTools({session, vision:true, maxCharacters:750000});
            let imageScans = 0;
            countReads(blob => blob.type === 'image/png', () => imageScans++);
            const use = async () => {
              const value = await host.execute('use_case_images', {caseId:'a',imageIds:['original-image']}, {callId:crypto.randomUUID()});
              assert(!value.data.error, JSON.stringify(value.data)); return value;
            };
            const first = await use();
            // Full reads per delivery: one native-digest read plus one data-URL encode read (vision.js blobToDataUrl).
            assert(first.images.length === 1 && imageScans === 2, 'First image delivery hashes once and encodes once');
            const same = await use();
            assert(same.images.length === 0 && imageScans === 3, 'Unchanged image is checked once without re-encoding/re-sending');
            await saveMediaBlob('original-image', await image('blue'));
            const changed = await use();
            assert(changed.images.length === 1 && imageScans === 5, 'Changed image must not be hashed or encoded twice');
            const composerFileScans = imageScans;
            const delivered = await (await fetch(changed.images[0].dataUrl)).blob();
            const deliveredHash = await sha256Blob(delivered);
            assert(deliveredHash === changed.data.media[0].sha256, 'Receipt must describe the delivered bytes');
            assert(first.data.media[0].sha256 !== deliveredHash, 'Replacement must be delivered');
            return {preparationExtraScans:0, skillBytes:length, skillPages:pages, skillFileScans:fileScans,
              composerRequests:3, composerFileScans};
          } finally { restoreReads(); }
        }''')
        print('PASS: real storage and host performance counters ' + json.dumps(result))


if __name__ == '__main__':
    main()
