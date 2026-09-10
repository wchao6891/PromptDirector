"""Exercise stale File snapshots with Chrome's real file API in an isolated origin."""
import json
from e2e_support import extension_session


def main():
    with extension_session("pd-upgrade-snapshot-") as session:
        page = session.open_page("collector.html")
        result = page.evaluate("""async () => {
          const {createZipBlob} = await import('./zip.js');
          const {installLocalUpgrade, prepareLocalUpgrade, RECOVERY_DIRECTORY} = await import('./local-extension-upgrade.js');
          const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('installation-fixture', {create:true});
          const current = chrome.runtime.getManifest();
          const version = current.version.split('.');
          version[version.length - 1] = String(Number(version.at(-1)) + 1);
          const next = {...current, version:version.join('.')};
          const write = async (directory, name, bytes) => {
            const handle = await directory.getFileHandle(name, {create:true});
            const writer = await handle.createWritable();
            await writer.write(bytes);
            await writer.close();
          };
          await write(root, 'manifest.json', JSON.stringify(current));
          await write(root, 'background.js', 'old program');
          await write(root, 'cases.json', 'keep user data');
          const paths = new Set(['manifest.json', next.background.service_worker, next.side_panel.default_path, 'library.html', ...Object.values(next.icons)]);
          const archive = await createZipBlob([...paths].map(name => ({name, data:name === 'manifest.json' ? JSON.stringify(next) : 'new program'})));
          const prepared = await prepareLocalUpgrade(archive, chrome.runtime);
          let injected = false;
          let staleError = '';
          const observedRoot = {
            getDirectoryHandle: root.getDirectoryHandle.bind(root),
            getFileHandle: root.getFileHandle.bind(root),
            removeEntry: root.removeEntry.bind(root),
            async *entries() {
              for await (const [name, handle] of root.entries()) {
                if (name !== 'background.js') { yield [name, handle]; continue; }
                yield [name, {kind:'file', async getFile() {
                  const file = await handle.getFile();
                  if (!injected) {
                    injected = true;
                    await file.arrayBuffer();
                    // A real disk write invalidates this previously read File.
                    await write(root, name, 'refreshed original program');
                    const read = file.arrayBuffer.bind(file);
                    file.arrayBuffer = async () => {
                      try { return await read(); }
                      catch (error) { staleError = error.name; throw error; }
                    };
                  }
                  return file;
                }}];
              }
            }
          };
          let record;
          await installLocalUpgrade(observedRoot, prepared, {
            runtime: chrome.runtime,
            fetchFn: async url => {
              try { return new Response(await (await root.getFileHandle(new URL(url).pathname.slice(1))).getFile()); }
              catch { return new Response('', {status:404}); }
            },
            saveRecord: async value => {record = value;}
          });
          const read = async (directory, name) => (await (await directory.getFileHandle(name)).getFile()).text();
          return {
            staleError, phase:record.phase,
            version:JSON.parse(await read(root,'manifest.json')).version,
            expectedVersion:next.version,
            recovery:await read(await root.getDirectoryHandle(RECOVERY_DIRECTORY), 'background.js'),
            userData:await read(root, 'cases.json')
          };
        }""")
        assert result['staleError'] in ['InvalidStateError', 'NotReadableError'], result
        assert result['phase'] == 'written', result
        assert result['version'] == result['expectedVersion'], result
        assert result['recovery'] == 'refreshed original program', result
        assert result['userData'] == 'keep user data', result
        print(json.dumps({"status": "passed", "realFileSnapshot": result}))


if __name__ == '__main__':
    main()
