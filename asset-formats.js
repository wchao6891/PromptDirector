const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "application/x-unknown"
]);

const DEFINITIONS = [
  format("png", "image", "image", ["png"], ["image/png"]),
  format("jpeg", "image", "image", ["jpg", "jpeg"], ["image/jpeg", "image/jpg"]),
  format("webp", "image", "image", ["webp"], ["image/webp"]),
  format("gif", "image", "image", ["gif"], ["image/gif"]),
  format("avif", "image", "image", ["avif"], ["image/avif"]),

  format("mp4", "video", "video", ["mp4", "m4v"], ["video/mp4", "video/x-m4v"]),
  format("webm", "video", "video", ["webm"], ["video/webm"]),
  format("quicktime", "video", "video", ["mov"], ["video/quicktime"]),
  format("matroska", "video", "video", ["mkv"], ["video/x-matroska", "video/matroska"]),
  format("avi", "video", "video", ["avi"], ["video/x-msvideo", "video/avi"]),

  format("mp3", "audio", "audio", ["mp3"], ["audio/mpeg", "audio/mp3"]),
  format("wav", "audio", "audio", ["wav"], ["audio/wav", "audio/x-wav", "audio/wave"]),
  format("m4a", "audio", "audio", ["m4a"], ["audio/mp4", "audio/x-m4a"]),
  format("aac", "audio", "audio", ["aac"], ["audio/aac"]),
  format("flac", "audio", "audio", ["flac"], ["audio/flac", "audio/x-flac"]),
  format("ogg", "audio", "audio", ["ogg", "oga"], ["audio/ogg", "application/ogg"]),
  format("opus", "audio", "audio", ["opus"], ["audio/opus", "audio/ogg"]),
  format("aiff", "audio", "audio", ["aif", "aiff"], ["audio/aiff", "audio/x-aiff"]),
  format("wma", "audio", "audio", ["wma"], ["audio/x-ms-wma"]),

  format("pdf", "document", "document", ["pdf"], ["application/pdf"]),
  format("txt", "document", "document", ["txt"], ["text/plain"]),
  format("markdown", "document", "document", ["md", "markdown"], ["text/markdown", "text/plain"]),
  format("html", "document", "document", ["html", "htm"], ["text/html"]),
  format("rtf", "document", "document", ["rtf"], ["application/rtf", "text/rtf", "application/x-rtf"]),
  format("srt", "document", "subtitle", ["srt"], ["application/x-subrip", "text/srt", "text/plain"], { plainText: true }),
  format("webvtt", "document", "subtitle", ["vtt"], ["text/vtt", "text/plain"], { plainText: true }),
  format("ass", "document", "subtitle", ["ass", "ssa"], ["text/x-ssa", "text/plain"], { plainText: true }),
  format("sbv", "document", "subtitle", ["sbv"], ["text/plain"], { plainText: true }),
  format("lrc", "document", "subtitle", ["lrc"], ["text/plain", "application/lrc"], { plainText: true }),

  format("photoshop", "attachment", "design-source", ["psd", "psb"], ["image/vnd.adobe.photoshop", "application/x-photoshop"]),
  format("illustrator", "attachment", "design-source", ["ai"], ["application/postscript", "application/illustrator"]),
  format("eps", "attachment", "design-source", ["eps"], ["application/postscript", "image/x-eps", "application/eps"]),
  format("indesign", "attachment", "design-source", ["indd", "idml"], ["application/x-indesign"]),
  format("procreate", "attachment", "design-source", ["procreate"], ["application/x-procreate"]),
  format("sketch", "attachment", "design-source", ["sketch"], ["application/x-sketch"]),
  format("aseprite", "attachment", "design-source", ["ase", "aseprite"], ["application/x-aseprite"]),

  format("after-effects", "attachment", "motion-project", ["aep", "aepx"], ["application/x-after-effects"]),
  format("premiere", "attachment", "editing-project", ["prproj"], ["application/x-premiere"]),
  format("audition", "attachment", "audio-project", ["sesx"], ["application/x-audition-session"]),
  format("animate", "attachment", "motion-project", ["fla", "xfl"], ["application/x-adobe-animate"]),
  format("lightroom", "attachment", "design-source", ["lrcat"], ["application/x-lightroom-catalog"]),
  format("davinci-resolve", "attachment", "editing-project", ["drp", "dra"], ["application/x-davinci-resolve"]),

  format("opentype", "attachment", "font", ["otf"], ["font/otf", "application/vnd.ms-opentype", "application/x-font-opentype"]),
  format("truetype", "attachment", "font", ["ttf"], ["font/ttf", "application/x-font-ttf"]),
  format("woff", "attachment", "font", ["woff"], ["font/woff", "application/font-woff"]),
  format("woff2", "attachment", "font", ["woff2"], ["font/woff2"]),

  format("blender", "attachment", "3d-vfx", ["blend"], ["application/x-blender"]),
  format("cinema4d", "attachment", "3d-vfx", ["c4d"], ["application/x-cinema4d"]),
  format("3ds-max", "attachment", "3d-vfx", ["max", "3ds"], ["application/x-3dsmax", "application/x-3ds"]),
  format("maya", "attachment", "3d-vfx", ["ma", "mb"], ["application/x-maya"]),
  format("houdini", "attachment", "3d-vfx", ["hip", "hiplc", "hipnc"], ["application/x-houdini"]),
  format("fbx", "attachment", "3d-vfx", ["fbx"], ["application/x-fbx"]),
  format("wavefront", "attachment", "3d-vfx", ["obj"], ["model/obj", "text/plain"]),
  format("gltf", "attachment", "3d-vfx", ["gltf"], ["model/gltf+json", "application/json"]),
  format("glb", "attachment", "3d-vfx", ["glb"], ["model/gltf-binary"]),
  format("usd", "attachment", "3d-vfx", ["usd", "usda", "usdc", "usdz"], ["model/vnd.usd", "model/vnd.usdz+zip"]),
  format("alembic", "attachment", "3d-vfx", ["abc"], ["application/x-alembic"]),
  format("collada", "attachment", "3d-vfx", ["dae"], ["model/vnd.collada+xml"]),
  format("stl", "attachment", "3d-vfx", ["stl"], ["model/stl", "application/sla"]),
  format("zbrush", "attachment", "3d-vfx", ["ztl", "zbr"], ["application/x-zbrush"]),
  format("nuke", "attachment", "3d-vfx", ["nk"], ["application/x-nuke", "text/plain"]),
  format("substance", "attachment", "3d-vfx", ["sbs", "sbsar", "spp"], ["application/x-substance"])
];

