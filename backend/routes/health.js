import { checkDbHealth } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { getQueueMetrics } from '../lib/queue.js';
import { metrics } from '../lib/metrics.js';

export default async function healthRoute(fastify) {

  // ── GET /health ─────────────────────────────────────────────────────────────
  // Returns 200 when the service is healthy, 503 when degraded.
  // Used by:
  //   - Docker Compose healthcheck
  //   - Load balancer health probes
  //   - Kubernetes liveness/readiness probes
  //   - Uptime monitoring (Uptime Robot, Betterstack, etc.)
  fastify.get('/health', {
    // Skip rate limiting for health probes — they come from infrastructure,
    // not users, and should never be throttled.
    config: { rateLimit: { skip: true } },
  }, async (_request, reply) => {
    const [dbHealth, queueMetrics] = await Promise.allSettled([
      checkDbHealth(),
      getQueueMetrics(),
      redis.ping(), // Redis health implicit in getQueueMetrics but make explicit
    ]);

    const db      = dbHealth.status === 'fulfilled' ? dbHealth.value : { ok: false };
    const queue   = queueMetrics.status === 'fulfilled' ? queueMetrics.value : null;
    const healthy = db.ok;

    const response = {
      status:    healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: db.ok ? 'up' : 'down',
        redis:    queue !== null ? 'up' : 'down',
      },
      queue: queue ? {
        waiting:  queue.waiting,
        active:   queue.active,
        failed:   queue.failed,
        dlq:      queue.dlqCount,
      } : null,
      metrics: metrics.snapshot(),
    };

    return reply.status(healthy ? 200 : 503).send(response);
  });


  // ── GET /metrics ─────────────────────────────────────────────────────────────
  fastify.get('/metrics', {
    config: { rateLimit: { skip: true } },
  }, async (_request, reply) => {
    try {
      const metricsText = await metrics.getMetrics();
      return reply
        .header('Content-Type', metrics.contentType())
        .send(metricsText);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to collect metrics.' });
    }
  });
}
