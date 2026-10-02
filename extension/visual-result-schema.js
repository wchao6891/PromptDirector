// Current image and image-set result shapes, shared by model and Agent inputs.
const text = { type: 'string', minLength: 1 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const strings = { type: 'array', items: text };
export function createVisualModelResponseSchema() {
  return object({
    reconstructionPrompt: text,
    tags: { type: 'array', minItems: 1, maxItems: 6, items: object({ g: text, t: { type: ['string', 'null'] } }) }
  });
}
export const VISUAL_SET_RESULT_SCHEMA = object({
  imageRoles: { type: 'array', minItems: 1, items: object({ assetId: text, role: text }) },
  sharedVisualSystem: strings, differences: strings, continuity: strings, compositionRules: strings,
  reusablePrompt: text
});
