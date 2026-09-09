import { posix } from "node:path";

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
  files = packageHashRuntime(files);
  if (!release) return files;
  return files
    .filter(file => !["local-extension-upgrade.js", "local-installation-directory.js"].includes(file.name))
    .map(file => file.name === "local-extension-upgrade-ui.js"
      ? { ...file, data: storeUpdateUi }
      : file);
}

// Installed updaters accept root program modules, but predate this vendor directory.
// Rebase only the distribution paths; keep the audited upstream source intact.
function packageHashRuntime(files) {
  const prefix = "vendor/noble-hashes/";
  const modules = files.filter(file => file.name.startsWith(prefix) && file.name.endsWith(".js"));
  if (!modules.length) return files;
  const paths = new Map(modules.map(file => [file.name, `noble-hashes-${posix.basename(file.name)}`]));
  const license = files.find(file => file.name === `${prefix}LICENSE`);
  if (!license || !files.some(file => file.name === "THIRD_PARTY_NOTICES.md")) throw new Error("Hash runtime license is missing");
  for (const target of paths.values()) {
    if (files.some(file => file.name === target)) throw new Error(`Duplicate packaged module: ${target}`);
  }
  return files.filter(file => file !== license).map(file => {
    if (file.name === "THIRD_PARTY_NOTICES.md") {
      return { ...file, data: `${file.data.toString().replaceAll("vendor/noble-hashes/LICENSE", "the @noble/hashes license below")}\n\n### @noble/hashes license\n\n${license.data.toString()}` };
    }
    if (!file.name.endsWith(".js")) return file;
    const name = paths.get(file.name) || file.name;
    const data = file.data.toString().replace(/(\bfrom\s+["'])(\.[^"']+)(["'])/gu, (match, before, specifier, after) => {
      const dependency = posix.normalize(posix.join(posix.dirname(file.name), specifier));
      const destination = paths.get(dependency);
      if (!destination) return match;
      const relative = posix.relative(posix.dirname(name), destination);
      return `${before}${relative.startsWith(".") ? relative : `./${relative}`}${after}`;
    });
    return name === file.name && data === file.data.toString() ? file : { ...file, name, data };
  });
}
