import { AGENT_CASE_ACTION_SPECS } from './agent-case-action-specs.js';
import { validate } from './case-operation-specs.js';
import { operationCase, caseOperationFingerprint } from './case-operations.js';
import { moveEntriesToTrash, normalizeTrashState } from './trash.js';
import { agentError } from './agent-protocol.js';

// Uses the same recoverable snapshots as the gallery. The receipt belongs to the deletion
// commit, so replaying a lost reply cannot remove a case the user has since restored.
export function createCaseTrashOperations({ loadState, storage, commit, enqueue }) {
  return { execute: input => enqueue(async () => {
    validate(AGENT_CASE_ACTION_SPECS.find(spec => spec.name === 'trash_case').parameters, input, 'trash_case');
    const operation = 'trash_case', key = `caseOperation:${input.requestId}`;
    const fingerprint = await caseOperationFingerprint({ operation, input });
    const receipt = (await storage.get(key))[key];
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw agentError('request_conflict', '此请求编号已用于其他操作');
      return { ...receipt.result, replayed: true };
    }
    const state = await loadState();
    const current = await operationCase(state, input.caseId);
    if (current.revision !== input.expectedRevision) throw agentError('case_conflict', '案例或项目关系已变化，请重新读取后操作');
    const compound = state.compoundCases?.find(item => item.id === input.caseId);
    const movedEntryIds = compound ? [...compound.memberEntryIds] : [input.caseId];
    const selected = new Set(movedEntryIds);
    if (normalizeTrashState(state.trashState).items.some(item => item.kind === 'entry' && selected.has(item.targetId))) {
      throw agentError('trash_conflict', '回收站已有同编号资料，未覆盖旧快照，请先核对');
    }
    const moved = moveEntriesToTrash({ entries: state.entries, organizerState: state.organizerState,
      compoundCases: state.compoundCases, trashState: state.trashState }, movedEntryIds);
    const visionAnalysisUndo = { ...(await storage.get('visionAnalysisUndo')).visionAnalysisUndo };
    for (const id of movedEntryIds) delete visionAnalysisUndo[id];
    const result = { ok: true, operation, requestId: input.requestId, caseId: input.caseId,
      movedEntryIds, movedItemIds: moved.movedItemIds, restorable: true };
    await commit({ entries: moved.entries, organizerState: moved.organizerState, compoundCases: moved.compoundCases,
      trashState: moved.trashState, visionAnalysisUndo, [key]: { fingerprint, result } });
    return result;
  }) };
}
