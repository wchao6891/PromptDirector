import { assetFileAccept } from "./asset-formats.js";
import { isSkillCoverPath, skillPackageRoot, readSkillCover, validateSkillCover } from "./skill-cover.js";
import { skillPackageLimits } from "./creative-skill-package.js";
import { blobToDataUrl } from "./vision.js";
import { t } from "./i18n.js";

const urls = new WeakMap();
export function clearSkillCoverImage(host) {
  const url = urls.get(host);
  if (url) URL.revokeObjectURL(url);
  urls.delete(host);
  host.coverToken = null;
  host.replaceChildren();
}

export async function showSkillCoverImage(host, load, options = {}) {
  clearSkillCoverImage(host);
  const token = {};
  host.coverToken = token;
  host.hidden = true;
  try {
    const result = await load();
    if (host.coverToken !== token || !result) return;
    const blob = result.blob ?? result;
    const img = document.createElement("img");
    const url = URL.createObjectURL(blob);
    urls.set(host, url);
    img.alt = options.alt || t("成果封面");
    img.loading = "lazy";
    img.src = url;
    img.addEventListener("error", () => {
      if (host.coverToken !== token) return;
      clearSkillCoverImage(host);
      host.hidden = false;
      host.textContent = t("封面读取失败");
    }, { once: true });
    host.append(img);
    host.hidden = false;
  } catch (error) {
    if (host.coverToken !== token) return;
    host.hidden = false;
    host.textContent = t("封面读取失败");
    host.title = error.message;
  }
}

export function createSkillCoverEditor({ host, readFile, sources, reportError }) {
  let skill = null;
  let pending;
  let selectedSource = "";
  let upload = null;
  let generation = 0;
  let automatic = false;
  let loading = false;
  const preview = node("div", "skill-cover-preview");
  const controls = node("div", "skill-cover-controls");
  const label = node("strong", "", t("成果封面"));
  const pick = button(t("从来源图片选择"));
  const add = button(t("上传图片"));
  const remove = button(t("移除"));
  const input = node("input");
  input.type = "file";
  input.accept = assetFileAccept({ kinds: ["image"] });
  input.hidden = true;
  const dialog = node("dialog", "skill-cover-dialog");
  const close = button(t("关闭"));
  const grid = node("div", "skill-cover-options");
  dialog.append(close, grid);
  controls.append(label, pick, add, remove, input);
  host.classList.add("skill-cover-editor");
  host.append(preview, controls, dialog);
  add.addEventListener("click", () => input.click());
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { for (const child of grid.children) clearSkillCoverImage(child); grid.replaceChildren(); });
  remove.addEventListener("click", () => { generation++; loading = false; pending = null; automatic = false; upload = null; selectedSource = ""; render(); });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const revision = ++generation;
    loading = true;
    automatic = false;
    try {
      const image = await validateSkillCover(file, file.name, {
        maxBytes: skillPackageLimits().maxFileBytes,
        decode: async blob => { const bitmap = await createImageBitmap(blob); bitmap.close(); }
      });
      const dataUrl = await blobToDataUrl(image.blob);
      if (revision !== generation) return;
      pending = { dataUrl, name: image.path };
      upload = image.blob;
      selectedSource = "";
      render();
    } catch (error) { if (revision === generation) reportError(error); }
    finally { if (revision === generation) loading = false; }
  });
  pick.addEventListener("click", () => {
    grid.replaceChildren(...sources().map(source => {
      const item = button(source.label);
      item.className = "skill-cover-option";
      item.title = source.label;
      item.setAttribute("aria-label", source.label);
      showSkillCoverImage(item, () => readFile(source.assetId), { alt: source.label });
      item.addEventListener("click", () => {
        generation++; loading = false; automatic = false;
        pending = { sourceAssetId: source.assetId, name: source.name };
        selectedSource = source.assetId;
        upload = null;
        render();
        dialog.close();
      });
      return item;
    }));
    dialog.showModal();
  });
  function render() {
    pick.hidden = !sources().length;
    remove.hidden = pending === null || (pending === undefined && !(skill?.packageFiles ?? []).some(file => isSkillCoverPath(file.path, skillPackageRoot(skill.packageFiles))));
    showSkillCoverImage(preview, () => pending === null ? null : upload || (selectedSource ? readFile(selectedSource) : readSkillCover(skill ?? {}, readFile)));
  }
  return {
    reset(value) { generation++; loading = false; automatic = false; skill = value; pending = undefined; upload = null; selectedSource = ""; render(); },
    refresh() {
      const values = sources();
      if (automatic && values.length !== 1) { pending = undefined; selectedSource = ""; automatic = false; }
      if (!skill && pending === undefined && values.length === 1) {
        pending = { sourceAssetId: values[0].assetId, name: values[0].name };
        selectedSource = values[0].assetId; automatic = true;
      } else if (selectedSource && !values.some(value => value.assetId === selectedSource)) {
        pending = undefined; selectedSource = "";
      }
      render();
    },
    value() { if (loading) throw new Error(t("正在读取封面图片，请稍候")); return pending; },
    setDisabled(value) { for (const control of [pick, add, remove, input]) control.disabled = value; },
    dispose() { generation++; clearSkillCoverImage(preview); dialog.close(); }
  };
}

function node(tag, className = "", text = "") { const result = document.createElement(tag); result.className = className; result.textContent = text; return result; }
function button(text) { const result = node("button", "button-secondary", text); result.type = "button"; return result; }
