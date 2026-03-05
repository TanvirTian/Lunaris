import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

// Use a dedicated registry so we don't pollute the global default.
// This is important if you ever run tests — each test can get a clean registry.
export const registry = new Registry();

// ── Default Node.js metrics ───────────────────────────────────────────────────
// Collects: process CPU/memory, event loop lag, GC stats, active handles, etc.
// These are invaluable for spotting memory leaks in long-running crawl workers.
collectDefaultMetrics({
  register: registry,
  prefix: 'lunaris_nodejs_',  // namespace prefix to avoid collisions
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});

// ── HTTP Request Counter ──────────────────────────────────────────────────────
export const httpRequestsTotal = new Counter({
  name: 'lunaris_http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

// ── HTTP Request Duration ─────────────────────────────────────────────────────
// Buckets tuned for a web crawl API:
//   - Most health/cache responses: < 100ms
//   - DB reads: < 500ms
//   - Fresh crawls: 5–60 seconds
export const httpRequestDurationSeconds = new Histogram({
  name: 'lunaris_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

// ── Scan Outcome Counter ──────────────────────────────────────────────────────
export const scansTotal = new Counter({
  name: 'lunaris_scans_total',
  help: 'Total scan jobs by outcome',
  labelNames: ['status'], // started | succeeded | failed | cached
  registers: [registry],
});

// ── Cache Performance Counters ────────────────────────────────────────────────
// Separate counters (not a single counter with hit/miss label) to make
// Prometheus rate queries simpler:
//   cache_hit_ratio = rate(cache_hits[5m]) / (rate(cache_hits[5m]) + rate(cache_misses[5m]))
export const cacheHitsTotal = new Counter({
  name: 'lunaris_cache_hits_total',
  help: 'Number of analyze requests served from the 24-hour domain cache',
  registers: [registry],
});

export const cacheMissesTotal = new Counter({
  name: 'lunaris_cache_misses_total',
  help: 'Number of analyze requests that triggered a fresh crawl (cache miss)',
  registers: [registry],
});

// ── External API Call Counter ─────────────────────────────────────────────────
// Tracks outbound fetch() calls made during script intelligence analysis.
// Useful for cost tracking and detecting runaway external requests.
export const externalApiCallsTotal = new Counter({
  name: 'lunaris_external_api_calls_total',
  help: 'Outbound HTTP requests made to third-party script URLs during analysis',
  labelNames: ['result'], // success | error | timeout
  registers: [registry],
});

// ── Validation / Security Counters ───────────────────────────────────────────
export const validationErrorsTotal = new Counter({
  name: 'lunaris_validation_errors_total',
  help: 'Number of URL validation failures (malformed, no TLD, etc.)',
  registers: [registry],
});

export const ssrfBlockedTotal = new Counter({
  name: 'lunaris_ssrf_blocked_total',
  help: 'Number of requests blocked by SSRF protection',
  registers: [registry],
});

// ── Active Scans Gauge ────────────────────────────────────────────────────────
// Gauge (not counter) because it goes up AND down.
// Useful alert: if activeScans stays high for >5min, workers may be stuck.
export const activeScansGauge = new Gauge({
  name: 'lunaris_active_scans',
  help: 'Number of scan jobs currently being processed by workers',
  registers: [registry],
});

// ── Scan Duration Histogram ───────────────────────────────────────────────────
// Separate from HTTP duration because crawls run async in worker processes.
// Buckets aligned with TIMEOUTS constants in crawler.js:
//   navigation: 25s, pageSettle: 6s, jsSettle: 2s, up to MAX_PAGES=4
export const scanDurationSeconds = new Histogram({
  name: 'lunaris_scan_duration_seconds',
  help: 'Time taken to complete a full crawl + analysis pipeline',
  labelNames: ['risk_level'],
  buckets: [5, 10, 20, 30, 45, 60, 90, 120],
  registers: [registry],
});

// ── Backwards-compatible in-memory metrics object ─────────────────────────────
// This wraps the prom-client metrics in the same interface as the old metrics.js
// so existing callers (worker.js, routes) need zero changes.
const activeJobTimers = new Map(); // jobId → { startMs, url }

export const metrics = {
  // ── Counters ──────────────────────────────────────────────────────────────

  increment(key) {
    switch (key) {
      case 'scans_started':      scansTotal.inc({ status: 'started' });      activeScansGauge.inc(); break;
      case 'scans_succeeded':    scansTotal.inc({ status: 'succeeded' });     activeScansGauge.dec(); break;
      case 'scans_failed':       scansTotal.inc({ status: 'failed' });        activeScansGauge.dec(); break;
      case 'scans_cached':       scansTotal.inc({ status: 'cached' });        cacheHitsTotal.inc();   break;
      case 'cache_miss':         cacheMissesTotal.inc();  break;
      case 'validation_errors':  validationErrorsTotal.inc(); break;
      case 'ssrf_blocked':       ssrfBlockedTotal.inc();  break;
    }
  },

  // ── Job timers ────────────────────────────────────────────────────────────

  startJobTimer(jobId) {
    activeJobTimers.set(jobId, { startMs: Date.now() });
  },

  endJobTimer(jobId, riskLevel = 'unknown') {
    const entry = activeJobTimers.get(jobId);
    if (!entry) return null;
    activeJobTimers.delete(jobId);
    const durationMs = Date.now() - entry.startMs;
    scanDurationSeconds.observe({ risk_level: riskLevel }, durationMs / 1000);
    return durationMs;
  },

  // ── Prometheus metrics endpoint helper ───────────────────────────────────
  // Returns the full metrics text in Prometheus exposition format.
  async getMetrics() {
    return registry.metrics();
  },

  contentType() {
    return registry.contentType;
  },

  // ── Snapshot (kept for backwards compat / health endpoint) ───────────────
  snapshot() {
    return {
      active_jobs: activeJobTimers.size,
      note: 'Full metrics available at GET /metrics (Prometheus format)',
    };
  },
};
