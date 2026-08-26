import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURRENT_LIBRARY_PACKAGE_VERSION,
  SUPPORTED_LIBRARY_PACKAGE_VERSIONS
} from "../library-package-format.js";
import { prepareLibraryPackageDraft } from "../library-package-migrations.js";
import { migrateLibraryState } from "../migration.js";
import { SCHEMA_VERSION } from "../taxonomy.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(projectRoot, "test", "fixtures", "compat");

export async function verifyDataCompatibility() {
  const matrix = await readJson(join(fixtureRoot, "compatibility-matrix.json"));
  const provenance = await readJson(join(fixtureRoot, "provenance.json"));
  const packageVersions = matrix.publishedPackages.map(({ version }) => version);
  assertEqual(packageVersions, SUPPORTED_LIBRARY_PACKAGE_VERSIONS, "兼容清单与代码声明的分享包版本不一致");
  assertEqual(packageVersions, consecutiveVersions(CURRENT_LIBRARY_PACKAGE_VERSION), "已发布分享包版本必须从 v1 连续保留到当前版本");

  const checkedPackageVersions = [];
  for (const item of matrix.publishedPackages) {
    const origin = provenance.packages?.[item.provenance];
    assert(origin && origin.sourceCommit && origin.sourceRelease, `分享包 v${item.version} 缺少来源记录`);
    const source = await readJson(join(fixtureRoot, item.fixture));
    assert(source.version === item.version, `分享包 v${item.version} 夹具声明了错误版本`);
    const migrated = prepareLibraryPackageDraft(source);
    assert(migrated.sourceVersion === item.version, `分享包 v${item.version} 未从声明版本进入迁移链`);
    assert(migrated.draft.version === CURRENT_LIBRARY_PACKAGE_VERSION, `分享包 v${item.version} 未迁移到当前格式`);
    assert(migrated.draft.schemaVersion === SCHEMA_VERSION, `分享包 v${item.version} 未迁移到当前资料库结构`);
    checkedPackageVersions.push(item.version);
  }

  const baselineTag = process.env.PROMPTDIRECTOR_COMPAT_BASELINE_TAG || latestReleaseTag();
  const baseline = releaseVersions(baselineTag);
  for (const version of baseline.packageVersions) {
    assert(SUPPORTED_LIBRARY_PACKAGE_VERSIONS.includes(version), `当前代码删除了 ${baselineTag} 已支持的分享包 v${version}`);
  }
  assert(CURRENT_LIBRARY_PACKAGE_VERSION >= baseline.currentPackageVersion, "分享包当前版本不得倒退");
  assert(SCHEMA_VERSION >= baseline.schemaVersion, "本机资料库结构版本不得倒退");

  const checkedStorageSchemas = [];
  for (const item of matrix.releasedStorageSchemas) {
    const source = await readJson(join(fixtureRoot, item.fixture));
    assert(source.schemaVersion === item.schemaVersion, `资料库 schema ${item.schemaVersion} 夹具声明错误`);
    const migrated = migrateLibraryState(source).state;
    assert(migrated.schemaVersion === SCHEMA_VERSION, `资料库 schema ${item.schemaVersion} 未迁移到当前结构`);
    assertEqual(migrated.entries.map(({ id }) => id).sort(), [...item.activeEntryIds].sort(), `资料库 schema ${item.schemaVersion} 活跃案例发生变化`);
    assertEqual(
      migrated.trashState.items.filter(({ kind }) => kind === "entry").map(({ targetId }) => targetId).sort(),
      [...item.trashedEntryIds].sort(),
      `资料库 schema ${item.schemaVersion} 回收站案例发生变化`
    );
    assertEqual(migrated.organizerState.collections.map(({ id }) => id).sort(), [...item.projectIds].sort(), `资料库 schema ${item.schemaVersion} 项目发生变化`);
    checkedStorageSchemas.push(item.schemaVersion);
  }
  assert(checkedStorageSchemas.includes(baseline.schemaVersion), `${baselineTag} 的资料库 schema ${baseline.schemaVersion} 没有固定兼容夹具`);
  assert(checkedStorageSchemas.includes(SCHEMA_VERSION), `当前资料库 schema ${SCHEMA_VERSION} 没有固定基线夹具；数据版本变化必须同时增加事故案例`);

  return {
    current: { packageVersion: CURRENT_LIBRARY_PACKAGE_VERSION, schemaVersion: SCHEMA_VERSION },
    releaseBaseline: { tag: baselineTag, schemaVersion: baseline.schemaVersion, packageVersion: baseline.currentPackageVersion },
    packageVersions: { supported: [...SUPPORTED_LIBRARY_PACKAGE_VERSIONS], checked: checkedPackageVersions },
    storageSchemas: { checked: checkedStorageSchemas }
  };
}

function latestReleaseTag() {
  try {
    return execFileSync("git", ["describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8"
    }).trim();
  } catch {
    throw new Error("无法确定上一正式版本；请完整获取 Git 标签或设置 PROMPTDIRECTOR_COMPAT_BASELINE_TAG");
  }
}

function releaseVersions(tag) {
  const taxonomy = gitFile(tag, "taxonomy.js");
  const packageFormat = gitFile(tag, "library-package-format.js");
  const schemaVersion = integerConstant(taxonomy, "SCHEMA_VERSION");
  const currentPackageVersion = integerConstant(packageFormat, "CURRENT_LIBRARY_PACKAGE_VERSION");
  const supportedLiteral = packageFormat.match(/SUPPORTED_LIBRARY_PACKAGE_VERSIONS\s*=\s*Object\.freeze\(\[([^\]]+)\]\)/u)?.[1];
  assert(supportedLiteral, `${tag} 无法读取已支持分享包版本`);
  return {
    schemaVersion,
    currentPackageVersion,
    packageVersions: [...supportedLiteral.matchAll(/\d+/gu)].map(([value]) => Number(value))
  };
}

function gitFile(tag, path) {
  try {
    return execFileSync("git", ["show", `${tag}:${path}`], { cwd: projectRoot, encoding: "utf8" });
  } catch {
    throw new Error(`无法读取 ${tag} 的 ${path}`);
  }
}

function integerConstant(source, name) {
  const value = source.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\d+)`, "u"))?.[1];
  assert(value, `无法读取 ${name}`);
  return Number(value);
}

function consecutiveVersions(current) {
  return Array.from({ length: current }, (_, index) => index + 1);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}：${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyDataCompatibility()
    .then((report) => {
      if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report)}\n`);
      else process.stdout.write(`兼容门禁通过：分享包 v${report.packageVersions.checked.join("/v")}；资料库 schema ${report.storageSchemas.checked.join("/")}；基线 ${report.releaseBaseline.tag}\n`);
    })
    .catch((error) => {
      process.stderr.write(`兼容门禁失败：${error.message}\n`);
      process.exitCode = 1;
    });
}
