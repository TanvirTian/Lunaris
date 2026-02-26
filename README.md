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
Browser
  │
  ▼
┌─────────────────────────────┐
│   lunaris-frontend          │  ← nginx serves React app + proxies API calls
│   nginx:alpine · port 3000  │    browser never talks to backend directly
└────────────┬────────────────┘
             │ proxy_pass (internal Docker network)
             ▼
┌─────────────────────────────┐
│   lunaris-backend           │  ← Fastify API: validates URL, deduplicates,
│   node:20-slim · port 8000  │    creates ScanJob, enqueues to BullMQ
│   Rate limiting · SSRF      │    returns jobId in <100ms (HTTP 202)
└────────────┬────────────────┘
             │ enqueue job
             ▼
┌─────────────────────────────┐
│   lunaris-redis             │  ← BullMQ queue storage, retry state
│   redis:7-alpine            │    transient — not the source of truth
└────────────┬────────────────┘
             │ dequeue job
             ▼
┌─────────────────────────────┐
│   lunaris-worker            │  ← Playwright crawl → analysis → score
│   node:20-slim (same image) │    concurrency capped at WORKER_CONCURRENCY
│   RAM: 1.5GB · CPU: 1.5     │    retries 3× with exponential backoff
└────────────┬────────────────┘
             │ persist result (atomic transaction)
             ▼
┌─────────────────────────────┐
│   lunaris-postgres          │  ← ScanJob + ScanResult — permanent source of truth
│   postgres:16-alpine        │    JSONB for raw crawl data, typed cols for analytics
└─────────────────────────────┘
             │
             ▼
Browser polls GET /scan/:id → receives result

```

**Key design decisions:**

-   Backend never touches Playwright — returns in <100ms regardless of crawl time
-   nginx proxies all API calls internally — browser stays on one origin, no CORS needed
-   Backend and worker share one Docker image, run different commands
-   DNS pre-resolution + private IP blocking before any browser is launched
-   Atomic DB transactions — no SUCCESS job without a result, no orphaned records
-   Database migrations run automatically on every backend container startup


## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| API Server | Fastify 4 | HTTP layer, rate limiting, schema validation |
| ORM | Prisma 5 | Type-safe PostgreSQL access, migrations |
| Database | PostgreSQL 16 | Permanent storage, JSONB result blobs |
| Queue | BullMQ + Redis 7 | Async job processing, retries, DLQ |
| Crawler | Playwright + Chromium | Headless browser, fingerprint detection |
| Frontend | React 18 + Vite | UI, result polling |


## Project Structure

```
.
├── docker-compose.yml         
├── docker-compose.dev.yml       
├── .env                        
├── .env.example
│
├── backend/
│   ├── Dockerfile              
│   ├── .env                    
│   ├── .env.example
│   ├── server.js               
│   ├── worker.js               
│   ├── lib/
│   │   ├── db.js               
│   │   ├── queue.js            
│   │   ├── redis.js            
│   │   ├── logger.js           
│   │   └── metrics.js          
│   ├── routes/
│   │   ├── analyze.js          
│   │   ├── scan.js             
│   │   └── health.js           
│   ├── services/
│   │   ├── crawler.js          
│   │   ├── analyzer.js         
│   │   ├── cookieAnalysis.js   
│   │   ├── ownershipGraph.js   
│   │   └── scriptIntelligence.js
│   └── prisma/
│       ├── schema.prisma
│       └── migrations/
│
└── frontend/
    ├── Dockerfile              
    ├── Dockerfile.dev          
    ├── nginx.conf              
    ├── .env                    
    └── src/
        ├── App.jsx
        ├── lib/api.js          
        └── components/

```

## Docker Setup (Recommended)

### Quick start

```bash
# 1. Clone repository
git clone https://github.com/TanvirTian/Lunaris
cd Lunaris

# 2. Create root environment file (Docker Compose configuration)
cp .env.example .env
# Set POSTGRES_PASSWORD to match backend/.env

# 3. Configure backend runtime environment
cp backend/.env.example backend/.env

# 4. Build and start all services
docker compose up -d --build

# 5. Verify services are running
docker compose ps

# 6. Test API health
curl http://localhost:8000/health

```

Open `http://localhost:3000`


### Common commands

```bash
# View all container statuses
docker compose ps

# Follow logs for a specific container
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f frontend

# Restart a single container (e.g. after config change)
docker compose restart backend

# Rebuild after source code changes
docker compose up -d --build

# Stop all containers (data is preserved in volumes)
docker compose down

# Stop and DELETE all data (volumes wiped)
docker compose down -v

# Open a shell inside a container
docker exec -it lunaris-backend sh
docker exec -it lunaris-postgres psql -U postgres -d privacy_analyzer

```

### Development mode (hot reload)

For active development — mounts your local source into containers, restarts Node on file changes:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

```

Add an alias to `~/.bashrc` for convenience:

```bash
alias dcdev="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
# then just:
dcdev up

```

In dev mode:

-   Backend and worker use `node --watch` — restart automatically on `.js` file saves
-   Frontend uses Vite dev server with full HMR — browser updates without page reload
-   Source code is volume-mounted — no rebuild needed for code changes
-   Only rebuild when `package.json` or `Dockerfile` changes

### Data persistence

Both database volumes persist across restarts:

```yaml
volumes:
  postgres_data:   # all scan jobs, results, history
  redis_data:      # queue state snapshot (every 60s)

```

`docker compose down` keeps your data. `docker compose down -v` deletes it permanently.

## Local Development 

**Prerequisites:** Node.js 20+, PostgreSQL, Redis

```bash
# 1. Clone and install
git clone https://github.com/TanvirTian/Lunaris
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

