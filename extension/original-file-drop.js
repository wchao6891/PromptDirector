// Classic isolated-world content script. Only a trusted PD file drop is handled;
// ordinary website drops and page-generated events retain their normal behavior.
(() => {
  const type = 'application/x-promptdirector-file';
  const readFile = descriptor => new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'pd-original-file-drag' });
    const chunks = [];
    let size, mimeType, offset = 0, settled = false;
    const finish = (error, file) => {
      if (settled) return;
      settled = true;
      port.disconnect();
      if (error) reject(error); else resolve(file);
    };
    port.onDisconnect.addListener(() => {
      if (!settled) finish(new Error(chrome.runtime.lastError?.message || '原件连接中断，请重新拖动'));
    });
    port.onMessage.addListener(message => {
      if (message.type === 'error') return finish(new Error(message.message));
      if (message.type === 'file') { size = message.size; mimeType = message.mimeType; }
      else if (message.type === 'chunk') {
        const bytes = Uint8Array.from(atob(message.data), char => char.charCodeAt(0));
        if (message.offset !== offset + bytes.length || message.offset > size) return finish(new Error('原件未完整读取，请重新拖动'));
        chunks.push(bytes); offset = message.offset;
        if (message.done) {
          if (offset !== size) return finish(new Error('原件未完整读取，请重新拖动'));
          return finish(null, new File(chunks, descriptor.name, { type: mimeType || descriptor.mimeType }));
        }
      }
      port.postMessage({ offset });
    });
    port.postMessage({ url: descriptor.url });
  });
  window.addEventListener('dragover', event => {
    if (event.isTrusted && event.dataTransfer?.types.includes(type)) {
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    }
  }, true);
  window.addEventListener('drop', event => {
    if (!event.isTrusted || !event.dataTransfer?.types.includes(type)) return;
    let descriptor;
    try {
      descriptor = JSON.parse(event.dataTransfer.getData(type));
      if (!descriptor.url?.startsWith(`blob:${chrome.runtime.getURL('')}`) ||
          typeof descriptor.name !== 'string' || !descriptor.name || /[/\\\u0000-\u001f]/u.test(descriptor.name)) return;
    } catch { return; }
    event.preventDefault(); event.stopImmediatePropagation();
    const target = event.target;
    const position = { clientX: event.clientX, clientY: event.clientY };
    void readFile(descriptor).then(file => {
      if (!target.isConnected) throw new Error('接收位置已改变，请重新拖动');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer, ...position }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, ...position }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, ...position }));
    }).catch(error => {
      console.warn('PromptDirector original file drop:', error);
      document.getElementById('__pd_original_drop_error__')?.remove();
      const feedback = document.createElement('button');
      feedback.id = '__pd_original_drop_error__'; feedback.type = 'button'; feedback.setAttribute('role', 'alert');
      feedback.textContent = `PromptDirector：${error.message} ×`;
      feedback.style.cssText = 'position:fixed;z-index:2147483647;top:20px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:11px 16px;border:0;border-radius:999px;color:#fff;background:#a23c32;font:700 13px/1.4 system-ui;cursor:pointer';
      feedback.addEventListener('click', () => feedback.remove());
      document.documentElement.append(feedback);
    });
  }, true);
})();
