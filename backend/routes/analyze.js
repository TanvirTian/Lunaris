/**
 * POST /analyze
 * -----------------------------------------------------------------------------
 * Validates URL → deduplicates → creates ScanJob → enqueues to BullMQ.
 * Returns HTTP 202 with jobId immediately (non-blocking).
 * -----------------------------------------------------------------------------
 */

import { db } from '../lib/db.js';
import { scanQueue } from '../lib/queue.js';
import { logger } from '../lib/logger.js';
import { metrics } from '../lib/metrics.js';
import { normalizeUrl } from '../services/crawler.js';

// Dedup window: if same URL scanned successfully within this period, return cached
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Redis key prefix for dedup locks (prevents race condition on simultaneous requests)
const DEDUP_KEY = (url) => `dedup:${url}`;
const DEDUP_TTL_S = 60 * 10; // 10 minutes in seconds

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
  }, async (request, reply) => {
    const requestId = request.id; // Fastify auto-generates per-request IDs
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

    log.info({ url: cleanUrl }, 'analyze request received');

    // ── 2. DB-level deduplication ─────────────────────────────────────────────
    // Check if a successful scan exists within the dedup window.
    // This is the primary dedup check — authoritative because it's in PostgreSQL.
    const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
    const recentJob = await db.scanJob.findFirst({
      where: {
        targetUrl:   cleanUrl,
        status:      'SUCCESS',
        completedAt: { gte: dedupCutoff },
      },
      orderBy: { completedAt: 'desc' },
      select:  { id: true, completedAt: true },
    });

    if (recentJob) {
      metrics.increment('scans_cached');
      log.info({ jobId: recentJob.id }, 'returning cached scan result');
      return reply.status(200).send({
        jobId:    recentJob.id,
        status:   'SUCCESS',
        cached:   true,
        cachedAt: recentJob.completedAt,
        pollUrl:  `/scan/${recentJob.id}`,
      });
    }

    // ── 3. Redis dedup lock ───────────────────────────────────────────────────
    // Secondary dedup: prevents two simultaneous requests for the same URL
    // from both passing the DB check (race condition) and spawning two crawls.
    // SET NX = "set if not exists" — atomic Redis operation.
    const { redis } = await import('../lib/redis.js');
    const dedupKey = DEDUP_KEY(cleanUrl);
    const lockAcquired = await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_S, 'NX');

    if (!lockAcquired) {
      // Another request is already processing this URL — find that pending job
      const pendingJob = await db.scanJob.findFirst({
        where:   { targetUrl: cleanUrl, status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, status: true },
      });

      if (pendingJob) {
        log.info({ jobId: pendingJob.id }, 'returning in-progress job');
        return reply.status(202).send({
          jobId:   pendingJob.id,
          status:  pendingJob.status,
          cached:  false,
          pollUrl: `/scan/${pendingJob.id}`,
          message: 'Scan already in progress for this URL.',
        });
      }
    }

    // ── 4. Create ScanJob in DB (PENDING) ─────────────────────────────────────
    let job;
    try {
      job = await db.scanJob.create({
        data: {
          targetUrl: cleanUrl,
          status:    'PENDING',
          // userId: request.user?.id  ← wire in when auth is added
        },
        select: { id: true },
      });
    } catch (err) {
      // Clean up Redis lock if DB write failed
      await redis.del(dedupKey).catch(() => {});
      log.error({ error: err.message }, 'failed to create ScanJob');
      return reply.status(500).send({ error: 'Failed to create scan job. Please try again.' });
    }

    // ── 5. Enqueue to BullMQ ──────────────────────────────────────────────────
    try {
      await scanQueue.add('scan', {
        jobId: job.id,
        url:   cleanUrl,
      }, {
        jobId: job.id, // use DB UUID as BullMQ job ID for traceability
      });
    } catch (err) {
      // Queue add failed — mark job FAILED immediately so it's not orphaned
      await db.scanJob.update({
        where: { id: job.id },
        data:  { status: 'FAILED', errorMessage: 'Failed to enqueue scan job', completedAt: new Date() },
      }).catch(() => {});
      await redis.del(dedupKey).catch(() => {});
      log.error({ jobId: job.id, error: err.message }, 'failed to enqueue job');
      return reply.status(500).send({ error: 'Failed to queue scan. Please try again.' });
    }

    log.info({ jobId: job.id }, 'scan job enqueued');

    return reply.status(202).send({
      jobId:   job.id,
      status:  'PENDING',
      cached:  false,
      pollUrl: `/scan/${job.id}`,
      message: 'Scan queued. Poll pollUrl for status and results.',
    });
  });
}

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
