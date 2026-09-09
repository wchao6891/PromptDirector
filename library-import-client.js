// Data and its completed receipt are one storage commit. Read that receipt locally
// when a worker reply is lost; never infer failure from a disconnected channel.
export async function applyLibraryImportWithReceipt(message, {
  send = request => chrome.runtime.sendMessage(request),
  readReceipts = () => chrome.storage.local.get("libraryImportTransactions")
} = {}) {
  const completedResult = async () => {
    const stored = await readReceipts();
    const receipt = stored?.libraryImportTransactions?.items?.find(item =>
      item.operationId === message.operationId && item.planToken === message.planToken && item.status === "completed"
    );
    return receipt?.result;
  };
  try {
    return await send(message);
  } catch {
    const completed = await completedResult().catch(() => undefined);
    if (completed) return completed;
  }
  try {
    return await send(message);
  } catch (cause) {
    const completed = await completedResult().catch(() => undefined);
    if (completed) return completed;
    throw Object.assign(new Error("恢复连接中断，暂时无法确认结果。已保留本次媒体，请重新打开资料库确认后再继续。", { cause }), {
      code: "IMPORT_OUTCOME_UNKNOWN"
    });
  }
}
