/**
 * BullMQ Scan Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Processes scan jobs from the queue:
 *   1. Crawl the website (Playwright)
 *   2. Run privacy analysis
 *   3. Persist ScanResult (append-only history)
 *   4. Upsert DomainScan (single-row-per-domain state registry / cache)
 *   5. Update ScanJob status
 *
 * The DomainScan upsert (step 4) is the key change from v1:
 *   - On first scan for a domain: INSERT
 *   - On re-scan: UPDATE in place
 *   - @unique constraint on domain enforced at DB level
 *   - No duplicate rows, no race conditions, no application-level dedup needed
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Worker } from 'bullmq';
import { redis } from './lib/redis.js';
import { db, disconnectDb } from './lib/db.js';
import { dlq, QUEUE_NAME } from './lib/queue.js';
import { logger } from './lib/logger.js';
import { metrics, activeScansGauge, scanDurationSeconds } from './lib/metrics.js';
import { crawlWebsite } from './services/crawler.js';
import { analyzePrivacy } from './services/analyzer.js';

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreToRiskLevel(score) {
  if (score >= 80) return 'LOW';
  if (score >= 60) return 'MODERATE';
  if (score >= 40) return 'ELEVATED';
  return 'HIGH';
}

/**
 * Extract canonical domain from a URL for DomainScan keying.
 * Must match the same logic in routes/analyze.js to ensure cache consistency.
 */
