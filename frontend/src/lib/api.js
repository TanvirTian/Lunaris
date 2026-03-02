/**
 * Lunaris API Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Abstracts the two-phase scan flow:
 *
 *   Cache HIT  (fast path):
 *     POST /analyze → { cached: true, result: { ...data } }
 *     Backend applies 300–600ms UX delay before responding.
 *     No polling needed — result is inline in the response.
 *
 *   Cache MISS (slow path):
 *     POST /analyze → { jobId }
 *     → poll GET /scan/:jobId until SUCCESS or FAILED
 *     → return normalized job object
 *
 * Both paths return the same shape so App.jsx needs zero branching.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const API_BASE        = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const POLL_INTERVAL_MS = 2_500;
const MAX_POLL_ATTEMPTS = 60; // 60 × 2.5s = 2.5 minutes max

/**
 * Start a privacy scan for a URL.
 *
 * @param {string} url - Raw URL entered by the user
 * @param {{ onProgress?: Function }} options
 *
 * onProgress is called with:
 *   { status, cached, cachedAt, cacheExpiresAt, domain, jobId, attempt }
 *
 * Returns a normalized scan result object:
 *   {
 *     jobId:          string | null
 *     status:         'SUCCESS'
 *     cached:         boolean
 *     cachedAt:       string | null   (ISO date)
 *     cacheExpiresAt: string | null   (ISO date)
 *     domain:         string | null
 *     result: {
 *       score, riskLevel, summary, trackerCount, cookieCount,
 *       externalDomains, isHttps, pagesCrawled, hasCsp,
 *       fingerprinting: { canvas, webgl, font, keylogger },
 *       data: { ...full rawData analysis blob }
 *     }
 *   }
 */
export async function startScan(url, { onProgress } = {}) {

  // ── Step 1: POST /analyze ────────────────────────────────────────────────
  // For cache hits: backend waits 300–600ms (UX delay) before responding.
  // For cache misses: returns immediately with { jobId } to poll against.
  const initRes = await fetch(`${API_BASE}/analyze`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url }),
  });

  const initData = await initRes.json();

  if (!initRes.ok) {
    throw new Error(initData.error || 'Failed to start scan');
  }

  // ── Cache HIT — result is already here, no polling needed ───────────────
  //
  // v1 bug: this branch called fetch(`/scan/${initData.jobId}`) which was:
  //   a) An unnecessary round-trip — the full result is already in initData
  //   b) Broken if lastJobId is null (new DomainScan rows with no job history)
  //   c) Returning the ScanJob shape instead of the DomainScan shape
  //
  // Fix: use initData.result directly. It already contains the full data blob.
  if (initData.cached && initData.status === 'SUCCESS') {
    onProgress?.({
      status:         'SUCCESS',
      cached:         true,
      cachedAt:       initData.cachedAt,
      cacheExpiresAt: initData.cacheExpiresAt,
      domain:         initData.domain,
    });

    // Return normalized shape — identical structure to the polled path below
    // so App.jsx can do `job.result?.data ?? job.result` without branching.
    return {
      jobId:          initData.jobId   ?? null,
      status:         'SUCCESS',
      cached:         true,
      cachedAt:       initData.cachedAt        ?? null,
      cacheExpiresAt: initData.cacheExpiresAt  ?? null,
      domain:         initData.domain          ?? null,
      result:         initData.result,
    };
  }

  // ── Cache MISS — poll until terminal state ───────────────────────────────
  const { jobId, domain } = initData;
  onProgress?.({ status: 'PENDING', jobId, cached: false });

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${API_BASE}/scan/${jobId}`);
    const job     = await pollRes.json();

    if (!pollRes.ok) throw new Error(job.error || 'Poll failed');

    onProgress?.({ status: job.status, jobId, attempt, cached: false });

    if (job.status === 'SUCCESS') {
      return {
        ...job,
        cached:         false,
        cachedAt:       null,
        cacheExpiresAt: null,
        domain:         domain ?? null,
      };
    }

    if (job.status === 'FAILED') {
      throw new Error(job.errorMessage || 'Scan failed');
    }

    // PENDING or RUNNING — keep polling
  }

  throw new Error('Scan timed out after 2.5 minutes. Please try again.');
}
