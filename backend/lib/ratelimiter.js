import { redis }  from './redis.js';
import { logger } from './logger.js';


const STRICT_LIMIT = 10;

// Read endpoints (GET /scan/:id, GET /scans) are cheap DB lookups.
// 60/min covers normal polling patterns without false positives.
const NORMAL_LIMIT = 60;

// Both policies share a 60-second fixed window.
const WINDOW_S = 60;

// -- Exempt paths -------------------------------------------------------------
// Infrastructure probes -- must never be blocked under any circumstance.
const EXEMPT_PATHS = new Set(['/health', '/metrics']);

// -- Strict routes ------------------------------------------------------------
// "METHOD:normalizedPath" -- unambiguous, survives future route additions.
const STRICT_ROUTES = new Set(['POST:/analyze']);

// Returns the post-increment counter value.
const INCR_AND_EXPIRE_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
  end
  return count
`;

// -- Helpers ------------------------------------------------------------------

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function normalizePath(url) {
  return (
    url
      .split('?')[0]          // 1. drop query string
      .replace(/\/+/g, '/')   // 2. collapse repeated slashes
      .replace(/\/$/, '')     // 3. strip trailing slash
      .replace(UUID_RE, ':id')// 4. collapse UUIDs
      .toLowerCase()          // 5. case-insensitive matching
    || '/'                    //    guard: empty string after strip -> root
  );
}

function buildKey(ip, method, normalizedPath) {
  return `ratelimit:${ip}:${method}:${normalizedPath}`;
}

export async function rateLimiter(request, reply) {
  const path = normalizePath(request.url);

  // -- Exempt infrastructure endpoints ---------------------------------------
  if (EXEMPT_PATHS.has(path)) {
    return; // instant pass-through, zero Redis calls
  }

  // -- Select policy ---------------------------------------------------------
  const routeKey = `${request.method}:${path}`;
  const limit    = STRICT_ROUTES.has(routeKey) ? STRICT_LIMIT : NORMAL_LIMIT;

  // -- Build Redis key -------------------------------------------------------
  // request.ip is populated by Fastify from the socket address, or from
  // X-Forwarded-For when trustProxy is enabled on the Fastify instance.
  const ip  = request.ip;
  const key = buildKey(ip, request.method, path);

  // -- Atomic INCR + EXPIRE via Lua -----------------------------------------
  // One round trip to Redis. Lua runs atomically inside Redis -- INCR and the
  // conditional EXPIRE are inseparable. No TTL-less keys can survive a crash.
  let count;
  try {
    count = await redis.eval(INCR_AND_EXPIRE_SCRIPT, 1, key, String(WINDOW_S));
  } catch (err) {
    // -- Fail-open: Redis unavailable ----------------------------------------
    // A rate-limiter outage must not take down the API. Log a warning and let
    // the request through. The warning appears in logs and Grafana so
    // operators can investigate Redis without impacting users.
    logger.warn(
      { err: err.message, ip, key },
      'rate limiter: Redis eval failed -- failing open',
    );
    return;
  }

  // -- Enforce the limit -----------------------------------------------------
  if (count > limit) {
    // Fetch the real TTL so Retry-After tells the client exactly how long to
    // wait. This extra Redis call only happens on the 429 path (the client is
    // already over limit) so it does not add latency to normal requests.
    let retryAfter = WINDOW_S; // safe default if the TTL call fails
    try {
      const ttl = await redis.ttl(key);
      if (ttl > 0) retryAfter = ttl;
    } catch {
      // Non-fatal: fall back to the full window duration
    }

    // Retry-After is required by RFC 6585 section 4 for 429 responses.
    reply.header('Retry-After', String(retryAfter));

    return reply.status(429).send({
      error:      'Too many requests',
      retryAfter,
    });
  }
}
