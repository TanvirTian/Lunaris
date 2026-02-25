/**
 * Structured Logger
 * -----------------------------------------------------------------------------
 * Wraps Fastify's pino logger for use outside of route handlers
 * (workers, queue processors, services).
 *
 * Why structured logging?
 *   Plain console.log() produces unqueryable text blobs.
 *   Structured JSON logs can be ingested by:
 *     - Grafana Loki
 *     - Datadog
 *     - AWS CloudWatch
 *     - ELK stack
 *   And queried by field: "show all logs where jobId = X and level = error"
 *
 * Every log entry automatically includes:
 *   - timestamp (ISO 8601)
 *   - level (info/warn/error/debug)
 *   - service name
 *   - any extra fields passed as first argument
 * -----------------------------------------------------------------------------
 */

// Minimal structured logger that works without pino installed as a direct dep
// (pino is bundled with Fastify — we reuse it)
// If you add pino directly: npm install pino pino-pretty

const SERVICE = process.env.SERVICE_NAME || 'privacy-analyzer';
const IS_DEV  = process.env.NODE_ENV !== 'production';

function formatEntry(level, data, message) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    ...(typeof data === 'string' ? { msg: data } : { ...data, msg: message }),
  };

  if (IS_DEV) {
    // Pretty print in development
    const color = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' };
    const reset = '\x1b[0m';
    const prefix = `${color[level] || ''}[${level.toUpperCase()}]${reset}`;
    const msg = entry.msg || '';
    const extra = Object.fromEntries(
      Object.entries(entry).filter(([k]) => !['timestamp','level','service','msg'].includes(k))
    );
    const extraStr = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      `${entry.timestamp} ${prefix} ${msg}${extraStr}`
    );
  } else {
    // JSON in production — one line per entry
    console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
  }
}

export const logger = {
  info:  (data, msg) => formatEntry('info',  data, msg),
  warn:  (data, msg) => formatEntry('warn',  data, msg),
  error: (data, msg) => formatEntry('error', data, msg),
  debug: (data, msg) => formatEntry('debug', data, msg),

  // Convenience: create a child logger with fixed context fields
  // e.g. const jobLog = logger.child({ jobId: '123' })
  // jobLog.info('crawl started') → includes jobId in every entry
  child(context) {
    return {
      info:  (data, msg) => logger.info({ ...context, ...(typeof data === 'string' ? { msg: data } : data) }, msg || data),
      warn:  (data, msg) => logger.warn({ ...context, ...(typeof data === 'string' ? { msg: data } : data) }, msg || data),
      error: (data, msg) => logger.error({ ...context, ...(typeof data === 'string' ? { msg: data } : data) }, msg || data),
      debug: (data, msg) => logger.debug({ ...context, ...(typeof data === 'string' ? { msg: data } : data) }, msg || data),
      child: (ctx2) => logger.child({ ...context, ...ctx2 }),
    };
  },
};
