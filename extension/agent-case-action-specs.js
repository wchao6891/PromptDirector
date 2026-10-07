// Shared contract for recoverable case removal.
const id = { type: 'string', minLength: 1 };
const requestId = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' };
const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const identity = { caseId: id, expectedRevision: id };
export const AGENT_CASE_ACTION_SPECS = [
  { name: 'trash_case', description: '按用户明确指定的范围将案例移入插件回收站，保留原件、完整资料和恢复关系，不永久删除。先read_case_details取得expectedRevision；组合编号移入全部成员，成员编号只移入该成员。成功返回movedItemIds，可在插件回收站恢复。相同requestId与参数重试返回原回执，不会重复删除后来恢复的案例；版本冲突须重读。',
    parameters: object({ requestId, ...identity }, ['requestId', 'caseId', 'expectedRevision']) }
];
