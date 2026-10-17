import { getLibraryStorage } from './library-storage.js';
import { updateUiPreferences, translateUiMessage } from './i18n.js';
import { createTransientFeedback } from './transient-feedback.js';
import { createVideoComponentView } from './video-component-view.js';

export function bindCaptureVideoSettings({ toggle, feedback, load, save, show }) {
  let onlineOnly = false;
  const refresh = async () => { onlineOnly = (await load()).videoOnlineOnly === true; toggle.checked = onlineOnly; };
  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try { onlineOnly = (await save({ videoOnlineOnly: toggle.checked })).videoOnlineOnly === true; }
    catch (error) { show(feedback, translateUiMessage(error.message), { error: true }); }
    finally { toggle.checked = onlineOnly; toggle.disabled = false; }
  });
  return { refresh };
}

if (typeof document !== 'undefined' && document.querySelector('#video-online-only')) {
  const feedback = createTransientFeedback();
  const binding = bindCaptureVideoSettings({
    toggle: document.querySelector('#video-online-only'), feedback: document.querySelector('#video-capture-settings-feedback'),
    load: async () => (await getLibraryStorage().get('uiPreferences')).uiPreferences || {}, save: updateUiPreferences,
    show: (node, message, options) => feedback.show(node, message, options)
  });
  const button = document.querySelector('#connect-video-component');
  const setup = createVideoComponentView(button.parentElement, { button, message: document.querySelector('#video-component-status') });
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'VIDEO_COMPONENT_SETUP_CHANGED') void setup.changed(message.state);
  });
  await setup.refresh();
  await binding.refresh();
}
