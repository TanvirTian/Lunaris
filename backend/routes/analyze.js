import { db } from '../lib/db.js';
import { scanQueue } from '../lib/queue.js';
import { logger } from '../lib/logger.js';
import { metrics, cacheHitsTotal, cacheMissesTotal } from '../lib/metrics.js';
import { normalizeUrl } from '../services/crawler.js';

// ── Cache configuration ───────────────────────────────────────────────────────

// 24-hour cache window: if a domain was successfully scanned within this
// period, return the cached DomainScan row instead of triggering a new crawl.
const CACHE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// UX delay range for cache hits (milliseconds).
// Randomized within this window so it doesn't feel mechanical.
// 300ms is fast enough to feel snappy; 600ms is slow enough to signal "work done".
const CACHE_DELAY_MIN_MS = 300;
const CACHE_DELAY_MAX_MS = 600;

// Redis dedup lock: prevents two simultaneous requests for the same domain
// from both passing the DB cache check and spawning two crawls.
// Key is domain-based (not full URL) so example.com and www.example.com share a lock.
const DEDUP_LOCK_KEY = (domain) => `dedup:domain:${domain}`;
const DEDUP_TTL_S    = 60 * 15; // 15 minutes — covers max crawl duration

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Non-blocking sleep. Used for the UX delay on cache hits.
 * Lives here (not the frontend) so ALL clients get consistent behavior.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Random integer in [min, max] inclusive.
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Extract the canonical domain from a normalized URL for cache lookups.
 * Strips www. prefix so "www.example.com" and "example.com" share one cache row.
 *
 * Example:
 *   "https://www.example.com/path?q=1" → "example.com"
 *   "https://sub.example.co.uk"         → "sub.example.co.uk"  (sub-domains preserved)
 */
