import { markSyncMetaDirty } from './sync-model.js';

// Continuations belong to user work. Keeping them in the canonical session
// makes backup/sync retain the same identity; gallery reads exclude sessions.
export function createComposerToolProgress({ storage, sessionId, userMessageId }) {
  if (!sessionId || !userMessageId) throw new Error('未完成工具任务缺少对话或用户要求编号');
  const update = (transform, versionIds = []) => storage.update(['composerSessions', 'syncMeta'], stored => {
    const sessions = Array.isArray(stored.composerSessions) ? stored.composerSessions : [];
    if (!sessions.some(session => session.id === sessionId)) throw new Error('工作对话尚未持久保存，不能保存工具续接进度');
    return {
      composerSessions: sessions.map(session => session.id === sessionId
        ? { ...session, toolContinuations: transform({ ...(session.toolContinuations || {}) }),
          toolSkillVersionIds: [...new Set([...(session.toolSkillVersionIds || []), ...versionIds])] } : session),
      syncMeta: markSyncMetaDirty(stored.syncMeta)
    };
  });
  return {
    async loadContinuation({ model, protocol }) {
      const stored = await storage.get('composerSessions');
      const value = stored.composerSessions?.find(session => session.id === sessionId)?.toolContinuations?.[userMessageId];
      if (!value) return null;
      if (value.needsTargetReview) throw new Error('导入的工作进度需要重新核对目标案例，未重放旧工具动作');
      if (value.protocol !== protocol || value.body?.model !== model) throw new Error('本轮模型或协议已变化，请先核对未完成任务');
      return value;
    },
    saveContinuation: checkpoint => update(values => ({ ...values, [userMessageId]: checkpoint })),
    retainSkillVersions: versionIds => versionIds.length ? update(values => values, versionIds) : undefined,
    clearContinuation: () => update(values => { delete values[userMessageId]; return values; })
  };
}

export async function discardComposerToolProgress(storage, sessionId) {
  await storage.update('composerSessions', stored => ({
    composerSessions: (stored.composerSessions || []).map(session => session.id === sessionId ? { ...session, toolContinuations: {} } : session)
  }));
}
