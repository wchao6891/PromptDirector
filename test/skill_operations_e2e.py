"""Shared Skill reads against real extension storage; isolated profile only."""
import base64
import hashlib
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-skill-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() +
            '\nglobalThis.agentTestDispatch = dispatchAgentOperation;\n')
        with extension_session('pd-skill-profile-', extension_dir=ext) as run:
            page = run.open_page('skills.html')
            skill = page.evaluate('''async () => {
              const {savePortableAssetBlob}=await import('./media-store.js');
              await savePortableAssetBlob('skill-script',new Blob(['print("原始脚本")\\n'.repeat(20000)],{type:'text/x-python'}));
              const response=await chrome.runtime.sendMessage({type:'CREATE_CREATIVE_SKILL',skill:{
                callName:'分镜方法',description:'完整Skill读取验收',portableId:'storyboards',skillMarkdown:'当前分镜方法',
                references:[{path:'references/prompts.md',markdown:'逐字原词'.repeat(5000)}],
                packageFiles:[{path:'scripts/frames.py',assetId:'skill-script'}]
              }});
              if(!response.ok)throw Error(response.message);
              return response.skill;
            }''')
            worker = run.context.service_workers[0]

            def call(name, args):
                return worker.evaluate('''async ([name,input]) => {
                  try{return await agentTestDispatch(name,input);}
                  catch(e){return {error:e.message,code:e.code};}
                }''', [name, args])

            worker.evaluate('''() => {
              globalThis.skillStorageReads=[];
              const get=chrome.storage.local.get.bind(chrome.storage.local);
              chrome.storage.local.get=async keys=>{skillStorageReads.push(keys);return get(keys);};
            }''')
            body = call('read_skill', {'skillId': skill['id']})
            assert body['content'] == '当前分镜方法', body
            assert 'creativeSkills' in worker.evaluate('skillStorageReads')
            internal = page.evaluate('''async skillId => {
              const {createLocalComposerLibraryTools}=await import('./composer-library-host.js');
              const {createComposerSession}=await import('./composer.js');
              const tools=createLocalComposerLibraryTools({session:createComposerSession({libraryRetrievalEnabled:false}),vision:false});
              return (await tools.execute('read_skill',{skillId},{callId:'skill'})).data;
            }''', skill['id'])
            assert internal == body, internal
            refs = ''; offset = 0
            while True:
                part = call('read_skill', {'skillId': skill['id'], 'part': 'references',
                            'expectedRevision': body['revision'], 'offset': offset})
                refs += part['content']
                if part['nextOffset'] is None:
                    break
                offset = part['nextOffset']
            assert json.loads(refs)['references'][0]['markdown'] == '逐字原词' * 5000
            files = json.loads(call('read_skill', {'skillId': skill['id'], 'part': 'files'})['content'])
            assert any(file['path'] == 'scripts/frames.py' and file['source'] == 'package' for file in files)
            args = {'skillId': skill['id'], 'expectedRevision': body['revision'], 'source': 'package',
                    'path': 'scripts/frames.py', 'encoding': 'binary'}
            data = b''
            while True:
                part = call('read_skill_file', args)
                data += base64.b64decode(part['data'])
                if part['nextOffset'] is None:
                    break
                args.update(offset=part['nextOffset'], expectedHash=part['sha256'])
            assert data == ('print("原始脚本")\n' * 20000).encode()
            assert hashlib.sha256(data).hexdigest() == part['sha256']
            page.reload()
            assert call('read_skill', {'skillId': skill['id']}) == body
            updated = page.evaluate('''async skillId => chrome.runtime.sendMessage({type:'SAVE_CREATIVE_SKILL_VERSION',
              skillId,version:{skillMarkdown:'人工改过的新方法'}})''', skill['id'])
            assert updated['ok'], updated
            assert call('read_skill', {'skillId': skill['id'], 'expectedRevision': body['revision']})['code'] == 'skill_changed'
            fresh = call('read_skill', {'skillId': skill['id']})
            files = []
            contents = {
                'SKILL.md': b'---\nname: storyboards\ndescription: Updated workflow\ncustom: preserve\n---\nUpdated body\n',
                'scripts/frames.py': b'print("new script")',
                'scripts/__init__.py': b'',
                'references/raw.bin': bytes([255, 0, 128, 9]),
                'references/source.md': ('完整原词、负面约束和案例证据。\n' * 4000).encode()
            }
            for i, (path, content) in enumerate(contents.items()):
                transfer_id = 'skill-write-' + str(i)
                began = call('begin_transfer', {'id': transfer_id, 'purpose': 'skill-file', 'name': path.split('/')[-1],
                            'byteSize': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
                assert 'error' not in began, began
                if content:
                    assert 'error' not in call('append_transfer', {'id': transfer_id, 'offset': 0, 'data': base64.b64encode(content).decode()})
                finished = call('finish_transfer', {'id': transfer_id})
                assert finished.get('state') == 'ready', (path, finished)
                files.append({'path': path, 'transferId': transfer_id})
            save_args = {'requestId': 'skill-full-update', 'skillId': skill['id'], 'expectedRevision': fresh['revision'], 'files': files}
            saved = call('save_skill', save_args)
            assert saved['ok'], saved
            saved_refs = ''; ref_offset = 0
            while True:
                ref_page = call('read_skill', {'skillId': skill['id'], 'part': 'references', 'offset': ref_offset, 'expectedRevision': saved['revision']})
                saved_refs += ref_page['content']
                if ref_page['nextOffset'] is None:
                    break
                ref_offset = ref_page['nextOffset']
            reference = json.loads(saved_refs)['references'][0]
            assert reference['markdown'] == contents['references/source.md'].decode().strip()
            assert reference['runtime'] is True
            assert call('save_skill', save_args)['replayed']
            inside_saved = page.evaluate("input => chrome.runtime.sendMessage({type:'SKILL_OPERATION',operation:'save_skill',input})", save_args)
            assert inside_saved['ok'] and inside_saved['data']['replayed'], inside_saved
            old = call('read_skill_file', {'skillId': skill['id'], 'versionId': fresh['versionId'],
                       'expectedRevision': saved['revision'], 'source': 'package', 'path': 'scripts/frames.py'})
            assert old['content'].startswith('print("原始脚本")'), old
            restored = call('restore_skill', {'requestId': 'skill-full-restore', 'skillId': skill['id'],
                            'expectedRevision': saved['revision'], 'versionId': fresh['versionId']})
            assert restored['ok'], restored
            assert call('read_skill', {'skillId': skill['id']})['content'] == '人工改过的新方法'
            page.reload()
            assert call('read_skill', {'skillId': skill['id']})['revision'] == restored['revision']
            backup = page.evaluate('''async () => {
              const {createArchiveUrl}=await import('./offscreen.js');
              const {readZipBlob}=await import('./zip.js');
              const {parseLibraryPackage}=await import('./library-package.js');
              const {skillPackageFiles}=await import('./skill-files.js');
              const {sha256Blob}=await import('./blob-digest.js');
              const {getMediaBlob}=await import('./media-store.js');
              const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
              const archive=await createArchiveUrl({...state,entries:[],sharing:false});
              try {
                const files=await readZipBlob(await (await fetch(archive.url)).blob());
                const parsed=parseLibraryPackage(JSON.parse(await files.get('library.json').text()),files);
                const all=skillPackageFiles(parsed.creativeSkills.items[0]);
                for(const file of all){
                  if(await sha256Blob(parsed.skillAssets.get(file.assetId))!==await sha256Blob(await getMediaBlob(file.assetId)))throw Error('Backup changed file bytes');
                }
                return {assets:parsed.skillAssets.size,versions:parsed.creativeSkills.items[0].versions.length,files:all.length};
              } finally {URL.revokeObjectURL(archive.url);}
            }''')
            assert backup['assets'] == 6 and backup['versions'] == 4, backup
            print('PASS: shared Skill reads and complete writes, retained script versions, binary/empty files, retry receipt, restore/reload, actual ZIP backup with all historical bytes; isolated fixture only')


if __name__ == '__main__':
    main()
