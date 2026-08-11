import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultProjectRoot = fileURLToPath(new URL("../", import.meta.url));
const runtimeEntries = [
  ["LICENSE", "LICENSE"],
  ["build/pdf.min.mjs", "pdf.mjs"],
  ["build/pdf.worker.min.mjs", "pdf.worker.mjs"],
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
  ["wasm", "wasm"]
];

export async function syncPdfjsRuntime({ projectRoot = defaultProjectRoot } = {}) {
  const paths = pdfjsPaths(projectRoot);
  await assertDependencyVersions(paths);
  for (const [sourceName, targetName] of runtimeEntries) {
    const source = join(paths.installedRoot, sourceName);
    const target = join(paths.vendorRoot, targetName);
    await rm(target, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: true });
  }
  return verifyPdfjsRuntime({ projectRoot });
}

export async function verifyPdfjsRuntime({ projectRoot = defaultProjectRoot } = {}) {
  const paths = pdfjsPaths(projectRoot);
  const version = await assertDependencyVersions(paths);
  const expected = await runtimeFilePairs(paths);
  const actual = await listFiles(paths.vendorRoot);
  const expectedTargets = expected.map(({ target }) => relative(paths.vendorRoot, target)).sort();
  if (actual.join("\n") !== expectedTargets.join("\n")) {
    throw new Error("PDF.js vendor 文件集合与已安装依赖不一致；请运行 npm run build:pdfjs");
  }
  for (const { source, target } of expected) {
    const [sourceData, targetData] = await Promise.all([readFile(source), readFile(target)]);
    if (!sourceData.equals(targetData)) {
      throw new Error(`PDF.js vendor 文件已漂移：${relative(paths.vendorRoot, target)}`);
    }
  }
  return { version, fileCount: expected.length };
}

function pdfjsPaths(projectRoot) {
  const root = resolve(projectRoot);
  return {
    packageJson: join(root, "package.json"),
    packageLock: join(root, "package-lock.json"),
    installedPackage: join(root, "node_modules", "pdfjs-dist", "package.json"),
    installedRoot: join(root, "node_modules", "pdfjs-dist"),
    vendorRoot: join(root, "vendor", "pdfjs")
  };
}

async function assertDependencyVersions(paths) {
  const [projectPackage, lock, installedPackage] = await Promise.all([
    readJson(paths.packageJson),
    readJson(paths.packageLock),
    readJson(paths.installedPackage)
  ]);
  const declared = projectPackage.dependencies?.["pdfjs-dist"];
  const locked = lock.packages?.["node_modules/pdfjs-dist"]?.version;
  const lockRoot = lock.packages?.[""]?.dependencies?.["pdfjs-dist"];
  const installed = installedPackage.version;
  if (!/^\d+\.\d+\.\d+$/.test(declared ?? "")) {
    throw new Error("pdfjs-dist 必须在 package.json 中使用精确版本");
  }
  if (![lockRoot, locked, installed].every((version) => version === declared)) {
    throw new Error(`PDF.js 版本不一致：declared=${declared}, lockRoot=${lockRoot}, locked=${locked}, installed=${installed}`);
  }
  return declared;
}

async function runtimeFilePairs(paths) {
  const pairs = [];
  for (const [sourceName, targetName] of runtimeEntries) {
    const source = join(paths.installedRoot, sourceName);
    const target = join(paths.vendorRoot, targetName);
    if ((await stat(source)).isFile()) {
      pairs.push({ source, target });
      continue;
    }
    const children = await listFiles(source);
    for (const child of children) {
      pairs.push({ source: join(source, child), target: join(target, child) });
    }
  }
  return pairs;
}

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      for (const child of await listFiles(path)) files.push(join(entry.name, child));
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files.sort();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv.includes("--check")
    ? await verifyPdfjsRuntime()
    : await syncPdfjsRuntime();
  process.stdout.write(`PDF.js ${result.version}: ${result.fileCount} 个 vendor 文件已校验\n`);
}
