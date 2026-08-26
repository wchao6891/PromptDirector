import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extensionArchiveName } from "./release-identity.mjs";
import { verifyDataCompatibility } from "./check-data-compatibility.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const python = process.env.PYTHON || "python3";
const temporaryRoot = await mkdtemp(join(tmpdir(), "promptdirector-release-upgrade-"));

try {
  const report = await verifyDataCompatibility();
  const manifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
  const currentArchive = join(projectRoot, "dist", extensionArchiveName(manifest));
  const previousDirectory = join(temporaryRoot, "previous-release");
  const currentDirectory = join(temporaryRoot, "current-package");
  const previousArchive = join(temporaryRoot, "previous-release.tar");
  await mkdir(previousDirectory);
  await mkdir(currentDirectory);

  execFileSync("git", ["archive", "--format=tar", report.releaseBaseline.tag, "-o", previousArchive], {
    cwd: projectRoot,
    stdio: "inherit"
  });
  execFileSync("tar", ["-xf", previousArchive, "-C", previousDirectory], { stdio: "inherit" });
  try {
    await access(currentArchive);
  } catch {
    throw new Error(`最终固定 ID 包不存在，请先运行 npm run package：${currentArchive}`);
  }
  try {
    execFileSync("unzip", ["-q", currentArchive, "-d", currentDirectory], { stdio: "inherit" });
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("系统缺少 unzip，无法解压最终固定 ID 包进行升级演练");
    throw error;
  }

  execFileSync(python, [join(projectRoot, "test", "release_upgrade_e2e.py")], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PROMPTDIRECTOR_PREVIOUS_EXTENSION_DIR: previousDirectory,
      PROMPTDIRECTOR_CURRENT_EXTENSION_DIR: currentDirectory,
      PROMPTDIRECTOR_PREVIOUS_RELEASE_TAG: report.releaseBaseline.tag
    }
  });
  process.stdout.write(`升级演练通过：${report.releaseBaseline.tag} 资料 → ${manifest.version} 最终固定 ID 包\n`);
} catch (error) {
  process.stderr.write(`升级演练失败：${error.message}\n`);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
