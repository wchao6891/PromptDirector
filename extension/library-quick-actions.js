import { getMediaBlob } from './media-store.js';
import { getLocalAssetHandleRecord } from './local-asset-store.js';
import { resolvePortableAssetFormat } from './asset-formats.js';
import { t } from './i18n.js';
import { LOCAL_ASSET_REFERENCE_RECORD_TYPE } from './local-media.js';

export function copyFilename(asset, title, index, blob = {}) {
  const extension = resolvePortableAssetFormat(asset, blob).extension;
  let name = String(blob.name || asset.sourceTitle || `${title}-${index + 1}`)
    .split(/[\\/]/u).pop().replace(/[<>:"|?*\u0000-\u001f]/gu, '_').replace(/[. ]+$/u, '');
  if (!name || /^\.+$/u.test(name)) name = `${asset.id}.${extension}`;
  if (extension && !name.toLowerCase().endsWith(`.${extension}`)) name += `.${extension}`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) name = `_${name}`;
  return name;
}

export async function originalFile(asset) {
  const record = asset.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE ? await getLocalAssetHandleRecord(asset.id) : null;
  if (asset.recordType === LOCAL_ASSET_REFERENCE_RECORD_TYPE && !record) throw new Error(t('本机源文件链接已丢失，请重新链接'));
  if (record) {
    const permission = await record.handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted' && await record.handle.requestPermission({ mode: 'read' }) !== 'granted') {
      throw new Error(t('需要重新授权读取'));
    }
    const file = await record.handle.getFile();
    if ((Number.isFinite(asset.sourceLastModified) && file.lastModified !== asset.sourceLastModified) || (Number.isFinite(asset.byteSize) && file.size !== asset.byteSize)) throw new Error(t('源文件已变化，请确认后重新链接'));
    return file;
  }
  if (asset.storageMode === 'reference') throw new Error(t('仅来源链接'));
  const blob = await getMediaBlob(asset.id);
  if (!blob) throw new Error(t('本地媒体文件缺失；请从完整备份恢复'));
  return blob;
}

export async function downloadOriginal(asset, title, index = 0) {
  const blob = await originalFile(asset);
  const url = URL.createObjectURL(blob);
  let listener;
  try {
    const id = await chrome.downloads.download({ url, filename: copyFilename(asset, title, index, blob), conflictAction: 'uniquify' });
    await new Promise((resolve, reject) => {
      const settle = (state, error) => {
        if (state === 'complete') resolve();
        else if (state === 'interrupted') reject(new Error(error || t('下载失败')));
      };
      listener = delta => { if (delta.id === id) settle(delta.state?.current, delta.error?.current); };
      chrome.downloads.onChanged.addListener(listener);
      chrome.downloads.search({ id }).then(items => {
        if (!items.length) reject(new Error(t('下载失败')));
        else settle(items[0].state, items[0].error);
      }, reject);
    });
  } finally {
    if (listener) chrome.downloads.onChanged.removeListener(listener);
    URL.revokeObjectURL(url);
  }
}

let closeMenu;
export function showQuickMenu(anchor, actions, point, onError) {
  closeMenu?.();
  const menu = document.createElement('div');
  menu.className = 'quick-action-menu';
  menu.setAttribute('role', 'menu');
  const controller = new AbortController();
  const close = (restore = true) => {
    controller.abort();
    menu.remove();
    if (restore && anchor.isConnected) anchor.focus({ preventScroll: true });
    if (closeMenu === close) closeMenu = null;
  };
  closeMenu = close;
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = t(action.label);
    if (action.danger) button.className = 'quick-action-danger';
    button.addEventListener('click', async () => {
      close();
      try { await action.run(); } catch (error) { onError(error.message); }
    });
    menu.append(button);
  }
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(point?.x ?? rect.left, innerWidth - menu.offsetWidth))}px`;
  menu.style.top = `${Math.max(0, Math.min(point?.y ?? rect.bottom, innerHeight - menu.offsetHeight))}px`;
  menu.firstElementChild?.focus();
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.children];
    const index = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'Tab') { close(); return; }
    else return;
    event.preventDefault();
    if (next !== undefined) buttons[next].focus();
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) close(false); }, { signal: controller.signal, capture: true });
  window.addEventListener('resize', () => close(false), { signal: controller.signal });
  document.addEventListener('scroll', event => { if (!menu.contains(event.target)) close(false); }, { signal: controller.signal, capture: true });
}

export async function downloadMediaCopies(items, onError) {
  const uniqueItems = [...new Map(items.map(item => [item.asset.id, item])).values()];
  if (!uniqueItems.length) return onError(t('没有可下载的媒体'));
  const failures = [];
  for (const [index, item] of uniqueItems.entries()) {
    try { await downloadOriginal(item.asset, item.title, index); }
    catch (error) { failures.push(`${item.asset.sourceTitle || item.title}：${error.message}`); }
  }
  if (failures.length) onError(failures.join('；'));
}
