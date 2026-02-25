# 🌙 Lunaris

**Privacy analysis engine for the modern web.**

Lunaris scans any public URL and surfaces trackers, cookies, fingerprinting vectors, third-party data flows, and dark patterns — processed asynchronously through a production-grade queue architecture.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Fastify](https://img.shields.io/badge/Fastify-4-000000?style=flat-square&logo=fastify&logoColor=white)](https://fastify.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://prisma.io)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)


## What Lunaris Does

Submit any URL. Lunaris launches a headless Chromium instance, crawls the site across multiple pages, and produces a detailed privacy report:

- **Tracker detection** — identifies known tracking scripts, pixels, and third-party domains
- **Cookie analysis** — classifies cookies by purpose, lifetime, and security attributes
- **Fingerprinting detection** — detects canvas, WebGL, and font fingerprinting attempts
- **Ownership graph** — maps tracker domains back to parent corporations
- **Dark pattern signals** — surfaces consent manipulation and deceptive UI patterns
- **Privacy score** — 0–100 score with per-signal deductions and risk classification

Scans are processed asynchronously. The API returns a job ID immediately and the client polls for results — no HTTP timeouts, no blocking.


## Architecture

```
Client
  │
  ▼
┌─────────────────────────────┐
│       Fastify API           │  ← validates URL, deduplicates, returns jobId (202)
│   Rate limiting · SSRF      │
└────────────┬────────────────┘
             │ enqueue
             ▼
┌─────────────────────────────┐
│     Redis + BullMQ          │  ← persistent job queue, retry logic, DLQ
└────────────┬────────────────┘
             │ dequeue
             ▼
┌─────────────────────────────┐
│        Worker               │  ← Playwright crawl → analysis → score
│   Concurrency controlled    │
└────────────┬────────────────┘
             │ persist
             ▼
┌─────────────────────────────┐
│       PostgreSQL            │  ← ScanJob + ScanResult, source of truth
└─────────────────────────────┘
             │
             ▼
Client polls GET /scan/:id → receives result
```

**Key design decisions:**

- API layer never touches Playwright — returns in <100ms regardless of crawl time
- Redis holds transient queue state. PostgreSQL holds all permanent data
- Single Docker image runs as both API server and worker (different commands)
- DNS pre-resolution + private IP blocking before any browser is launched
- Atomic DB transactions — no SUCCESS job without a result, no orphaned records


## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| API Server | Fastify 4 | HTTP layer, rate limiting, schema validation |
| ORM | Prisma 5 | Type-safe PostgreSQL access, migrations |
| Database | PostgreSQL 16 | Permanent storage, JSONB result blobs |
| Queue | BullMQ + Redis 7 | Async job processing, retries, DLQ |
| Crawler | Playwright + Chromium | Headless browser, fingerprint detection |
| Frontend | React 18 + Vite | UI, result polling |


# Project Structure
```
.
├── backend
│   ├── lib/
│   │   ├── db.js
│   │   ├── logger.js
│   │   ├── metrics.js
│   │   ├── queue.js
│   │   ├── redis.js
│   ├── prisma/
│   │   ├── migrations/
│   │   └── schema.prisma
│   ├── routes/
│   │   ├── analyze.js
│   │   ├── health.js
│   │   └── scan.js
│   ├── services/
│   │   ├── analyzer.js
│   │   ├── cookieAnalysis.js
│   │   ├── crawler.js
│   │   ├── ownershipGraph.js
│   │   └── scriptIntelligence.js
│   ├── worker.js
│   └── server.js
├── frontend
│   ├── src/
│   │   ├── components/
│   │   ├── lib/api.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── vite.config.js
└── README.md
```

## Local Development 

**Prerequisites:** Node.js 20+, PostgreSQL, Redis

```bash
# 1. Clone and install
git clone <repo>
cd lunaris

# 2. Backend
cd backend
npm install
cp .env.example .env
# Edit .env — set DATABASE_URL and REDIS_URL

# 3. Run database migrations
npx prisma migrate dev

# 4. Start backend + worker (two terminals)
npm start          # terminal 1 — API on http://localhost:8000
node worker.js     # terminal 2 — background worker

# 5. Frontend
cd ../frontend
npm install
npm run dev        # http://localhost:3000
```


## API Reference

### `POST /analyze`
Submit a URL for scanning.

```json
// Request
{ "url": "https://example.com" }

// Response 202
{
  "jobId": "uuid",
  "status": "PENDING",
  "pollUrl": "/scan/uuid"
}
```

### `GET /scan/:id`
Poll scan status and retrieve results.

```json
// Response (SUCCESS)
{
  "jobId": "uuid",
  "status": "SUCCESS",
  "result": {
    "score": 74,
    "riskLevel": "MODERATE",
    "summary": "...",
    "trackerCount": 3,
    "fingerprinting": { "canvas": false, "webgl": true },
    "data": { ... }
  }
}
```

### `GET /health`
```json
{ "status": "ok", "services": { "database": { "ok": true }, "redis": { "ok": true } } }
```

### `GET /metrics`
Returns queue depth, success/failure rates, crawl duration buckets, memory usage.

## Privacy Score Model

Score starts at **100**. Deductions are applied per signal:

| Signal | Deduction |
|---|---|
| Known tracker domain | −5 per tracker |
| Canvas / WebGL fingerprinting | −10 |
| Keylogger detected | −15 |
| Missing HTTPS | −20 |
| High-risk obfuscated scripts | −5 each |
| Dark pattern indicators | −5 each |

Final score is clamped to **0–100** and classified:

| Score | Risk Level |
|---|---|
| 80–100 | Low |
| 60–79 | Moderate |
| 40–59 | Elevated |
| 0–39 | High |


## Security

- **SSRF protection** — DNS pre-resolution, private IP range blocking (RFC1918, link-local, CGNAT), metadata endpoint blocking
- **Rate limiting** — 10 requests/minute per IP
- **Input validation** — structural URL parsing, no-dot hostname check, protocol allowlist
- **Non-root containers** — all Docker containers run as the `node` user
- **No secret baking** — environment variables only, never in image layers

## Scaling

The architecture supports horizontal scaling without code changes:

- **Multiple API servers** — stateless, add a load balancer in front
- **Multiple workers** — point additional `worker.js` instances at the same Redis and PostgreSQL. BullMQ's job locking ensures each job is processed exactly once
- **Database** — add PostgreSQL read replicas for analytics queries, PgBouncer for connection pooling at high concurrency


Built as a production system design study in asynchronous processing, browser automation, and privacy analysis.

