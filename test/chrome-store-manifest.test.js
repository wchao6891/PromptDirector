import test from "node:test";
import assert from "node:assert/strict";

import { validateChromeStoreManifest } from "../tools/chrome-store-manifest.mjs";

const locales = {
  zh_CN: {
    extensionName: { message: "提示词导演 - 视觉提示词灵感库" },
    extensionDescription: { message: "收藏网页画面与提示词。" }
  },
  en: {
    extensionName: { message: "PromptDirector — Visual Creative Archive" },
    extensionDescription: { message: "Save web visuals with their prompts." }
  }
};

test("localized store manifest fields accept current names without a separate short name", () => {
  assert.doesNotThrow(() => validateChromeStoreManifest({
    manifest: {
      manifest_version: 3,
      version: "1.18.6",
      name: "__MSG_extensionName__",
      description: "__MSG_extensionDescription__"
    },
    locales
  }));
});

test("localized short names cannot exceed Chrome's twelve-character limit", () => {
  assert.throws(() => validateChromeStoreManifest({
    manifest: {
      manifest_version: 3,
      version: "1.18.6",
      name: "__MSG_extensionName__",
      short_name: "__MSG_extensionShortName__",
      description: "__MSG_extensionDescription__"
    },
    locales: {
      ...locales,
      en: { ...locales.en, extensionShortName: { message: "Visual Prompt Archive" } },
      zh_CN: { ...locales.zh_CN, extensionShortName: { message: "提示词导演" } }
    }
  }), /short_name.*12/);
});

test("every locale must resolve the store-facing manifest messages", () => {
  assert.throws(() => validateChromeStoreManifest({
    manifest: {
      manifest_version: 3,
      version: "1.18.6",
      name: "__MSG_extensionName__",
      description: "__MSG_extensionDescription__"
    },
    locales: { ...locales, en: { extensionName: locales.en.extensionName } }
  }), /extensionDescription/);
});
