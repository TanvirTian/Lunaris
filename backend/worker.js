import { Worker } from 'bullmq';
import { redis } from './lib/redis.js';
import { db, disconnectDb } from './lib/db.js';
import { dlq, QUEUE_NAME } from './lib/queue.js';
import { logger } from './lib/logger.js';
import { metrics } from './lib/metrics.js';
import { crawlWebsite } from './services/crawler.js';
import { analyzePrivacy } from './services/analyzer.js';

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);


function scoreToRiskLevel(score) {
  if (score >= 80) return 'LOW';
  if (score >= 60) return 'MODERATE';
  if (score >= 40) return 'ELEVATED';
  return 'HIGH';
}


async function processScanJob(job) {
  const { jobId, url } = job.data;
  const log = logger.child({ jobId, bullJobId: job.id, url });

  log.info('scan job started');
  metrics.increment('scans_started');
  metrics.startJobTimer(jobId);

  // Update DB: PENDING → RUNNING
  await db.scanJob.update({
    where: { id: jobId },
    data:  { status: 'RUNNING', startedAt: new Date() },
  });

  // Update BullMQ job progress (visible in Bull Board UI)
  await job.updateProgress(10);

  //Crawl
  log.info('starting crawl');
  const crawlData = await crawlWebsite(url);
  await job.updateProgress(60);
  log.info({ pagesCrawled: crawlData.pagesCrawled?.length }, 'crawl complete');

  //Analyze
  log.info('starting analysis');
  const analysis = await analyzePrivacy(crawlData);
  await job.updateProgress(90);

  // Persist result (transaction) 
  await db.$transaction([
    db.scanResult.create({
      data: {
        scanJobId:         jobId,
        score:             analysis.score,
        riskLevel:         scoreToRiskLevel(analysis.score),
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
      },
    }),
    db.scanJob.update({
      where: { id: jobId },
      data:  { status: 'SUCCESS', completedAt: new Date() },
    }),
  ]);

  await job.updateProgress(100);

  const durationMs = metrics.endJobTimer(jobId);
  metrics.increment('scans_succeeded');
  log.info({ durationMs, score: analysis.score }, 'scan job completed');

  return { score: analysis.score, durationMs };
}

// Worker instance
export const scanWorker = new Worker(QUEUE_NAME, processScanJob, {
  connection: redis,
  concurrency: WORKER_CONCURRENCY,

  // How long a job can run before BullMQ considers it stalled (ms)
  // Set to slightly above your max expected crawl time
  // If a job runs longer than this, it gets re-queued automatically
  lockDuration: 120_000, // 2 minutes

  // How often the worker renews its lock on active jobs (ms)
  // Must be < lockDuration / 2
  lockRenewTime: 30_000, // renew every 30s

  // How often BullMQ checks for stalled jobs
  stalledInterval: 30_000,
});

// Worker event handlers 
scanWorker.on('active', (job) => {
  logger.debug({ bullJobId: job.id, jobId: job.data.jobId }, 'worker picked up job');
});

scanWorker.on('completed', (job, result) => {
  logger.info({ bullJobId: job.id, jobId: job.data.jobId, ...result }, 'worker completed job');
});

scanWorker.on('failed', async (job, err) => {
  const jobId = job?.data?.jobId;
  const isLastAttempt = job?.attemptsMade >= (job?.opts?.attempts ?? 3);

  logger.error(
    { bullJobId: job?.id, jobId, attempt: job?.attemptsMade, error: err.message },
    'worker job failed'
  );

  metrics.endJobTimer(jobId);

  if (isLastAttempt) {
    // All retries exhausted — move to DLQ and mark job FAILED in DB
    metrics.increment('scans_failed');
    logger.warn({ jobId }, 'all retries exhausted — moving to DLQ');

    // Add to DLQ for manual inspection
    await dlq.add('failed-scan', {
      originalJobId: job?.id,
      jobId,
      url: job?.data?.url,
      error: err.message,
      attempts: job?.attemptsMade,
      failedAt: new Date().toISOString(),
    }).catch((dlqErr) => logger.error({ error: dlqErr.message }, 'failed to add to DLQ'));

    // Mark FAILED in PostgreSQL
    if (jobId) {
      await db.scanJob.update({
        where: { id: jobId },
        data: {
          status:       'FAILED',
          errorMessage: err.message?.slice(0, 1000) ?? 'Unknown error',
          completedAt:  new Date(),
        },
      }).catch((dbErr) => logger.error({ error: dbErr.message }, 'failed to update job status'));
    }
  }
  // If not last attempt: BullMQ will retry automatically per backoff config
});

scanWorker.on('error', (err) => {
  // Worker-level errors (Redis disconnect, etc.) — not job failures
  logger.error({ error: err.message }, 'worker error');
});

scanWorker.on('stalled', (jobId) => {
  logger.warn({ bullJobId: jobId }, 'job stalled — will be re-queued by BullMQ');
});

// Graceful shutdown 
export async function shutdownWorker() {
  logger.info('shutting down worker...');
  // close() waits for active jobs to finish before stopping
  // Use closeGracefully() to wait for ALL currently active jobs
  await scanWorker.close();
  logger.info('worker stopped');
}

// If running as standalone process (node worker.js)
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
