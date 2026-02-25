const counters = {
  scans_started:   0,
  scans_succeeded: 0,
  scans_failed:    0,
  scans_cached:    0,
  ssrf_blocked:    0,
  validation_errors: 0,
};

// Simple histogram — tracks how many scans fell into each duration bucket
const durationBuckets = {
  under_10s:  0,  // fast sites
  under_30s:  0,  // normal sites
  under_60s:  0,  // slow sites
  under_90s:  0,  // very slow
  over_90s:   0,  // timeout risk
};

// Track per-worker start times for processing duration
const activeJobTimers = new Map(); // jobId → startTime (ms)

export const metrics = {
  increment(key) {
    if (key in counters) counters[key]++;
  },

  startJobTimer(jobId) {
    activeJobTimers.set(jobId, Date.now());
  },

  endJobTimer(jobId) {
    const start = activeJobTimers.get(jobId);
    if (!start) return null;
    activeJobTimers.delete(jobId);
    const durationMs = Date.now() - start;

    // Bucket the duration
    if      (durationMs < 10_000) durationBuckets.under_10s++;
    else if (durationMs < 30_000) durationBuckets.under_30s++;
    else if (durationMs < 60_000) durationBuckets.under_60s++;
    else if (durationMs < 90_000) durationBuckets.under_90s++;
    else                          durationBuckets.over_90s++;

    return durationMs;
  },

  snapshot() {
    return {
      counters: { ...counters },
      duration_buckets: { ...durationBuckets },
      active_jobs: activeJobTimers.size,
    };
  },
};
