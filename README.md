
# 🌙 Lunaris

**Privacy analysis engine for the modern web.**

Lunaris helps you see what websites are really doing behind the scenes.

Instead of guessing how your data is being collected, Lunaris automatically visits a website and analyzes how it behaves, finding trackers, data leaks, and privacy risks in real time using automated browser-based analysis.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Fastify](https://img.shields.io/badge/Fastify-4-000000?style=flat-square&logo=fastify&logoColor=white)](https://fastify.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://prisma.io)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![Prometheus](https://img.shields.io/badge/Prometheus-2.51-E6522C?style=flat-square&logo=prometheus&logoColor=white)](https://prometheus.io)
[![Grafana](https://img.shields.io/badge/Grafana-10.4-F46800?style=flat-square&logo=grafana&logoColor=white)](https://grafana.com)
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




## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| API Server | Fastify 4 | HTTP layer, rate limiting, schema validation |
| ORM | Prisma 5 | Type-safe PostgreSQL access, migrations |
| Database | PostgreSQL 16 | Permanent storage, JSONB result blobs |
| Queue | BullMQ + Redis 7 | Async job processing, retries, DLQ |
| Crawler | Playwright + Chromium | Headless browser, fingerprint detection |
| Monitoring & Observability | Prometheus + Grafana| Metrics collection, system health monitoring, and performance visualization|
| Frontend | React 18 + Vite | UI, result polling |



## Project Structure
```
├── backend  
│ ├── cleanup.js  
│ ├── Dockerfile  
│ ├── lib  
│ │ ├── db.js  
│ │ ├── logger.js  
│ │ ├── metrics.js  
│ │ ├── queue.js  
│ │ ├── ratelimiter.js  
│ │ └── redis.js  
│ ├── package.json  
│ ├── package-lock.json  
│ ├── prisma  
│ │ ├── migrations  
│ │ │ ├── 20260223184806_init  
│ │ │ │ └── migration.sql  
│ │ │ ├── 20260302200744_add_domain_scans  
│ │ │ │ └── migration.sql  
│ │ │ ├── 20260309145922_add_domain_to_scanjob  
│ │ │ │ └── migration.sql  
│ │ │ ├── 20260309155438_enforce_varchar_and_text_types  
│ │ │ │ └── migration.sql  
│ │ │ ├── 20260313193853_add_cleanup_index_remove_boolean_indexes  
│ │ │ │ └── migration.sql  
│ │ │ └── migration_lock.toml  
│ │ └── schema.prisma  
│ ├── routes  
│ │ ├── analyze.js  
│ │ ├── health.js  
│ │ └── scan.js  
│ ├── server.js  
│ ├── services  
│ │ ├── analyzer.js  
│ │ ├── cookieAnalysis.js  
│ │ ├── crawler.js  
│ │ ├── networkAnalysis.js  
│ │ ├── ownershipGraph.js  
│ │ ├── scoring.js  
│ │ └── scriptIntelligence.js  
│ └── worker.js  
├── docker-compose.yml  
├── frontend  
│ ├── Dockerfile  
│ ├── index.html  
│ ├── package.json  
│ ├── package-lock.json  
│ ├── src  
│ │ ├── App.jsx  
│ │ ├── components  
│ │ │ ├── CookieAnalysis.jsx  
│ │ │ ├── CrawlMeta.jsx  
│ │ │ ├── DarkPatterns.jsx  
│ │ │ ├── DomainCloud.jsx  
│ │ │ ├── FingerprintReport.jsx  
│ │ │ ├── OwnershipGraph.jsx  
│ │ │ ├── ScoreMeter.jsx  
│ │ │ ├── ScriptIntelligence.jsx  
│ │ │ ├── SignalList.jsx  
│ │ │ └── TrackerList.jsx  
│ │ ├── lib  
│ │ │ └── api.js  
│ │ ├── main.jsx  
│ │ └── styles.css  
│ └── vite.config.js  
├── LICENSE.MD  
├── monitoring  
│ ├── grafana  
│ │ ├── dashboards  
│ │ │ └── grafana_dashboard.json  
│ │ └── provisioning  
│ │ ├── dashboards  
│ │ │ └── dashboard.yml  
│ │ └── datasources  
│ │ └── datasource.yml  
│ └── prometheus.yml  
├── nginx  
│ └── nginx.conf  
└── README.md
```

## Docker Setup (Recommended)

Spin it up with Docker Compose and you’re ready to go. No wrestling with databases, no installing runtimes, no configuration headaches.

### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/TanvirTian/Lunaris
cd Lunaris

# 2. Build and start full stack
docker compose up --build
```

Services will start in dependency order:

* PostgreSQL (with healthcheck)
* Redis
* Backend (runs migrations automatically)
* Worker
* Frontend (Vite dev server)



### Access Points

| Service    | URL                       |
|------------|---------------------------|
| Frontend   | http://localhost:3000     |
| Backend    | http://localhost:8000     |
| Prisma UI  | http://localhost:5555     |
| Prometheus | http://localhost:9090     |
| Grafana    | http://localhost:3001     |
| Metrics    | http://localhost:8000/metrics |

Grafana credentials (local dev only): `admin` / `admin`

Test API health:

```bash
curl http://localhost:8000/health
```


### Development Workflow (Hot Reload Enabled)

This setup is already development-optimized:

* Backend and worker restart automatically on `.js` file changes
* Frontend uses Vite HMR (instant browser updates)
* Source code is bind-mounted into containers
* `node_modules` is container-managed and isolated from host

You only need to rebuild when:

* `package.json` changes
* `Dockerfile` changes
* Native dependencies are added

Rebuild command:

```bash
docker compose up --build
```

---

### Logs & Debugging

```bash
# Show container status
docker compose ps

# Follow logs
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f frontend
docker compose logs -f postgres
```

---

### Stop Containers

```bash
docker compose down
```

Data persists in Docker volumes.


### Reset Database (Full Wipe)

```bash
docker compose down -v
docker compose up --build
```

This deletes:

* `postgres_data`
* `redis_data`

Use this when changing database credentials or schema state.



### Access Containers

```bash
# Backend shell
docker exec -it lunaris-backend-1 sh

# Postgres shell
docker exec -it lunaris-postgres-1 psql -U postgres -d lunaris
```

---

### Data Persistence

Volumes defined:

```yaml
volumes:
  postgres_data:
  redis_data:
```

* Scan jobs and results persist across restarts
* Queue state persists (Redis snapshot)
* Only `down -v` deletes data



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
