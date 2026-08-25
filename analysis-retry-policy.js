const SERVICE_RETRIES = 2;

export const ANALYSIS_RETRY_POLICY = Object.freeze({
  serviceRetries: SERVICE_RETRIES,
  outputCorrectionRequests: 1,
  maxProviderCallsPerItem: SERVICE_RETRIES + 1,
  backoffMs: Object.freeze([1000, 3000]),
  obeyRetryAfter: true
});
