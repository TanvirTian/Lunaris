import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { disconnectDb } from './lib/db.js';
import { disconnectRedis } from './lib/redis.js';
import { closeQueue } from './lib/queue.js';
import { shutdownWorker, scanWorker } from './worker.js';
import { logger } from './lib/logger.js';
import { httpRequestsTotal, httpRequestDurationSeconds } from './lib/metrics.js';
import analyzeRoute from './routes/analyze.js';
import scanRoutes   from './routes/scan.js';
import healthRoute  from './routes/health.js';

const fastify = Fastify({
  genReqId: () => crypto.randomUUID(),
  logger:   false,
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
await fastify.register(rateLimit, {
  max:        10,
  timeWindow: '1 minute',
  // Allow routes to opt-out via config: { rateLimit: { skip: true } }
  // Used by /health and /metrics so infrastructure probes are never throttled
  skipOnError: true,
  keyGenerator: (request) => request.ip,
  errorResponseBuilder: () => ({
    error: 'Too many requests. Please wait a minute before scanning again.',
  }),
});

// ── CORS ──────────────────────────────────────────────────────────────────────
await fastify.register(cors, {
  origin:  process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'DELETE'],
});

// ── HTTP metrics middleware ───────────────────────────────────────────────────
// Tracks all requests for Prometheus using start time stored on request object.
//
// Route normalization:
//   UUID path params would create a unique label per request, causing
//   Prometheus cardinality explosion (millions of time series).
//   We normalize /scan/<uuid> → /scan/:id before recording labels.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function normalizeRoute(url) {
  // Strip query string
  const path = url.split('?')[0];
  // Replace UUIDs with :id placeholder
  return path.replace(UUID_RE, ':id');
}

fastify.addHook('onRequest', (request, _reply, done) => {
  // Store high-resolution start time for duration calculation in onResponse
  request.startTime = process.hrtime.bigint();
  logger.info(
    { requestId: request.id, method: request.method, url: request.url },
    'incoming request',
  );
  done();
});

fastify.addHook('onResponse', (request, reply, done) => {
  const durationNs = process.hrtime.bigint() - request.startTime;
  const durationS  = Number(durationNs) / 1e9;
  const route      = normalizeRoute(request.url);
  const labels     = {
    method:      request.method,
    route,
    status_code: String(reply.statusCode),
  };

  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, durationS);

  logger.info(
    { requestId: request.id, statusCode: reply.statusCode, responseTime: reply.elapsedTime },
    'request completed',
  );
  done();
});

// ── Request logging ───────────────────────────────────────────────────────────
fastify.addHook('onRequest', (request, reply, done) => {
  logger.info(
    { requestId: request.id, method: request.method, url: request.url },
    'incoming request',
  );
  done();
});

// ── Routes ────────────────────────────────────────────────────────────────────
await fastify.register(analyzeRoute);
await fastify.register(scanRoutes);
await fastify.register(healthRoute);

// ── 404 handler ───────────────────────────────────────────────────────────────
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({ error: `Route ${request.method} ${request.url} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
fastify.setErrorHandler((err, request, reply) => {
  logger.error(
    { requestId: request.id, error: err.message, stack: err.stack },
    'unhandled route error',
  );

  if (err.validation) {
    return reply.status(400).send({ error: 'Invalid request: ' + err.message });
  }
  if (err.statusCode === 429) {
    return reply.status(429).send({ error: err.message });
  }

  reply.status(500).send({ error: 'An internal error occurred. Please try again.' });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
fastify.addHook('onClose', async () => {
  logger.info('shutdown sequence started');
  await shutdownWorker();
  await closeQueue();
  await disconnectRedis();
  await disconnectDb();
  logger.info('shutdown complete');
});

const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];
for (const signal of signals) {
  process.once(signal, async () => {
    logger.info(`received ${signal} — starting graceful shutdown`);
    await fastify.close();
    process.exit(0);
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
try {
  const PORT = parseInt(process.env.PORT || '8000', 10);
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  logger.info({ port: PORT }, '🛡  Privacy Analyzer API running');
} catch (err) {
  logger.error({ error: err.message }, 'server failed to start');
  process.exit(1);
}
