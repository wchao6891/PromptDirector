export const WORKSPACE_SCREENSHOT_SPEC = {
  name: 'capture_workspace',
  description: '读取本插件案例库、创作台或采集页面当前可见区域的真实截图，不切换标签或抢焦点。可指定tabId/surface；省略时只选唯一活跃插件页面，多个候选返回列表。截图只证明capturedAt时刻的可见画面，不代表隐藏区、完整原件或保存成功。浏览器权限不足返回permission_required，不能用业务状态假冒截图。',
  parameters: { type: 'object', properties: {
    tabId: { type: 'integer', minimum: 0 }, surface: { enum: ['library', 'composer', 'collector'] }
  }, additionalProperties: false }
};
