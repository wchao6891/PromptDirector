import test from "node:test";
import assert from "node:assert/strict";

import {
  MICU_COMPATIBLE_PROVIDER_PRESET,
  compatibleImageSizesFor,
  compatibleProviderPresetForEndpoint
} from "../compatible-provider-presets.js";

test("Micu preset is the shared source for settings endpoints and model-specific sizes", () => {
  const preset = MICU_COMPATIBLE_PROVIDER_PRESET;
  assert.equal(compatibleProviderPresetForEndpoint(preset.endpoint), preset);
  assert.deepEqual(compatibleImageSizesFor(preset.endpoint, {
    protocol: preset.imageGeneration.protocol,
    model: "gpt-image-2",
    sizes: []
  }), [
    "1024x1024", "1280x720", "720x1280", "1024x1536", "1536x1024",
    "2048x2048", "2048x1152", "1152x2048"
  ]);
  assert.deepEqual(compatibleImageSizesFor(preset.endpoint, {
    protocol: preset.imageGeneration.protocol,
    model: "gpt-image-2-openai",
    sizes: []
  }).slice(-2), ["3840x2160", "2160x3840"]);
});

test("unknown compatible endpoints keep only their declared sizes", () => {
  const image = { protocol: "images_generations", model: "gpt-image-2", sizes: [] };
  assert.equal(compatibleProviderPresetForEndpoint("https://images.example.com/v1/responses"), null);
  assert.deepEqual(compatibleImageSizesFor("https://images.example.com/v1/responses", image), []);
  assert.deepEqual(compatibleImageSizesFor("https://images.example.com/v1/responses", {
    ...image,
    sizes: ["1536x1024"]
  }), ["1536x1024"]);
});
