import { SCHEMA_VERSION } from "./taxonomy.js";

// A library saved by a newer PromptDirector may use records this version does not understand.
// It is never migrated "down" or rewritten here; the user updates the extension instead.
export const NEWER_LIBRARY_CODE = "LIBRARY_FROM_NEWER_VERSION";
export const NEWER_LIBRARY_MESSAGE = "资料库由更新版本的 PromptDirector 保存，请先更新插件再打开；资料没有被改动";

export function libraryFromNewerVersion(stored = {}) {
  const newer = value => Number.isInteger(value) && value > SCHEMA_VERSION;
  return newer(stored.schemaVersion) || (Array.isArray(stored.entries) && stored.entries.some(entry => newer(entry?.schemaVersion)));
}

export function newerLibraryError() {
  return Object.assign(new Error(NEWER_LIBRARY_MESSAGE), { code: NEWER_LIBRARY_CODE });
}

// Runs inside the metadata write lock before every write, so no page or background path can
// overwrite a newer library, even one that never went through the migration check.
export async function assertLibraryWritable(backend) {
  const { schemaVersion } = await backend.get(["schemaVersion"]);
  if (Number.isInteger(schemaVersion) && schemaVersion > SCHEMA_VERSION) throw newerLibraryError();
}
