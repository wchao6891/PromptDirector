const storeUpdateUi = `import { t } from "./i18n.js";

export async function openLocalUpgrade() {
  throw new Error(t("商店版由 Chrome 自动更新"));
}

export async function runningUpgradeFeedback() {
  return { message: "", cleanupRequired: false };
}

export async function finishLocalUpgrade() {
  throw new Error(t("商店版由 Chrome 自动更新"));
}
`;

export function packageRuntimeFiles(files, { release = false } = {}) {
  if (!release) return files;
  return files
    .filter(file => file.name !== "local-extension-upgrade.js")
    .map(file => file.name === "local-extension-upgrade-ui.js"
      ? { ...file, data: storeUpdateUi }
      : file);
}
