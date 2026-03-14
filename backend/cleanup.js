import { db, disconnectDb } from './lib/db.js';
import { logger } from './lib/logger.js';

const JOB_TTL_MS    = 72 * 60 * 60 * 1000; // 72 hours
const BATCH_SIZE    = 500; // delete in batches to avoid long-running transactions

export async function runCleanup() {
  const cutoff = new Date(Date.now() - JOB_TTL_MS);
  const log = logger.child({ cutoff, task: 'cleanup' });

  log.info('starting scheduled cleanup');

  let totalDeleted = 0;
  let batch = 0;

  // Delete in batches to avoid locking the table for too long.
  // Each batch is its own transaction. if one batch fails, previous
  while (true) {
    batch++;

    const oldJobs = await db.scanJob.findMany({
      where: {
        completedAt: { lt: cutoff },
        status:      { in: ['SUCCESS', 'FAILED'] },
      },
      select: { id: true },
      take:   BATCH_SIZE,
    });

    if (oldJobs.length === 0) break;

    const ids = oldJobs.map(j => j.id);

    // Deleting ScanJob automatically cascades to ScanResult (onDelete: Cascade).
    const deleted = await db.scanJob.deleteMany({
      where: { id: { in: ids } },
    });

    totalDeleted += deleted.count;
    log.info({ batch, batchDeleted: deleted.count, totalDeleted }, 'cleanup batch complete');

    
    if (oldJobs.length < BATCH_SIZE) break;

    await new Promise(r => setTimeout(r, 100));
  }

  log.info({ totalDeleted }, 'cleanup complete');
  return { totalDeleted, cutoff };
}

// Standalone entry point
// Run directly: node cleanup.js
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runCleanup()
    .then(({ totalDeleted }) => {
      console.info(`cleanup finished — deleted ${totalDeleted} jobs`);
      return disconnectDb();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('cleanup failed:', err.message);
      process.exit(1);
    });
}
