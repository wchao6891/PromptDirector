export async function runAnalysisClaimsIndependently(options = {}) {
  const claims = Array.isArray(options.claims) ? options.claims : [];
  if (typeof options.analyze !== "function" || typeof options.commit !== "function") {
    throw new TypeError("批量分析执行器缺少分析或保存函数");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new TypeError("批量分析执行器缺少有效的超时时间");
  }
  if (typeof options.timeoutResult !== "function") {
    throw new TypeError("批量分析执行器缺少超时结果函数");
  }

  return Promise.allSettled(claims.map((claim) => runClaim(claim, options)));
}

async function runClaim(claim, options) {
  if (options.signal?.aborted) return { status: "aborted" };
  const controller = new AbortController();
  let timeoutId = 0;
  let removeAbortListener = () => undefined;

  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ kind: "timeout" });
      controller.abort();
    }, options.timeoutMs);
  });
  const stopped = new Promise((resolve) => {
    if (!options.signal) return;
    const onAbort = () => {
      resolve({ kind: "aborted" });
      controller.abort();
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => options.signal.removeEventListener("abort", onAbort);
  });
  const analysis = Promise.resolve()
    .then(() => options.analyze(claim, controller.signal))
    .then(
      (value) => ({ kind: "result", value }),
      (error) => ({ kind: "error", error })
    );

  try {
    const outcome = await Promise.race([analysis, timeout, stopped]);
    if (outcome.kind === "aborted") return { status: "aborted" };
    if (outcome.kind === "error") throw outcome.error;
    const result = outcome.kind === "timeout" ? options.timeoutResult(claim) : outcome.value;
    return { status: "committed", response: await options.commit(result, claim) };
  } finally {
    clearTimeout(timeoutId);
    removeAbortListener();
  }
}
