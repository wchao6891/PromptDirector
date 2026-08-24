export const ANALYSIS_RETRY_POLICY = Object.freeze({
  serviceRetries: 2,
  outputCorrectionRequests: 1,
  backoffMs: Object.freeze([1000, 3000]),
  obeyRetryAfter: true
});
