// Developer-only phase timing. Off unless a maintainer enables it for the current browser session:
//   chrome.storage.session.set({ promptDirectorTiming: true })
// Then read `promptDirectorTiming.summary()` in the service worker or page console. Only scope/phase
// names, durations and byte counts are kept; library content never enters a sample.
const SESSION_KEY = "promptDirectorTiming";
// P95 needs a few dozen samples; this keeps a steady window per phase while bounding memory.
const SAMPLES_PER_PHASE = 512;
const phases = new Map();
let enabled = false;

const noop = () => {};
const now = () => globalThis.performance?.now?.() ?? Date.now();

export function setTimingEnabled(value) {
  enabled = value === true;
  if (!enabled) phases.clear();
}

const session = globalThis.chrome?.storage?.session;
if (session) {
  session.get(SESSION_KEY).then((stored) => setTimingEnabled(stored?.[SESSION_KEY]), noop);
  globalThis.chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === "session" && SESSION_KEY in changes) setTimingEnabled(changes[SESSION_KEY].newValue);
  });
}

export function timingEnabled() {
  return enabled;
}

// Phases starting with "wait:" are external waits (network, provider, browser API), the rest local work.
export function startPhase(scope, phase) {
  if (!enabled) return noop;
  const started = now();
  return (extra = {}) => {
    if (!enabled) return;
    const bytes = typeof extra.bytes === "function" ? extra.bytes() : extra.bytes;
    recordPhase(scope, phase, now() - started, Number.isFinite(bytes) ? bytes : undefined);
  };
}

export async function tracePhase(scope, phase, task) {
  const done = startPhase(scope, phase);
  try {
    return await task();
  } finally {
    done();
  }
}

export function recordPhase(scope, phase, milliseconds, bytes) {
  if (!enabled) return;
  const key = `${scope}/${phase}`;
  let samples = phases.get(key);
  if (!samples) phases.set(key, samples = []);
  samples.push({ ms: milliseconds, bytes });
  if (samples.length > SAMPLES_PER_PHASE) samples.shift();
}

// Byte size of a JSON-compatible value; only evaluated while timing is enabled.
export function jsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
  } catch {
    return undefined;
  }
}

export function timingSummary() {
  return [...phases].map(([key, samples]) => {
    const durations = samples.map((sample) => sample.ms).sort((left, right) => left - right);
    const sizes = samples.map((sample) => sample.bytes).filter(Number.isFinite).sort((left, right) => left - right);
    return {
      phase: key,
      kind: key.split("/").at(-1).startsWith("wait:") ? "external" : "local",
      count: durations.length,
      p50Ms: round(percentile(durations, 0.5)),
      p95Ms: round(percentile(durations, 0.95)),
      maxMs: round(durations.at(-1)),
      totalMs: round(durations.reduce((sum, value) => sum + value, 0)),
      ...(sizes.length ? { p50Bytes: percentile(sizes, 0.5), maxBytes: sizes.at(-1) } : {})
    };
  }).sort((left, right) => left.phase.localeCompare(right.phase));
}

export function resetTiming() {
  phases.clear();
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

globalThis.promptDirectorTiming = { summary: timingSummary, reset: resetTiming, enabled: timingEnabled };
