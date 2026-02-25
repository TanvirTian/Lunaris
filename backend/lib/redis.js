/**
 * Redis Connection
 * -----------------------------------------------------------------------------
 * Single IORedis instance shared across BullMQ producers and workers.
 *
 * Why IORedis and not the built-in BullMQ redis option?
 *   BullMQ accepts an IORedis instance directly, which lets us:
 *   - Share one connection pool across queue + worker + health checks
 *   - Handle reconnection logic in one place
 *   - Monitor connection state for the health endpoint
 *
 * Why NOT use Redis as a database?
 *   Redis is volatile. A restart without persistence config loses all data.
 *   We use it exclusively for:
 *     1. BullMQ job queue state (transient — jobs move to PostgreSQL on completion)
 *     2. Short-lived deduplication keys (TTL-based)
 *     3. Rate limiting counters (TTL-based)
 *   PostgreSQL remains the single source of truth for all permanent data.
 * -----------------------------------------------------------------------------
 */

import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// BullMQ requires maxRetriesPerRequest: null on the IORedis connection
// Without this, BullMQ operations throw "Max retries per request limit exceeded"
// when Redis is briefly unavailable during reconnection.
export const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,  // required by BullMQ
  enableReadyCheck: false,     // required by BullMQ
  retryStrategy(times) {
    // Exponential backoff capped at 10 seconds
    // Prevents hammering Redis during an outage
    const delay = Math.min(times * 200, 10_000);
    console.warn(`[redis] reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  reconnectOnError(err) {
    // Reconnect on READONLY errors (happens during Redis Sentinel failover)
    return err.message.includes('READONLY');
  },
});

redis.on('connect',        () => console.info('[redis] connected'));
redis.on('ready',          () => console.info('[redis] ready'));
redis.on('error',  (err)   => console.error('[redis] error:', err.message));
redis.on('close',          () => console.warn('[redis] connection closed'));
redis.on('reconnecting',   () => console.warn('[redis] reconnecting...'));

export async function checkRedisHealth() {
  try {
    const pong = await redis.ping();
    return { ok: pong === 'PONG' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function disconnectRedis() {
  await redis.quit();
}
