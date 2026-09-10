import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extensionArchiveName } from "./release-identity.mjs";
import { verifyDataCompatibility } from "./check-data-compatibility.mjs";
import { compareExtensionVersions } from "../extension/extension-update.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const python = process.env.PYTHON || "python3";
const temporaryRoot = await mkdtemp(join(tmpdir(), "promptdirector-release-upgrade-"));

try {
  const report = await verifyDataCompatibility();
  const manifest = JSON.parse(await readFile(join(projectRoot, "extension", "manifest.json"), "utf8"));
  let baselineTag = report.releaseBaseline.tag;
  if (compareExtensionVersions(baselineTag.replace(/^v/u, ""), manifest.version) >= 0) {
    baselineTag = execFileSync("git", ["tag", "--merged", "HEAD", "--sort=-version:refname", "--list", "v[0-9]*"], { cwd: projectRoot, encoding: "utf8" })
      .trim().split("\n").find(tag => compareExtensionVersions(tag.slice(1), manifest.version) < 0);
    if (!baselineTag) throw new Error("找不到早于当前版本的已发布升级基线");
  }
  const currentArchive = join(projectRoot, "dist", extensionArchiveName(manifest));
  const previousDirectory = join(temporaryRoot, "previous-release");
  const currentDirectory = join(temporaryRoot, "current-package");
  const previousArchive = join(temporaryRoot, "previous-release.zip");
  await mkdir(previousDirectory);
  await mkdir(currentDirectory);

  execFileSync("git", ["archive", "--format=zip", baselineTag, "-o", previousArchive], {
    cwd: projectRoot,
    stdio: "inherit"
  });
  execFileSync(python, ["-m", "zipfile", "-e", previousArchive, previousDirectory], { stdio: "inherit" });
  try {
    await access(currentArchive);
  } catch {
    throw new Error(`最终固定 ID 包不存在，请先运行 npm run package：${currentArchive}`);
  }
  execFileSync(python, ["-m", "zipfile", "-e", currentArchive, currentDirectory], { stdio: "inherit" });

  execFileSync(python, [join(projectRoot, "test", "release_upgrade_e2e.py")], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PROMPTDIRECTOR_NODE: process.execPath,
      PROMPTDIRECTOR_CURRENT_ARCHIVE: currentArchive,
      PROMPTDIRECTOR_PREVIOUS_EXTENSION_DIR: await sourceExtensionDirectory(previousDirectory),
      PROMPTDIRECTOR_CURRENT_EXTENSION_DIR: currentDirectory,
      PROMPTDIRECTOR_PREVIOUS_RELEASE_TAG: baselineTag
    }
  });
  const nativePreviousDirectory = join(temporaryRoot, "native-previous-release");
  await mkdir(nativePreviousDirectory);
  execFileSync(python, ["-m", "zipfile", "-e", previousArchive, nativePreviousDirectory], { stdio: "inherit" });
  execFileSync(python, [join(projectRoot, "test", "local_upgrade_native_e2e.py"), await sourceExtensionDirectory(nativePreviousDirectory), currentArchive], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env
  });
  process.stdout.write(`升级演练通过：${baselineTag} 资料 → ${manifest.version} 最终固定 ID 包\n`);
} catch (error) {
  process.stderr.write(`升级演练失败：${error.message}\n`);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function sourceExtensionDirectory(directory) {
  const nested = join(directory, "extension");
  try { await access(join(nested, "manifest.json")); return nested; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await access(join(directory, "manifest.json"));
  return directory;
}