function extractDomain(url) {
  const hostname = new URL(url).hostname;
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

// ── Job processor ─────────────────────────────────────────────────────────────

async function processScanJob(job) {
  const { jobId, url } = job.data;
  const log = logger.child({ jobId, bullJobId: job.id, url });

  log.info('scan job started');
  metrics.increment('scans_started');
  metrics.startJobTimer(jobId);

  // PENDING → RUNNING
  await db.scanJob.update({
    where: { id: jobId },
    data:  { status: 'RUNNING', startedAt: new Date() },
  });

  await job.updateProgress(10);

  // ── Crawl ─────────────────────────────────────────────────────────────────
  log.info('starting crawl');
  const crawlData = await crawlWebsite(url);
  await job.updateProgress(60);
  log.info({ pagesCrawled: crawlData.pagesCrawled?.length }, 'crawl complete');

  // ── Analyze ───────────────────────────────────────────────────────────────
  log.info('starting analysis');
  const analysis = await analyzePrivacy(crawlData);
  const riskLevel = scoreToRiskLevel(analysis.score);
  await job.updateProgress(90);

  // Shared typed fields extracted once for both ScanResult and DomainScan writes.
  // Keeping them in a single object avoids drift between the two records.
  const resultFields = {
    score:             analysis.score,
    riskLevel,
    summary:           analysis.summary,
    trackerCount:      analysis.trackers?.length          ?? 0,
    cookieCount:       analysis.meta?.cookieCount         ?? 0,
    externalDomains:   analysis.meta?.externalDomainCount ?? 0,
    isHttps:           analysis.meta?.isHttps             ?? false,
    pagesCrawled:      analysis.meta?.pagesCrawled?.length ?? 1,
    hasCsp:            analysis.meta?.csp?.present        ?? false,
    canvasFingerprint: analysis.fingerprinting?.canvasFingerprint ?? false,
    webglFingerprint:  analysis.fingerprinting?.webglFingerprint  ?? false,
    fontFingerprint:   analysis.fingerprinting?.fontFingerprint   ?? false,
    keylogger:         analysis.fingerprinting?.keylogger         ?? false,
    rawData:           analysis,
  };

  const domain = extractDomain(url);

  // ── Persist (transaction) ─────────────────────────────────────────────────
  //
  // Three operations in a single transaction:
  //   1. ScanResult.create  — append a historical record of this run
  //   2. DomainScan.upsert  — update the single-row domain cache
  //   3. ScanJob.update     — mark job SUCCESS
  //
  // Why transaction?
  //   If DomainScan.upsert succeeds but ScanJob.update fails, the next
  //   cache check would return data tied to a job that still shows RUNNING.
  //   The transaction ensures all three succeed or all three roll back.
  //
  // Why upsert for DomainScan?
  //   Prisma's upsert maps to PostgreSQL's INSERT ... ON CONFLICT DO UPDATE.
  //   It's atomic at the database level — no separate SELECT + conditional
  //   INSERT/UPDATE needed, no TOCTOU race condition possible.
  await db.$transaction([
    db.scanResult.create({
      data: {
        scanJobId: jobId,
        ...resultFields,
      },
    }),

    db.domainScan.upsert({
      where:  { domain },
      create: {
        domain,
        lastJobId:     jobId,
        lastScannedAt: new Date(),
        ...resultFields,
      },
      update: {
        lastJobId:     jobId,
        lastScannedAt: new Date(),
        // Update all result fields so the cache row always reflects
        // the most recent scan, not the first one ever seen.
        ...resultFields,
      },
    }),

    db.scanJob.update({
      where: { id: jobId },
      data:  { status: 'SUCCESS', completedAt: new Date() },
    }),
  ]);

  await job.updateProgress(100);

  const durationMs = metrics.endJobTimer(jobId, riskLevel.toLowerCase());
  metrics.increment('scans_succeeded');

  log.info({ durationMs, score: analysis.score, domain, riskLevel }, 'scan job completed');

  return { score: analysis.score, durationMs, domain };
}

// ── Worker instance ───────────────────────────────────────────────────────────

export const scanWorker = new Worker(QUEUE_NAME, processScanJob, {
  connection:      redis,
  concurrency:     WORKER_CONCURRENCY,
  lockDuration:    120_000, // 2 minutes — max expected crawl time
  lockRenewTime:   30_000,  // renew every 30s (must be < lockDuration / 2)
  stalledInterval: 30_000,
});

// ── Worker event handlers ─────────────────────────────────────────────────────

scanWorker.on('active', (job) => {
  logger.debug({ bullJobId: job.id, jobId: job.data.jobId }, 'worker picked up job');
  activeScansGauge.inc();
});

scanWorker.on('completed', (job, result) => {
  logger.info({ bullJobId: job.id, jobId: job.data.jobId, ...result }, 'worker completed job');
  activeScansGauge.dec();
});

scanWorker.on('failed', async (job, err) => {
  const jobId       = job?.data?.jobId;
  const isLastAttempt = job?.attemptsMade >= (job?.opts?.attempts ?? 3);

  logger.error(
    { bullJobId: job?.id, jobId, attempt: job?.attemptsMade, error: err.message },
    'worker job failed',
  );

  // End the timer so the gauge doesn't leak upward on failures
  metrics.endJobTimer(jobId);
  activeScansGauge.dec();

  if (isLastAttempt) {
    metrics.increment('scans_failed');
    logger.warn({ jobId }, 'all retries exhausted — moving to DLQ');

    await dlq.add('failed-scan', {
      originalJobId: job?.id,
      jobId,
      url:           job?.data?.url,
      error:         err.message,
      attempts:      job?.attemptsMade,
      failedAt:      new Date().toISOString(),
    }).catch((dlqErr) => logger.error({ error: dlqErr.message }, 'failed to add to DLQ'));

    if (jobId) {
      await db.scanJob.update({
        where: { id: jobId },
        data:  {
          status:       'FAILED',
          errorMessage: err.message?.slice(0, 1000) ?? 'Unknown error',
          completedAt:  new Date(),
        },
      }).catch((dbErr) => logger.error({ error: dbErr.message }, 'failed to update job status'));
    }
  }
});

scanWorker.on('error', (err) => {
  logger.error({ error: err.message }, 'worker error');
});

scanWorker.on('stalled', (jobId) => {
  logger.warn({ bullJobId: jobId }, 'job stalled — will be re-queued by BullMQ');
  // Gauge correction: stalled jobs didn't fire 'failed', so decrement manually
  activeScansGauge.dec();
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export async function shutdownWorker() {
  logger.info('shutting down worker...');
  await scanWorker.close(); // waits for active jobs to finish
  logger.info('worker stopped');
}

// ── Standalone process entry point ───────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
  logger.info({ concurrency: WORKER_CONCURRENCY }, 'worker process started');

  const signals = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.once(sig, async () => {
      logger.info(`received ${sig}`);
      await shutdownWorker();
      await disconnectDb();
      process.exit(0);
    });
  }
}
