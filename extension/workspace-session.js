import { agentError } from './agent-protocol.js';
import { operationBudget } from './resource-policy.js';

// Ephemeral page state; never a second copy of the case database. A new page
// gets a new identity, so an old command cannot operate on a refreshed page.
export function createWorkspaceSession({ readState, readControlState, perform, sessionId = crypto.randomUUID(), budget = operationBudget() }) {
  let sequence = 0, controlSequence = 0, controlSignature, snapshot, signature, busy = false, commandBytes = 0;
  const changes = [], receipts = new Map(), waiters = new Set();
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const revision = () => `${sessionId}:${sequence}`;
  const controlRevision = () => `${sessionId}:control:${controlSequence}`;
  function observe(source = 'human', force = false) {
    const next = structuredClone(readState());
    const serialized = JSON.stringify(next);
    const controls = JSON.stringify(readControlState ? readControlState(next) : next);
    const controlsChanged = controls !== controlSignature || force;
    if (controlsChanged) { controlSignature = controls; controlSequence++; }
    if (serialized !== signature || force || controlsChanged) {
      signature = serialized; snapshot = next; sequence++;
      changes.push({ revision: revision(), controlRevision: controlRevision(), source, snapshot });
      while (changes.length > budget.maxAutomaticHistoryItems || bytes(changes) > budget.maxAutomaticHistoryBytes) changes.shift();
      for (const wake of [...waiters]) wake();
    }
    return { sessionId, revision: revision(), controlRevision: controlRevision(), snapshot };
  }
  function read(afterRevision) {
    const current = observe('snapshot');
    if (!afterRevision) return current;
    const prefix = `${sessionId}:`, offset = Number(afterRevision.slice(prefix.length));
    const valid = afterRevision.startsWith(prefix) && Number.isSafeInteger(offset) && offset >= 1 && offset <= sequence;
    const reset = !valid || offset < (changes[0] ? Number(changes[0].revision.slice(prefix.length)) - 1 : sequence);
    return { ...current, reset, changes: reset ? [] : changes.filter(item => Number(item.revision.slice(prefix.length)) > offset) };
  }
  async function wait({ afterRevision, waitMs = 0 }) {
    if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 15000) throw agentError('invalid_input', '等待时间无效');
    const result = read(afterRevision);
    if (result.reset || result.revision !== afterRevision || !waitMs) return result;
    await new Promise(resolve => {
      const wake = () => { clearTimeout(timer); waiters.delete(wake); resolve(); };
      const timer = setTimeout(wake, waitMs);
      waiters.add(wake);
    });
    return read(afterRevision);
  }
  async function execute(input) {
    const fingerprint = JSON.stringify(input), existing = receipts.get(input.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw agentError('request_conflict', '请求编号已用于另一条页面命令');
      return { ...await existing.result, replayed: true };
    }
    if (busy) throw agentError('workspace_busy', '另一条页面命令正在执行，请读取实际结果后继续');
    if (observe('snapshot').controlRevision !== input.expectedRevision) throw agentError('workspace_changed', '人工操作或页面状态已变化，请重读现场后再操作');
    busy = true;
    let resolve, reject;
    const result = new Promise((ok, no) => { resolve = ok; reject = no; });
    // Keep both successful and failed commands: a timeout/retry must not repeat
    // partially executed UI operations. Rejections are observed here too.
    result.catch(() => {});
    const record = { fingerprint, result, size: bytes(input), finished: false };
    receipts.set(input.requestId, record); commandBytes += record.size;
    try {
      const outcome = await perform(input);
      // Consume a revision even for no-op commands, so an expired receipt can
      // never cause an old command to run again on an unchanged page.
      const value = { state: 'executed', requestId: input.requestId, ...outcome, ...observe('agent', true) };
      const size = bytes(value); record.size += size; commandBytes += size; resolve(value);
    } catch (error) { observe('agent', true); reject(error); }
    finally {
      record.finished = true; busy = false;
      while (receipts.size > budget.maxAutomaticHistoryItems || commandBytes > budget.maxAutomaticHistoryBytes) {
        const oldest = [...receipts].find(([, item]) => item.finished);
        if (!oldest) break;
        receipts.delete(oldest[0]); commandBytes -= oldest[1].size;
      }
    }
    return result;
  }
  return { observe, read, wait, execute, hasReceipt: id => receipts.has(id) };
}
