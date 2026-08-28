import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { extensionArchiveName, extensionIdFromPublicKey } from "./release-identity.mjs";
import { readZipBlob } from "../zip.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const REQUIRED_MODEL_CHAIN_SCRIPTS = [
  "text_and_image_analysis_e2e.py",
  "composer_generation_e2e.py",
  "composer_video_generation_e2e.py",
  "creative_job_recovery_e2e.py",
  "ai_provider_registry_e2e.py",
  "zhipu_glm_analysis_e2e.py"
];

export function parseE2eOutput(value = "") {
  const scripts = [];
  for (const match of String(value).matchAll(/^\[(PASS|FAIL)\]\s+([^\s]+)\s+\(([^)]+)\)$/gmu)) {
    scripts.push({ status: match[1] === "PASS" ? "passed" : "failed", script: match[2], duration: match[3] });
  }
  return {
    total: scripts.length,
    passed: scripts.filter((item) => item.status === "passed").length,
    failed: scripts.filter((item) => item.status === "failed").length,
    scripts
  };
}

export async function hashRuntimeFiles(files) {
  const digest = createHash("sha256");
  for (const [name, blob] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(`${name.length}:${name}:`);
    digest.update(new Uint8Array(await blob.arrayBuffer()));
  }
  return digest.digest("hex");
}