export const ASSET_FORMAT_REGISTRY = Object.freeze(DEFINITIONS);
export const SUPPORTED_ASSET_KINDS = Object.freeze(["image", "video", "audio", "document", "attachment"]);

const PORTABLE_ASSET_DIRECTORIES = Object.freeze({
  image: "images",
  video: "videos",
  audio: "audio",
  document: "documents",
  attachment: "attachments"
});

const BY_EXTENSION = new Map();
const BY_MIME_TYPE = new Map();
for (const definition of ASSET_FORMAT_REGISTRY) {
  for (const extension of definition.extensions) {
    if (BY_EXTENSION.has(extension)) throw new Error(`重复的资产扩展名：${extension}`);
    BY_EXTENSION.set(extension, definition);
  }
  for (const mimeType of definition.mimeTypes) {
    const values = BY_MIME_TYPE.get(mimeType) ?? [];
    values.push(definition);
    BY_MIME_TYPE.set(mimeType, values);
  }
}

export function assetFormatForExtension(value) {
  return BY_EXTENSION.get(normalizeExtension(value)) ?? null;
}

export function assetFormatsForMimeType(value) {
  return Object.freeze([...(BY_MIME_TYPE.get(normalizeMimeType(value)) ?? [])]);
}

export function assetFormatForFile(file = {}) {
  const extension = fileExtension(file.name);
  const byExtension = assetFormatForExtension(extension);
  if (byExtension) return byExtension;
  const byMime = assetFormatsForMimeType(file.type);
  return byMime.length === 1 ? byMime[0] : null;
}

