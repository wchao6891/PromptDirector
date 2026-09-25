"""Detail copy/drag must expose the original, not the generated gallery thumbnail."""
from playwright.sync_api import expect
from e2e_support import extension_session, base_entry


def main():
    with extension_session('detail-image-export-') as run:
        setup = run.open_page('collector.html')
        original = setup.evaluate('''async () => {
          const {saveMediaBlob} = await import('./media-store.js');
          const canvas = document.createElement('canvas');
          canvas.width = 1800; canvas.height = 1200;
          canvas.getContext('2d').fillRect(0, 0, 1800, 1200);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          await saveMediaBlob('export-original', blob);
          return {size:blob.size, digest:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(',')};
        }''')
        entry = base_entry('export-case', '原图拖出', '', 'content:image-case', 0)
        entry.update(primaryMediaId='export-original', mediaAssets=[{
            'id':'export-original', 'kind':'image', 'storageMode':'managed',
            'mimeType':'image/png', 'sourceTitle':'原件.png', 'width':1800, 'height':1200}])
        run.seed_storage(setup, {'entries':[entry], 'uiPreferences':{'motion':'reduced'}})
        page = run.open_page('library.html')
        page.locator('.case-card[data-entry-id="export-case"]').click()
        picture = page.locator('.detail-image')
        expect(picture).to_be_visible()
        page.wait_for_function("document.querySelector('.detail-image')?.naturalWidth === 1800")
        result = picture.evaluate('''async image => {
          const context = new MouseEvent('contextmenu', {bubbles:true, cancelable:true});
          image.dispatchEvent(context);
          const data = new DataTransfer();
          image.dispatchEvent(new DragEvent('dragstart', {bubbles:true, cancelable:true, dataTransfer:data}));
          const url = data.getData('text/uri-list');
          const blob = await (await fetch(url)).blob();
          return {prevented:context.defaultPrevented, menu:!!document.querySelector('.quick-action-menu'),
            payload:data.getData('DownloadURL'), url, size:blob.size,
            digest:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(',')};
        }''')
        assert not result['prevented'] and not result['menu'], result
        assert result['payload'] == 'image/png:原件.png:' + result['url'], result
        assert result['size'] == original['size'] and result['digest'] == original['digest'], result
        page.evaluate("""() => {
          document.querySelector('.detail-image').addEventListener('dragstart', event => {
            window.originalDrag = {trusted:event.isTrusted, payload:event.dataTransfer.getData('DownloadURL')};
          });
          const target = document.createElement('div');
          target.id = 'original-drop-target';
          target.style = 'position:fixed;right:10px;top:10px;width:160px;height:120px;z-index:99999;background:white';
          target.addEventListener('dragover', event => event.preventDefault());
          target.addEventListener('drop', event => {
            event.preventDefault();
            window.originalDrop = {trusted:event.isTrusted, url:event.dataTransfer.getData('text/uri-list'),
              payload:event.dataTransfer.getData('DownloadURL')};
          });
          document.body.append(target);
        }""")
        picture.drag_to(page.locator('#original-drop-target'))
        dropped = page.evaluate('window.originalDrop')
        assert dropped and dropped['trusted'] and dropped['url'] == result['url'], dropped
        started = page.evaluate('window.originalDrag')
        assert started['trusted'] and started['payload'] == result['payload'], started
        # Chromium does not expose its native DownloadURL flavor to a webpage drop target.
        # Verify the received standard URL, while OS file export remains a separate acceptance.
        assert page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.length") == 1
        page.locator('#original-drop-target').evaluate("target => { target.style.top = '300px'; }")
        page.locator('#detail-close').click()
        card_image = page.locator('.case-card[data-entry-id="export-case"] .case-shot')
        card_image.hover()
        page.wait_for_function("document.querySelector('.case-shot')?.naturalWidth === 1800")
        card_image.evaluate("""image => image.closest('.case-card').addEventListener('dragstart', event => {
          // Observe after the event bubbles through the card's project-move handler.
          window.cardDrag = {
            trusted:event.isTrusted, payload:event.dataTransfer.getData('DownloadURL'),
            caseId:event.dataTransfer.getData('application/x-promptdirector-case'),
            effect:event.dataTransfer.effectAllowed
          };
        })""")
        card_image.drag_to(page.locator('#original-drop-target'))
        card_drag = page.evaluate('window.cardDrag')
        dropped = page.evaluate('window.originalDrop')
        assert card_drag['trusted'] and card_drag['caseId'] == 'export-case', card_drag
        assert card_drag['effect'] == 'copyMove', card_drag
        assert card_drag['payload'] == 'image/png:原件.png:' + dropped['url'], card_drag
        received = page.evaluate("""async url => {
          const blob = await (await fetch(url)).blob();
          return {type:blob.type, size:blob.size,
            digest:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(',')};
        }""", dropped['url'])
        assert received['type'] == 'image/png' and received['digest'] == original['digest'], received
        print('PASS original detail image context menu and drag payload: 1800x1200 PNG, original SHA-256 preserved; case retained; gallery card exports PNG original with project-move identity')


if __name__ == '__main__':
    main()
