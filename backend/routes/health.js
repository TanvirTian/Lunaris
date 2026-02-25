import { checkDbHealth } from '../lib/db.js';
import { checkRedisHealth } from '../lib/redis.js';
import { getQueueMetrics } from '../lib/queue.js';
import { metrics } from '../lib/metrics.js';

export default async function healthRoute(fastify) {

  fastify.get('/health', async (request, reply) => {
    const [dbHealth, redisHealth] = await Promise.all([
      checkDbHealth(),
      checkRedisHealth(),
    ]);

    const healthy = dbHealth.ok && redisHealth.ok;

    return reply.status(healthy ? 200 : 503).send({
      status:    healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: { ok: dbHealth.ok },
        redis:    { ok: redisHealth.ok },
      },
    });
  });

  fastify.get('/metrics', async (request, reply) => {
    const [dbHealth, redisHealth, queueMetrics] = await Promise.all([
      checkDbHealth(),
      checkRedisHealth(),
      getQueueMetrics(),
    ]);

    return reply.send({
      timestamp:  new Date().toISOString(),
      services: {
        database: dbHealth,
        redis:    redisHealth,
      },
      queue:   queueMetrics,
      process: metrics.snapshot(),
      uptime:  process.uptime(),
      memory:  process.memoryUsage(),
    });
  });
}
