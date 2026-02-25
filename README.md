
# 🌙 Lunaris

**Lunaris** is a privacy-focused website analysis engine that scans any public URL and reveals trackers, cookies, third-party data flows, and dark patterns using a scalable, asynchronous crawler architecture.

Built with production-grade backend patterns, queue-based processing, and containerized infrastructure.


##  What It Does

Lunaris:

* Crawls websites using headless Chromium
* Detects tracking scripts and third-party domains
* Analyzes cookies and external resources
* Identifies dark pattern signals
* Generates a privacy risk score
* Processes scans asynchronously via job queues


# Architecture Overview

Lunaris uses a queue-based processing model for reliability and scalability:

```
Client
  ↓
Fastify API
  ↓
Redis (BullMQ Queue)
  ↓
Worker Process (Playwright)
  ↓
PostgreSQL (Results Storage)
```

### Key Design Decisions

* Asynchronous scan lifecycle (no blocking HTTP requests)
* Redis-backed job queue (BullMQ)
* PostgreSQL for durable scan results
* Playwright with system Chromium (no runtime downloads)
* Containerized multi-service deployment via Docker Compose

# 🧰 Tech Stack

| Layer            | Technology              |
| ---------------- | ----------------------- |
| Backend API      | Node.js + Fastify       |
| ORM              | Prisma                  |
| Database         | PostgreSQL              |
| Queue            | Redis + BullMQ          |
| Crawling Engine  | Playwright (Chromium)   |
| Frontend         | Vite + React            |



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
│   │   └── scanQueue.js
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

# Local Development

### Backend

```bash
cd backend
npm install
npx prisma migrate dev
npm start
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Services started:

* API → `http://localhost:3001`
* PostgreSQL
* Redis
* Worker (background scan processor)


# 🔍 Scoring Model

Privacy score starts at **100** and deductions are applied based on:

* Tracker detections
* Cookie volume
* HTTPS usage
* External script domains
* Dark pattern indicators

Final score is clamped between **0–100**.


##  Performance & Optimization

-   Queue-based async processing (API never blocks)
    
-   Dedicated worker for browser workloads
    
-   Controlled concurrency via Redis + BullMQ
   
-   Headless Chromium with optimized launch settings

-  Structured logging and metrics collection for system observability.
-  Automatic job retry and failure state persistence via queue lifecycle management.
    

# Security Design

* Strict URL validation
* Internal IP/DNS protections
* Headless Chromium isolation
* No execution of arbitrary injected scripts
* Asynchronous job isolation (no direct user-triggered browser execution)



# Why Lunaris?


Lunaris is built to demonstrate production system design around heavy, stateful workloads. The focus is on reliability, isolation, observability, and scalable asynchronous processing rather than raw crawling functionality.


