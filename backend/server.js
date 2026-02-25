import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { disconnectDb } from './lib/db.js';
import { disconnectRedis } from './lib/redis.js';
import { closeQueue } from './lib/queue.js';
import { shutdownWorker, scanWorker } from './worker.js';
import { logger } from './lib/logger.js';
import analyzeRoute from './routes/analyze.js';
import scanRoutes   from './routes/scan.js';
import healthRoute  from './routes/health.js';

const fastify = Fastify({
  // Use a request ID generator for tracing requests through logs
  genReqId: () => crypto.randomUUID(),
  logger: false, // we use our own structured logger
});

// Rate limiting
// Prevents a single client from flooding the queue with crawl requests.
// 10 requests per minute per IP is generous for a scan tool.
// Adjust based on your expected user patterns.
await fastify.register(rateLimit, {
  max: 10,
  timeWindow: '1 minute',
  errorResponseBuilder: () => ({
    error: 'Too many requests. Please wait a minute before scanning again.',
  }),
});

// CORS
await fastify.register(cors, {
  origin:  process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'DELETE'],
});

// Request logging hook
fastify.addHook('onRequest', (request, reply, done) => {
  logger.info(
    { requestId: request.id, method: request.method, url: request.url },
    'incoming request'
  );
  done();
});

fastify.addHook('onResponse', (request, reply, done) => {
  logger.info(
    { requestId: request.id, statusCode: reply.statusCode, responseTime: reply.elapsedTime },
    'request completed'
  );
  done();
});

// Routes
await fastify.register(analyzeRoute);
await fastify.register(scanRoutes);
await fastify.register(healthRoute);

// 404 handler
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({ error: `Route ${request.method} ${request.url} not found` });
});

// Global error handler
// Never expose raw stack traces to clients
fastify.setErrorHandler((err, request, reply) => {
  logger.error(
    { requestId: request.id, error: err.message, stack: err.stack },
    'unhandled route error'
  );

  // Fastify validation errors (schema mismatch)
  if (err.validation) {
    return reply.status(400).send({ error: 'Invalid request: ' + err.message });
  }

  // Rate limit error
  if (err.statusCode === 429) {
    return reply.status(429).send({ error: err.message });
  }

  reply.status(500).send({ error: 'An internal error occurred. Please try again.' });
});

// Graceful shutdown
fastify.addHook('onClose', async () => {
  logger.info('shutdown sequence started');
  await shutdownWorker();   // wait for active jobs to finish
  await closeQueue();       // close BullMQ queue connections
  await disconnectRedis();  // close Redis connection
  await disconnectDb();     // close PostgreSQL connection pool
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

// Start
try {
  const PORT = parseInt(process.env.PORT || '8000', 10);
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  logger.info({ port: PORT }, '🛡  Privacy Analyzer API running');
} catch (err) {
  logger.error({ error: err.message }, 'server failed to start');
  process.exit(1);
}
