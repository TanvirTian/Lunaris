import { Queue, QueueEvents } from 'bullmq';
import { redis } from './redis.js';

export const QUEUE_NAME = 'scan';
export const DLQ_NAME   = 'scan-dlq';

// ── Main scan queue ────────────────────────────────────────────────────────────
export const scanQueue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    priority: 2,

    // Retry policy: 3 attempts with exponential backoff
    // Attempt 1: immediate
    // Attempt 2: 5 seconds later
    // Attempt 3: 20 seconds later
    // After attempt 3: moved to DLQ
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000,
    },

    // Remove completed jobs after 2 hours — they're persisted in PostgreSQL
    // Keeping them longer wastes Redis memory
    removeOnComplete: {
      age:   2 * 60 * 60, // 2 hours in seconds
      count: 500,          // keep last 500 regardless of age
    },

    // Keep failed jobs for 24 hours for debugging before DLQ cleanup
    removeOnFail: {
      age: 24 * 60 * 60,
    },
  },
});

// ── Dead Letter Queue ─────────────────────────────────────────────────────────
// Receives jobs that exhausted all retry attempts.
// Not processed by any worker — used for inspection and alerting.
export const dlq = new Queue(DLQ_NAME, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: false, // keep DLQ jobs permanently for review
    removeOnFail: false,
  },
});

// ── Queue Events ──────────────────────────────────────────────────────────────
// Used for metrics and logging — does NOT affect job processing
export const scanQueueEvents = new QueueEvents(QUEUE_NAME, {
  connection: redis,
});

scanQueueEvents.on('completed', ({ jobId }) => {
  console.info(`[queue] job ${jobId} completed`);
});

scanQueueEvents.on('failed', ({ jobId, failedReason }) => {
  console.warn(`[queue] job ${jobId} failed: ${failedReason}`);
});

scanQueueEvents.on('stalled', ({ jobId }) => {
  // Stalled = worker crashed while processing this job
  // BullMQ automatically re-queues stalled jobs after stalledInterval
  console.warn(`[queue] job ${jobId} stalled — will be re-queued`);
});

// ── Queue metrics helper ──────────────────────────────────────────────────────
export async function getQueueMetrics() {
  const [waiting, active, completed, failed, delayed, dlqCount] = await Promise.all([
    scanQueue.getWaitingCount(),
    scanQueue.getActiveCount(),
    scanQueue.getCompletedCount(),
    scanQueue.getFailedCount(),
    scanQueue.getDelayedCount(),
    dlq.getWaitingCount(),
  ]);

  return { waiting, active, completed, failed, delayed, dlqCount };
}

export async function closeQueue() {
  await Promise.all([
    scanQueue.close(),
    dlq.close(),
    scanQueueEvents.close(),
  ]);
}