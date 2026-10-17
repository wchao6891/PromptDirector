// Stable asset names are shared by the installers and the in-context setup UI.
export const VIDEO_COMPONENT = Object.freeze({
  host: 'com.promptdirector.video', version: '0.1.0', tag: 'video-v0.1.0',
  assets: { mac: 'PromptDirector-Video-macOS.pkg', win: 'PromptDirector-Video-Windows.exe' }
});

export function videoComponentDownload(platform, homepage) {
  const asset = VIDEO_COMPONENT.assets[platform];
  if (!asset) throw new Error('视频组件目前支持 Windows 和 macOS');
  const repository = new URL(homepage);
  if (repository.protocol !== 'https:' || repository.hostname !== 'github.com') throw new Error('视频组件下载地址不可用');
  return `${repository.href.replace(/\/$/u, '')}/releases/download/${VIDEO_COMPONENT.tag}/${asset}`;
}

export function videoComponentRequired(message) {
  return Object.assign(new Error(message || '此视频需要安装视频组件'), { code: 'video_component_required' });
}

export function videoComponentCurrent(version) {
  if (!/^\d+\.\d+\.\d+$/u.test(version || '')) return false;
  const current = version.split('.').map(Number), minimum = VIDEO_COMPONENT.version.split('.').map(Number);
  for (let index = 0; index < minimum.length; index++) if (current[index] !== minimum[index]) return current[index] > minimum[index];
  return true;
}
