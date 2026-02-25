/**
 * Prisma Client Singleton
 * -----------------------------------------------------------------------------
 * Why singleton?
 *
 * PrismaClient manages an internal connection pool. Creating a new instance
 * per request would:
 *   - Exhaust PostgreSQL max_connections instantly under load
 *   - Create memory leaks from unclosed pools
 *   - Make "too many clients" errors inevitable
 *
 * The singleton ensures exactly ONE PrismaClient per process.
 *
 * Development hot-reload problem:
 *   Node's module cache is cleared on each file change (nodemon/--watch),
 *   but globalThis persists for the process lifetime. We cache the instance
 *   on globalThis in development so hot-reloads don't create new pools.
 *   In production this branch is never taken (fresh process each deploy).
 * -----------------------------------------------------------------------------
 */

import { PrismaClient } from '@prisma/client';

function buildPrismaClient() {
  const logConfig = process.env.NODE_ENV === 'production'
    ? [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ]
    : [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ];

  const client = new PrismaClient({ log: logConfig });

  // Emit logs through your existing logger rather than console.log
  client.$on('error', (e) => console.error('[prisma:error]', e));
  client.$on('warn',  (e) => console.warn('[prisma:warn]',  e.message));

  if (process.env.NODE_ENV !== 'production') {
    client.$on('query', (e) => console.debug('[prisma:query]', e.query, e.duration + 'ms'));
  }

  return client;
}

const globalForPrisma = globalThis;

export const db = globalForPrisma._prisma ?? buildPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma._prisma = db;
}

/**
 * Call this in Fastify's onClose hook.
 * Drains active queries and closes all pool connections gracefully.
 */
export async function disconnectDb() {
  await db.$disconnect();
}

/**
 * Verify DB connectivity — used by the health endpoint.
 * $queryRaw is the lightest possible round-trip.
 */
export async function checkDbHealth() {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
