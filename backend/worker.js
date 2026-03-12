import { Worker } from 'bullmq';
import { redis } from './lib/redis.js';
import { db, disconnectDb } from './lib/db.js';
import { dlq, QUEUE_NAME } from './lib/queue.js';
import { logger } from './lib/logger.js';
import { metrics, activeScansGauge, scanDurationSeconds } from './lib/metrics.js';
import { createServer } from 'http';
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
  lockDuration:    150_000, // 2.5 minutes — max expected crawl time
  // worst case: 4 pages × 25s nav + analysis overhead
  // 120s was tight; 150s gives a safe margin
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

// ── Metrics HTTP server ───────────────────────────────────────────────────────
//
// The worker is a separate process from the backend — it has its own in-memory
// copy of lib/metrics.js. Backend's /metrics only sees backend counters.
// Worker counters (scans_succeeded, scans_failed, active_jobs, durations) are
// invisible to Prometheus unless the worker exposes its own /metrics endpoint.
//
// Runs on METRICS_PORT (default 9091). Prometheus scrapes it via the
// lunaris_worker job in prometheus.yml: targets: ['worker:9091']
// Grafana: filter worker metrics with {service="lunaris-worker"}
//          filter backend metrics with {service="lunaris-backend"}

const METRICS_PORT = parseInt(process.env.METRICS_PORT || '9091', 10);

const metricsServer = createServer(async (req, res) => {
  if (req.url === '/metrics') {
    try {
      const metricsText = await metrics.getMetrics();
      res.writeHead(200, { 'Content-Type': metrics.contentType() });
      res.end(metricsText);
    } catch (err) {
      logger.error({ error: err.message }, 'failed to collect worker metrics');
      res.writeHead(500);
      res.end('metrics collection failed');
    }
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ── Standalone process entry point ───────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
  logger.info({ concurrency: WORKER_CONCURRENCY }, 'worker process started');

  metricsServer.listen(METRICS_PORT, '0.0.0.0', () => {
    logger.info({ port: METRICS_PORT }, 'worker metrics server listening');
  });

  const signals = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.once(sig, async () => {
      logger.info(`received ${sig}`);
      metricsServer.close();
      await shutdownWorker();
      await disconnectDb();
      process.exit(0);
    });
  }
}
