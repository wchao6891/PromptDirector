const FOLDER_BACKUP_FORMAT = "prompt-director-folder-backup";

export async function buildFolderBackupCompletion(filesValue, metadata = {}) {
  const files = backupFiles(filesValue);
  const manifest = [];
  for (const [path, blob] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    manifest.push({ path, byteSize: blob.size, sha256: await sha256Blob(blob) });
  }
  return {
    format: FOLDER_BACKUP_FORMAT,
    version: 2,
    createdAt: validIso(metadata.createdAt) || new Date().toISOString(),
    caseCount: nonNegativeInteger(metadata.caseCount),
    trashCaseCount: nonNegativeInteger(metadata.trashCaseCount),
    trashProjectCount: nonNegativeInteger(metadata.trashProjectCount),
    mediaCount: nonNegativeInteger(metadata.mediaCount),
    byteSize: nonNegativeInteger(metadata.byteSize),
    fileCount: manifest.length,
    files: manifest
  };
}

export async function verifyFolderBackupCompletion(completionValue, filesValue) {
  const completion = completionValue && typeof completionValue === "object" ? completionValue : {};
  if (completion.format !== FOLDER_BACKUP_FORMAT || completion.version !== 2 || !Array.isArray(completion.files)) {
    throw new Error("完整备份标记无效");
  }
  const files = backupFiles(filesValue);
  if (completion.fileCount !== completion.files.length || files.size !== completion.files.length) {
    throw new Error("完整备份的文件清单完整性校验失败");
  }
  const expectedPaths = new Set();
  for (const descriptor of completion.files) {
    const path = safePath(descriptor?.path);
    if (!path || expectedPaths.has(path)) throw new Error("完整备份的文件清单完整性校验失败");
    expectedPaths.add(path);
    const blob = files.get(path);
    if (!(blob instanceof Blob) || blob.size !== descriptor.byteSize || await sha256Blob(blob) !== descriptor.sha256) {
      throw new Error(`完整备份文件“${path}”完整性校验失败`);
    }
  }
  return true;
}

function backupFiles(value) {
  const source = value instanceof Map ? value : new Map();
  return new Map([...source].filter(([path, blob]) =>
    safePath(path) && path !== "complete.json" && blob instanceof Blob
  ));
}

function safePath(value) {
  const path = String(value ?? "").replaceAll("\\", "/").trim();
  if (!path || path.startsWith("/") || path.includes("..") || path.split("/").some((part) => !part || part === ".")) return "";
  return path;
}

async function sha256Blob(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function validIso(value) {
  const text = String(value ?? "").trim();
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}
