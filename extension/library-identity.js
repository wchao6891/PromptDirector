// The existing browser library keeps the identifier already used by pd-ref
// links. Device/Agent pairing can then change without renaming that library.
export const LIBRARY_IDENTITY_KEY = "libraryIdentity";
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function validate(value) {
  if (!value || value.version !== 1 || value.backend !== "browser"
    || typeof value.libraryId !== "string" || !value.libraryId.trim()) {
    fail("library_identity_invalid", "资料库身份记录无法读取，已停止生成新编号；请保留现有资料并检查。");
  }
  return value;
}

export function createBrowserLibraryIdentity({ storage, getLegacyId, lock } = {}) {
  const serialize = lock || (operation => navigator.locks.request("promptdirector-library-identity", operation));
  return Object.freeze({
    read: () => serialize(async () => {
      const stored = await storage.get(LIBRARY_IDENTITY_KEY);
      if (Object.hasOwn(stored, LIBRARY_IDENTITY_KEY)) return validate(stored[LIBRARY_IDENTITY_KEY]);
      // Do not mint a replacement id: every existing saved reference already
      // addresses this library using the original Agent instance id.
      const libraryId = await getLegacyId();
      const identity = validate({ version: 1, backend: "browser", libraryId });
      await storage.set({ [LIBRARY_IDENTITY_KEY]: identity });
      const persisted = validate((await storage.get(LIBRARY_IDENTITY_KEY))[LIBRARY_IDENTITY_KEY]);
      if (persisted.libraryId !== libraryId) fail("library_identity_conflict", "资料库身份在初始化期间改变，请重新读取。");
      return persisted;
    })
  });
}