export function assetKindFromFileMetadata(file = {}) {
  const definition = assetFormatForFile(file);
  return definition && isReportedMimeCompatible(definition, file.type) ? definition.kind : "";
}

export function isReportedMimeCompatible(definition, value) {
  const mimeType = normalizeMimeType(value);
  return !mimeType || GENERIC_MIME_TYPES.has(mimeType) || Boolean(definition?.mimeTypes?.includes(mimeType));
}

export function canonicalMimeType(definition, reportedMimeType = "") {
  const mimeType = normalizeMimeType(reportedMimeType);
  return mimeType && !GENERIC_MIME_TYPES.has(mimeType) ? mimeType : definition?.mimeTypes?.[0] ?? "";
}

export function assetFileAccept(options = {}) {
  const kinds = new Set(Array.isArray(options.kinds) && options.kinds.length ? options.kinds : SUPPORTED_ASSET_KINDS);
  return ASSET_FORMAT_REGISTRY
    .filter((definition) => kinds.has(definition.kind))
    .flatMap((definition) => definition.extensions.map((extension) => `.${extension}`))
    .join(",");
}

export function extensionsForAssetKind(kind) {
  return Object.freeze(ASSET_FORMAT_REGISTRY
    .filter((definition) => definition.kind === kind)
    .flatMap((definition) => definition.extensions));
}

export function portableAssetDirectory(kindValue) {
  const kind = String(kindValue ?? "").trim();
  const directory = PORTABLE_ASSET_DIRECTORIES[kind];
  if (!directory) throw new Error(`不支持的媒体类型：${kind || "未知"}`);
  return directory;
}

export function resolvePortableAssetFormat(asset = {}, file = {}) {
  const kind = String(asset.kind ?? "").trim();
  const directory = portableAssetDirectory(kind);

  const fileMimeType = normalizeMimeType(file?.type);
  const assetMimeType = normalizeMimeType(asset?.mimeType);
  const reportedMimeType = fileMimeType && !GENERIC_MIME_TYPES.has(fileMimeType)
    ? fileMimeType
    : assetMimeType;
  const candidates = [
    normalizeExtension(asset?.sourceFormat),
    fileExtension(asset?.sourceTitle),
    ...assetFormatsForMimeType(fileMimeType).filter((item) => item.kind === kind).flatMap((item) => item.extensions),
    ...assetFormatsForMimeType(assetMimeType).filter((item) => item.kind === kind).flatMap((item) => item.extensions)
  ].filter(Boolean);

  for (const extension of [...new Set(candidates)]) {
    const definition = assetFormatForExtension(extension);
    if (definition?.kind === kind && isReportedMimeCompatible(definition, reportedMimeType)) {
      return Object.freeze({
        directory,
        extension,
        mimeType: canonicalMimeType(definition, reportedMimeType),
        formatCategory: definition.category,
        playbackCapability: ["image", "video", "audio"].includes(kind) ? "native" : "unknown"
      });
    }
    if (!definition && kind === "attachment" && /^[a-z0-9]+$/u.test(extension)) {
      return Object.freeze({
        directory,
        extension,
        mimeType: reportedMimeType || "application/octet-stream",
        formatCategory: "other-source",
        playbackCapability: "unknown"
      });
    }
  }

  throw new Error(`“${asset?.sourceTitle || asset?.id || "未命名媒体"}”缺少可安全识别的文件扩展名`);
}

export function fileExtension(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US").match(/\.([a-z0-9]+)$/u)?.[1] ?? "";
}

function normalizeExtension(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/^\./u, "");
}

function normalizeMimeType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLocaleLowerCase("en-US");
}

function format(id, kind, category, extensions, mimeTypes, options = {}) {
  return Object.freeze({
    id,
    kind,
    category,
    extensions: Object.freeze(extensions),
    mimeTypes: Object.freeze(mimeTypes),
    preview: kind === "attachment" ? "inert" : options.plainText ? "text" : "native",
    plainText: options.plainText === true
  });
}