export function buildLabReceipt({
  startedAt,
  finishedAt,
  manifest,
  archive,
  runtimeHash,
  extensionId,
  channel,
  preflight,
  preflightFacts,
  e2e,
  source
}) {
  const e2eSummary = parseE2eOutput(e2e.output);
  const preflightFactsValid = preflight.code === 0
    && preflightFacts?.extensionId === extensionId
    && preflightFacts?.manifestVersion === String(manifest.version ?? "")
    && String(preflightFacts?.serviceWorker ?? "") === `chrome-extension://${extensionId}/background.js`
    && JSON.stringify(preflightFacts?.pages) === JSON.stringify([
      `chrome-extension://${extensionId}/collector.html`,
      `chrome-extension://${extensionId}/library.html`,
      `chrome-extension://${extensionId}/composer.html`
    ])
    && JSON.stringify(preflightFacts?.screenshots) === JSON.stringify([
      "collector.png", "library.png", "composer.png"
    ]);
  const scriptStatus = new Map(e2eSummary.scripts.map((item) => [item.script, item.status]));
  const missingModelChainScripts = REQUIRED_MODEL_CHAIN_SCRIPTS.filter((script) => !scriptStatus.has(script));
  const failedModelChainScripts = REQUIRED_MODEL_CHAIN_SCRIPTS.filter((script) => scriptStatus.get(script) === "failed");
  const modelChainPassed = missingModelChainScripts.length === 0 && failedModelChainScripts.length === 0;
  const passed = preflightFactsValid
    && e2e.code === 0
    && e2eSummary.failed === 0
    && e2eSummary.total > 0
    && modelChainPassed;
  return {
    schema: "promptdirector-local-extension-lab",
    version: 1,
    startedAt,
    finishedAt,
    status: passed ? "passed" : "failed",
    source,
    extension: {
      version: String(manifest.version ?? ""),
      id: extensionId,
      archive: archive.name,
      archiveSha256: archive.sha256,
      runtimeSha256: runtimeHash,
      runtimeFiles: archive.fileCount
    },
    browser: {
      channel,
      userAgent: String(preflightFacts?.userAgent ?? ""),
      profile: "fresh-isolated-profile-per-scenario",
      runtime: "chrome-for-testing-with-packaged-fixed-id-extension"
    },
    checks: {
      packagedRuntimeLoaded: preflightFactsValid,
      fullBrowserSuitePassed: e2e.code === 0 && e2eSummary.failed === 0 && e2eSummary.total > 0,
      modelChainPassed,
      modelChain: {
        required: REQUIRED_MODEL_CHAIN_SCRIPTS,
        missing: missingModelChainScripts,
        failed: failedModelChainScripts
      },
      e2e: e2eSummary
    },
    proofBoundary: {
      localPackagedChromeForTesting: passed,
      userInstalledChrome: false,
      liveProvider: false,
      chromeWebStore: false
    },
    artifacts: {
      preflightLog: "preflight.log",
      e2eLog: "e2e.log",
      preflightFacts: "preflight.json",
      screenshots: Array.isArray(preflightFacts?.screenshots) ? preflightFacts.screenshots : []
    }
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const manifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
  const archiveName = extensionArchiveName(manifest);
  const archivePath = join(projectRoot, "dist", archiveName);
  const archiveBytes = await readFile(archivePath);
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  const files = await readZipBlob(new Blob([archiveBytes]));
  const runtimeHash = await hashRuntimeFiles(files);
  const extensionId = extensionIdFromPublicKey(manifest);
  const labRoot = join(projectRoot, "dist", "local-extension-lab");
  const extensionDir = join(labRoot, "extension");
  const stagingDir = join(labRoot, `extension.staging-${process.pid}`);
  const runName = startedAt.replaceAll(":", "-").replaceAll(".", "-");
  const runDir = join(labRoot, "runs", runName);
  const channel = cleanChannel(process.env.PROMPTDIRECTOR_LAB_CHANNEL);

  await extractRuntime(files, stagingDir, extensionDir);
  await mkdir(runDir, { recursive: true });

  const environment = {
    ...process.env,
    PROMPTDIRECTOR_E2E_EXTENSION_DIR: extensionDir,
    PROMPTDIRECTOR_E2E_CHANNEL: channel,
    PROMPTDIRECTOR_E2E_EXPECTED_EXTENSION_ID: extensionId,
    PROMPTDIRECTOR_E2E_EXPECTED_VERSION: String(manifest.version ?? ""),
    PROMPTDIRECTOR_LAB_EVIDENCE_DIR: runDir,
    PROMPTDIRECTOR_E2E_BLOCK_EXTERNAL_NETWORK: "1"
  };
  const preflight = await runCaptured("python3", ["test/local_extension_lab_e2e.py"], environment);
  await writeFile(join(runDir, "preflight.log"), preflight.output);
  const preflightFacts = await readJsonIfExists(join(runDir, "preflight.json"));
  const e2e = preflight.code === 0
    ? await runCaptured("python3", ["test/run_e2e.py"], environment)
    : { code: 1, output: "未运行：本地插件预检失败。\n" };
  await writeFile(join(runDir, "e2e.log"), e2e.output);

  const source = await sourceFacts();
  const receipt = buildLabReceipt({
    startedAt,
    finishedAt: new Date().toISOString(),
    manifest,
    archive: { name: archiveName, sha256: archiveSha256, fileCount: files.size },
    runtimeHash,
    extensionId,
    channel,
    preflight,
    preflightFacts,
    e2e,
    source
  });
  await writeFile(join(runDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(join(labRoot, "latest.json"), `${JSON.stringify({ ...receipt, runDirectory: runDir }, null, 2)}\n`);
  process.stdout.write(`\n本地插件实验室：${receipt.status === "passed" ? "通过" : "失败"}\n证据：${runDir}\n`);
  if (receipt.status !== "passed") process.exitCode = 1;
}

async function extractRuntime(files, stagingDir, extensionDir) {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  const stagingRoot = `${resolve(stagingDir)}${sep}`;
  for (const [name, blob] of files) {
    const target = resolve(stagingDir, name);
    if (!target.startsWith(stagingRoot)) throw new Error(`插件包包含不安全路径：${name}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(await blob.arrayBuffer()));
  }
  await rm(extensionDir, { recursive: true, force: true });
  await rename(stagingDir, extensionDir);
}

function cleanChannel(value) {
  const channel = String(value ?? "").trim();
  if (!channel) return "chromium";
  if (channel !== "chromium") {
    throw new Error(`本地插件自动化只支持 Chrome for Testing（channel=chromium），收到：${channel}`);
  }
  return channel;
}

async function runCaptured(command, args, env) {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ code: Number.isInteger(code) ? code : 1, output }));
  });
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function sourceFacts() {
  const commit = await runQuiet("git", ["rev-parse", "HEAD"]);
  const status = await runQuiet("git", ["status", "--short"]);
  return { commit: commit.trim(), dirty: Boolean(status.trim()) };
}

async function runQuiet(command, args) {
  return await new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", () => resolveResult(""));
    child.once("close", () => resolveResult(output));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
