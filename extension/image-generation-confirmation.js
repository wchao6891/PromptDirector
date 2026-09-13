import { showAppDialog } from './ui-dialogs.js';

// Reuse the existing application dialog, leaving the library detail intact.
export async function sendWithGenerationPromptConfirmation(message) {
  const choices = { ...(message.generationPromptChoices ?? {}) };
  while (true) {
    const response = await chrome.runtime.sendMessage({ ...message, generationPromptChoices: choices });
    if (!response?.promptConflicts?.length) return response;
    for (const conflict of response.promptConflicts) {
      const answer = await showAppDialog({
        title: '原始提示词有冲突', description: conflict.name,
        confirmLabel: '覆盖', cancelLabel: '跳过',
        renderBody({ body }) {
          for (const [label, value] of [['已有原始提示词', conflict.originalText], ['图片内嵌提示词', conflict.embeddedText]]) {
            const heading = document.createElement('h3'); heading.textContent = label;
            const content = document.createElement('pre'); content.className = 'prompt-text'; content.textContent = value;
            // Confirmation must expose the complete text, including long prompts.
            content.style.maxHeight = 'none';
            body.append(heading, content);
          }
        }
      });
      choices[conflict.token] = answer !== null ? 'overwrite' : 'skip';
    }
  }
}
