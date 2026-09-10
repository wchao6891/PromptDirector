const SERVICE_RETRIES = 2;

export const ANALYSIS_RETRY_POLICY = Object.freeze({
  serviceRetries: SERVICE_RETRIES,
  outputCorrectionRequests: 1,
  maxProviderCallsPerItem: SERVICE_RETRIES + 1,
  backoffMs: Object.freeze([1000, 3000]),
  obeyRetryAfter: true
});

export function createAnalysisRequestBudget() {
  return { maxProviderCalls: ANALYSIS_RETRY_POLICY.maxProviderCallsPerItem, providerCalls: 0, outputCorrectionRequests: 0 };
}

export function consumeAnalysisRequest(budget, kind = "primary") {
  budget.maxProviderCalls = Math.min(ANALYSIS_RETRY_POLICY.maxProviderCallsPerItem, Math.max(1, Number(budget.maxProviderCalls) || ANALYSIS_RETRY_POLICY.maxProviderCallsPerItem));
  if (budget.providerCalls >= budget.maxProviderCalls || (kind === "correction" && budget.outputCorrectionRequests >= ANALYSIS_RETRY_POLICY.outputCorrectionRequests)) {
    const error = new Error(`本轮已达到自动补救上限（最多 ${budget.maxProviderCalls} 次请求），本次结果未保存`);
    error.code = "analysis_request_budget_exhausted";
    error.recovery = "none";
    throw error;
  }
  budget.providerCalls++;
  if (kind === "correction") budget.outputCorrectionRequests++;
}

export function analysisRequestCounts(budget = {}) {
  return {
    serviceRequests: Math.max(0, (Number(budget.providerCalls) || 0) - (Number(budget.outputCorrectionRequests) || 0)),
    outputCorrectionRequests: Math.max(0, Number(budget.outputCorrectionRequests) || 0)
  };
}
