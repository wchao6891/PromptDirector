"""Synthetic cover bytes survive real UI edits, exports and filesystem backup/restore."""
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session, wait_for_download, wait_for_async_condition


def main():
    fixtures = Path(__file__).parent / 'fixtures' / 'transfer-media'
    with tempfile.TemporaryDirectory(prefix='pd-skill-cover-') as temp, extension_session('pd-skill-cover-') as session:
        setup = session.open_page('collector.html')
        schema = setup.evaluate("async () => (await import(chrome.runtime.getURL('taxonomy.js'))).SCHEMA_VERSION")
        keep = base_entry('cover-keep', '原案例', '原正文与人工编辑必须保留', 'content:prompt:text')
        session.seed_storage(setup, {'schemaVersion': schema, 'entries': [keep], 'uiPreferences': {'locale': 'zh-CN', 'theme': 'dark', 'motion': 'none'}})
        created = setup.evaluate(r"""async () => await chrome.runtime.sendMessage({type: 'CREATE_CREATIVE_SKILL', skill: {
          callName: '封面演练', portableId: 'cover-example', description: '合成图像演练', skillMarkdown: '# 方法\n\n保留方法正文。'
        }})""")
        assert created['ok'], created
        skill_id = created['skill']['id']
        page = session.open_page(f'skills.html?view=editor&skill={skill_id}')
        expect(page.locator('#skill-draft-step')).to_be_visible()
        before = snapshot(page)
        page.locator('#skill-cover-editor input[type=file]').set_input_files(str(fixtures / 'original.gif'))
        expect(page.locator('#skill-cover-editor img')).to_be_visible()
        page.locator('#skill-save').click()
        expect(page.locator('#skill-save-status')).to_contain_text('Skill 已保存')
        first = snapshot(page)
        assert first['skills'][0]['versions'] == before['skills'][0]['versions']
        assert first['hash'] == hashlib.sha256((fixtures / 'original.gif').read_bytes()).hexdigest()
        page.reload()
        expect(page.locator('#skill-cover-editor img')).to_be_visible()
        page.locator('#skill-cover-editor input[type=file]').set_input_files(str(fixtures / 'original.avif'))
        expect(page.locator('#skill-cover-editor img')).to_have_attribute('src', __import__('re').compile('blob:'))
        page.wait_for_function("() => document.querySelector('#skill-cover-editor img')?.naturalWidth === 64")
        page.locator('#skill-save').click()
        expect(page.locator('#skill-save-status')).to_contain_text('Skill 已保存')
        second = snapshot(page)
        expected_hash = hashlib.sha256((fixtures / 'original.avif').read_bytes()).hexdigest()
        assert second['hash'] == expected_hash
        assert second['skills'][0]['versions'] == before['skills'][0]['versions']
        assert second['assetId'] != first['assetId']
        assert page.evaluate("async id => !!await (await import(chrome.runtime.getURL('media-store.js'))).getMediaBlob(id)", first['assetId']) is False
        page.goto(f'chrome-extension://{session.extension_id}/skills.html?view=detail&skill={skill_id}')
        expect(page.locator('#skill-detail-cover img')).to_be_visible()
        page.locator('#skill-detail-more > summary').click()
        page.locator('#skill-export').click()
        exported, _ = wait_for_download(page)
        with zipfile.ZipFile(exported) as archive:
            assert hashlib.sha256(archive.read('assets/cover.avif')).hexdigest() == expected_hash
            assert '保留方法正文' in archive.read('SKILL.md').decode()
        library = session.open_page('library.html', wait_until='networkidle')
        library.locator('#open-settings').click()
        library.locator('[data-settings-tab="general"]').click()
        library.evaluate("window.showDirectoryPicker = async () => navigator.storage.getDirectory()")
        library.locator('#create-folder-backup').click()
        expect(library.locator('#data-safety-feedback')).to_contain_text('完整备份已完成', timeout=30000)
        proof = library.evaluate("""async () => {
          const root = await navigator.storage.getDirectory();
          const {sha256Hex} = await import(chrome.runtime.getURL('sync-crypto.js'));
          for await (const dir of root.values()) {
            if (dir.kind !== 'directory' || !dir.name.startsWith('PromptDirector-Backup-')) continue;
            window.coverBackup = dir;
            const marker = JSON.parse(await (await (await dir.getFileHandle('complete.json')).getFile()).text());
            const library = JSON.parse(await (await (await dir.getFileHandle('library.json')).getFile()).text());
            const file = library.creativeSkills.items[0].packageFiles[0];
            let parent = dir; const parts = file.archivePath.split('/');
            for (const name of parts.slice(0,-1)) parent = await parent.getDirectoryHandle(name);
            return {status: marker.status, hash: await sha256Hex(await (await parent.getFileHandle(parts.at(-1))).getFile()), text: library.entries[0].text};
          }
        }""")
        assert proof == {'status': 'complete', 'hash': expected_hash, 'text': keep['text']}, proof
        removed = library.evaluate("async id => await chrome.runtime.sendMessage({type: 'DELETE_CREATIVE_SKILL', skillId: id})", skill_id)
        assert removed['ok']
        library.evaluate('window.showDirectoryPicker = async () => window.coverBackup')
        library.locator('#restore-folder-backup').click()
        dialog = library.locator('#promptdirector-app-dialog')
        expect(dialog).to_be_visible(timeout=30000)
        dialog.get_by_role('button', name='继续检查', exact=True).click()
        expect(dialog).to_be_visible(timeout=30000)
        dialog.get_by_role('button', name='开始安全合并', exact=True).click()
        expect(library.locator('#data-safety-feedback')).to_contain_text('恢复', timeout=30000)
        wait_for_async_condition(library, "async () => (await chrome.storage.local.get('creativeSkills')).creativeSkills?.items?.length === 1")
        restored = snapshot(library)
        assert restored['hash'] == expected_hash, restored
        assert restored['skills'][0]['versions'] == before['skills'][0]['versions']
        assert restored['entries'][0]['text'] == keep['text']
        page.goto(f'chrome-extension://{session.extension_id}/skills.html?view=detail&skill={restored["skills"][0]["id"]}')
        expect(page.locator('#skill-detail-cover img')).to_be_visible()
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path='/tmp/promptdirector-skill-cover-restored-narrow.png', full_page=True)
        page.goto(f'chrome-extension://{session.extension_id}/skills.html')
        page.locator('#skill-zip-file').set_input_files(str(exported))
        expect(page.locator('#skill-feedback')).to_contain_text('已导入')
        imported = page.evaluate("""async () => {
          const {creativeSkills} = await chrome.storage.local.get('creativeSkills');
          const {readSkillCover} = await import(chrome.runtime.getURL('skill-cover.js'));
          const {getMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          const {sha256Hex} = await import(chrome.runtime.getURL('sync-crypto.js'));
          return Promise.all(creativeSkills.items.map(async skill => ({hash:await sha256Hex((await readSkillCover(skill,getMediaBlob)).blob), body:skill.versions.at(-1).skillMarkdown})));
        }""")
        assert len(imported) == 2, imported
        assert all(item['hash'] == expected_hash and '保留方法正文' in item['body'] for item in imported), imported
        print(json.dumps({'coverReplacement': True, 'methodVersionUnchanged': True, 'exportReimport': True, 'exportBytes': expected_hash, 'filesystemBackupRestore': proof, 'narrowLayout': True}))


def snapshot(page):
    return page.evaluate("""async () => {
      const state = await chrome.runtime.sendMessage({type: 'GET_FOLDER_BACKUP_STATE'});
      const {getMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
      const {sha256Hex} = await import(chrome.runtime.getURL('sync-crypto.js'));
      const file = state.creativeSkills.items[0]?.packageFiles[0];
      return {skills: state.creativeSkills.items, entries: state.entries, assetId: file?.assetId, hash: file ? await sha256Hex(await getMediaBlob(file.assetId)) : ''};
    }""")

if __name__ == '__main__':
    main()
