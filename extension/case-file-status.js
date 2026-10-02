export function caseFilesUnavailable(entry) {
  return Boolean(entry?.vaultReadStatus?.readOnly || entry?.memberEntries?.some(member => member.vaultReadStatus?.readOnly));
}

export function assertCaseFilesReadable(entry) {
  if (caseFilesUnavailable(entry)) throw Object.assign(new Error('案例文件尚未完整读取；当前恢复记录仅供核对，请修复文件后重读。'), { code: 'case_files_unavailable' });
}