function extractDomain(normalizedUrl) {
  const hostname = new URL(normalizedUrl).hostname;
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function analyzeRoute(fastify) {
  fastify.post('/analyze', {
    schema: {
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', minLength: 1, maxLength: 2048 },
        },
      },
    },
    // Exclude this specific route from global rate limiting if you want
    // cache-hit requests (which are cheap) to not count against the limit.
    // Remove this config block to apply the global 10/min limit uniformly.
    // config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const requestId = request.id;
    const log = logger.child({ requestId });

    // ── 1. URL normalization + validation ─────────────────────────────────────
    let cleanUrl;
    try {
      cleanUrl = normalizeUrl(request.body.url);
    } catch (err) {
      metrics.increment('validation_errors');
      if (err.message.includes('SSRF_')) metrics.increment('ssrf_blocked');
      log.warn({ raw: request.body.url, error: err.message }, 'URL validation failed');
      return reply.status(400).send({ error: friendlyError(err.message) });
    }

    const domain = extractDomain(cleanUrl);
    log.info({ url: cleanUrl, domain }, 'analyze request received');

    // ── 2. Domain cache check (24h window) ────────────────────────────────────
    //
    // Atomic single-row lookup on domain_scans.domain (unique index).
    // No JOIN, no ordering — O(1) regardless of total scan volume.
    //
    // Race condition safety:
    //   DomainScan uses upsert semantics in the worker, so by the time we
    //   read it here, it's always the latest complete result for this domain.
    //   The Redis lock below handles the in-flight case.
    const cacheCutoff = new Date(Date.now() - CACHE_WINDOW_MS);

    const domainScan = await db.domainScan.findUnique({
      where: { domain },
    });

    if (domainScan && domainScan.lastScannedAt > cacheCutoff) {
      // ── Cache HIT ─────────────────────────────────────────────────────────
      cacheHitsTotal.inc();
      metrics.increment('scans_cached');

      log.info({
        domain,
        lastScannedAt: domainScan.lastScannedAt,
        cacheAgeMs: Date.now() - domainScan.lastScannedAt.getTime(),
      }, 'cache hit — returning DomainScan result');

      // UX delay: makes the response feel like real work was done.
      // 300–600ms random window prevents a mechanical "ping-pong" feel.
      // This intentionally runs BEFORE sending the response so the client
      // experiences the delay as response latency, not a client-side pause.
      const delayMs = randomBetween(CACHE_DELAY_MIN_MS, CACHE_DELAY_MAX_MS);
      await sleep(delayMs);

      return reply.status(200).send({
        jobId:         domainScan.lastJobId,
        status:        'SUCCESS',
        cached:        true,
        cachedAt:      domainScan.lastScannedAt,
        cacheExpiresAt: new Date(domainScan.lastScannedAt.getTime() + CACHE_WINDOW_MS),
        domain,
        result: {
          score:            domainScan.score,
          riskLevel:        domainScan.riskLevel,
          summary:          domainScan.summary,
          trackerCount:     domainScan.trackerCount,
          cookieCount:      domainScan.cookieCount,
          externalDomains:  domainScan.externalDomains,
          isHttps:          domainScan.isHttps,
          pagesCrawled:     domainScan.pagesCrawled,
          hasCsp:           domainScan.hasCsp,
          fingerprinting: {
            canvas:   domainScan.canvasFingerprint,
            webgl:    domainScan.webglFingerprint,
            font:     domainScan.fontFingerprint,
            keylogger: domainScan.keylogger,
          },
          data: domainScan.rawData,
        },
        // Expose pollUrl for clients that want to fetch the full job record
        pollUrl: domainScan.lastJobId ? `/scan/${domainScan.lastJobId}` : null,
      });
    }

    // ── Cache MISS ────────────────────────────────────────────────────────────
    cacheMissesTotal.inc();
    metrics.increment('cache_miss');

    // ── 3. Redis dedup lock ───────────────────────────────────────────────────
    // Prevents two simultaneous cache-miss requests for the same domain from
    // both spawning a crawl. SET NX = atomic "set if not exists".
    const { redis } = await import('../lib/redis.js');
    const lockKey     = DEDUP_LOCK_KEY(domain);
    const lockAcquired = await redis.set(lockKey, '1', 'EX', DEDUP_TTL_S, 'NX');

    if (!lockAcquired) {
      // Another request is already crawling this domain — find that pending job
      const pendingJob = await db.scanJob.findFirst({
        where:   { targetUrl: cleanUrl, status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, status: true },
      });

      if (pendingJob) {
        log.info({ jobId: pendingJob.id }, 'domain crawl already in-flight — returning pending job');
        return reply.status(202).send({
          jobId:   pendingJob.id,
          status:  pendingJob.status,
          cached:  false,
          domain,
          pollUrl: `/scan/${pendingJob.id}`,
          message: 'A scan for this domain is already in progress.',
        });
      }
      // Lock exists but no pending job found — stale lock from a crashed worker.
      // Fall through and create a new job.
    }

    // ── 4. Create ScanJob (PENDING) ───────────────────────────────────────────
    let job;
    try {
      job = await db.scanJob.create({
        data: {
          targetUrl: cleanUrl,
          status:    'PENDING',
        },
        select: { id: true },
      });
    } catch (err) {
      await redis.del(lockKey).catch(() => {});
      log.error({ error: err.message }, 'failed to create ScanJob');
      return reply.status(500).send({ error: 'Failed to create scan job. Please try again.' });
    }

    // ── 5. Enqueue to BullMQ ──────────────────────────────────────────────────
    try {
      await scanQueue.add('scan', {
        jobId: job.id,
        url:   cleanUrl,
        domain,
      }, {
        jobId: job.id, // use DB UUID as BullMQ job ID for traceability
      });
    } catch (err) {
      await db.scanJob.update({
        where: { id: job.id },
        data:  {
          status:       'FAILED',
          errorMessage: 'Failed to enqueue scan job',
          completedAt:  new Date(),
        },
      }).catch(() => {});
      await redis.del(lockKey).catch(() => {});
      log.error({ jobId: job.id, error: err.message }, 'failed to enqueue job');
      return reply.status(500).send({ error: 'Failed to queue scan. Please try again.' });
    }

    metrics.increment('scans_started');
    log.info({ jobId: job.id, domain }, 'scan job enqueued');

    return reply.status(202).send({
      jobId:   job.id,
      status:  'PENDING',
      cached:  false,
      domain,
      pollUrl: `/scan/${job.id}`,
      message: 'Scan queued. Poll pollUrl for status and results.',
    });
  });
}

// ── Error message humanizer ───────────────────────────────────────────────────

function friendlyError(msg) {
  if (msg.includes('URL_NO_TLD'))
    return "That doesn't look like a real domain (e.g. example.com).";
  if (msg.includes('URL_MALFORMED') || msg.includes('URL_INVALID'))
    return 'That URL appears to be malformed. Please check and try again.';
  if (msg.includes('URL_RAW_IP'))
    return 'Direct IP addresses are not supported.';
  if (msg.includes('DNS_FAILED') || msg.includes('DNS_TIMEOUT'))
    return 'This domain does not exist or could not be resolved.';
  if (msg.includes('SSRF_'))
    return 'Scanning private or internal network addresses is not permitted.';
  if (msg.includes('UNREACHABLE'))
    return 'This website could not be reached. It may be down or blocking automated access.';
  return 'Invalid URL. Please check the address and try again.';
}
