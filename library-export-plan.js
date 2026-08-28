const FOLDER_BACKUP_FORMAT = "prompt-director-folder-backup";
const FOLDER_RESCUE_FORMAT = "prompt-director-folder-rescue";
const BACKUP_MARKER_PATHS = new Set(["complete.json", "rescue.json"]);

export async function buildFolderBackupCompletion(filesValue, metadata = {}) {
  return buildFolderMarker(filesValue, metadata, {
    format: FOLDER_BACKUP_FORMAT,
    version: 2,
    status: "complete"
  });
}

export async function buildFolderRescueCompletion(filesValue, metadata = {}) {
  return buildFolderMarker(filesValue, metadata, {
    format: FOLDER_RESCUE_FORMAT,
    version: 1,
    status: "rescue",
    issues: Array.isArray(metadata.issues) ? structuredClone(metadata.issues) : []
  });
}

export async function buildFolderBackupWritePlan({ files: filesValue, report = {}, metadata = {} } = {}) {
  const files = backupFiles(filesValue);
  if (!(files.get("library.json") instanceof Blob)) throw new Error("备份写入计划缺少 library.json");
  const diagnostics = Array.isArray(report?.diagnostics) ? structuredClone(report.diagnostics) : [];
  const rescue = report?.status === "partial" || diagnostics.length > 0;
  const marker = rescue
    ? await buildFolderRescueCompletion(files, { ...metadata, issues: diagnostics })
    : await buildFolderBackupCompletion(files, metadata);
  if (rescue) await verifyFolderRescueCompletion(marker, files);
  else await verifyFolderBackupCompletion(marker, files);
  return {
    mode: rescue ? "rescue" : "complete",
    markerPath: rescue ? "rescue.json" : "complete.json",
    marker,
    files,
    report: {
      status: rescue ? "partial" : "ready",
      diagnostics,
      stats: report?.stats && typeof report.stats === "object" ? structuredClone(report.stats) : {}
    }
  };
}

async function buildFolderMarker(filesValue, metadata, identity) {
  const files = backupFiles(filesValue);
  const manifest = [];
  for (const [path, blob] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    manifest.push({ path, byteSize: blob.size, sha256: await sha256Blob(blob) });
  }
  return {
    ...identity,
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
  return verifyFolderMarker(completionValue, filesValue, {
    format: FOLDER_BACKUP_FORMAT,
    version: 2,
    invalidMessage: "完整备份标记无效",
    integrityLabel: "完整备份"
  });
}

export async function verifyFolderRescueCompletion(completionValue, filesValue) {
  return verifyFolderMarker(completionValue, filesValue, {
    format: FOLDER_RESCUE_FORMAT,
    version: 1,
    invalidMessage: "救援备份标记无效",
    integrityLabel: "救援备份"
  });
}

export async function inspectFolderBackupEnvelope(filesValue) {
  const files = filesValue instanceof Map ? filesValue : new Map();
  const libraryFile = files.get("library.json");
  if (!(libraryFile instanceof Blob)) throw new Error("资料夹备份缺少 library.json");

  let completeFailure = null;
  const completeFile = files.get("complete.json");
  if (completeFile instanceof Blob) {
    try {
      const marker = await markerJson(completeFile);
      if (marker?.format === FOLDER_BACKUP_FORMAT && Number(marker.version) > 2) {
        throw updateRequiredError();
      }
      if (marker?.format === FOLDER_BACKUP_FORMAT && marker.version === 1) {
        return folderEnvelope("complete", marker, libraryFile, []);
      }
      const verification = await verifyFolderBackupCompletion(marker, files);
      return folderEnvelope("complete", marker, libraryFile, extraFileDiagnostics(verification.extraPaths));
    } catch (error) {
      if (error?.code === "BACKUP_MARKER_FUTURE") throw error;
      completeFailure = rescueDiagnostic("complete_integrity_failure");
    }
  } else {
    completeFailure = rescueDiagnostic("missing_complete_marker");
  }

  const rescueFile = files.get("rescue.json");
  if (rescueFile instanceof Blob) {
    try {
      const marker = await markerJson(rescueFile);
      if (marker?.format === FOLDER_RESCUE_FORMAT && Number(marker.version) > 1) {
        throw updateRequiredError();
      }
      const verification = await verifyFolderRescueCompletion(marker, files);
      const diagnostics = [
        ...(Array.isArray(marker.issues) ? structuredClone(marker.issues) : []),
        ...extraFileDiagnostics(verification.extraPaths)
      ];
      return folderEnvelope("rescue", marker, libraryFile, diagnostics);
    } catch (error) {
      if (error?.code === "BACKUP_MARKER_FUTURE") throw error;
      return folderEnvelope("rescue", null, libraryFile, [rescueDiagnostic("rescue_integrity_failure")]);
    }
  }

  return folderEnvelope("rescue", null, libraryFile, [completeFailure]);
}

function folderEnvelope(mode, marker, libraryFile, diagnostics) {
  return {
    mode,
    marker,
    libraryFile,
    report: {
      status: diagnostics.length ? "partial" : "ready",
      diagnostics,
      stats: {}
    }
  };
}

function rescueDiagnostic(reason) {
  return {
    code: "backup_integrity_degraded",
    severity: "backup",
    action: "rescue",
    reason
  };
}

function extraFileDiagnostics(paths) {
  return (Array.isArray(paths) ? paths : []).map((path) => ({
    code: "extra_file_ignored",
    severity: "file",
    action: "ignored",
    path,
    reason: "not_in_manifest"
  }));
}

async function markerJson(blob) {
  try {
    return JSON.parse(await blob.text());
  } catch {
    throw new Error("备份标记无法解析");
  }
}

function updateRequiredError() {
  return Object.assign(new Error("该资料夹由更高版本创建，请先更新 PromptDirector"), {
    code: "BACKUP_MARKER_FUTURE"
  });
}

async function verifyFolderMarker(completionValue, filesValue, expected) {
  const completion = completionValue && typeof completionValue === "object" ? completionValue : {};
  if (completion.format !== expected.format || completion.version !== expected.version || !Array.isArray(completion.files)) {
    throw new Error(expected.invalidMessage);
  }
  const files = backupFiles(filesValue);
  if (completion.fileCount !== completion.files.length) {
    throw new Error(`${expected.integrityLabel}的文件清单完整性校验失败`);
  }
  const expectedPaths = new Set();
  for (const descriptor of completion.files) {
    const path = safePath(descriptor?.path);
    if (!path || expectedPaths.has(path)) throw new Error(`${expected.integrityLabel}的文件清单完整性校验失败`);
    expectedPaths.add(path);
    const blob = files.get(path);
    if (!(blob instanceof Blob) || blob.size !== descriptor.byteSize || await sha256Blob(blob) !== descriptor.sha256) {
      throw new Error(`${expected.integrityLabel}文件“${path}”完整性校验失败`);
    }
  }
  return {
    extraPaths: [...files.keys()].filter((path) => !expectedPaths.has(path)).sort()
  };
}

function backupFiles(value) {
  const source = value instanceof Map ? value : new Map();
  return new Map([...source].filter(([path, blob]) =>
    safePath(path) && !BACKUP_MARKER_PATHS.has(path) && blob instanceof Blob
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
