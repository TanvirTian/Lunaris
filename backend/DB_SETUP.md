# Database Setup Guide

## 1. Install dependencies

```bash
cd backend
npm install @prisma/client prisma
```

## 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set your DATABASE_URL
```

Example DATABASE_URL:
```
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/privacy_analyzer?schema=public"
```

## 3. Create the database (if it doesn't exist)

```bash
psql -U postgres -c "CREATE DATABASE privacy_analyzer;"
```

## 4. Run migrations

```bash
# Create the first migration from your schema
npx prisma migrate dev --name init

# In production (no dev prompts, no schema drift check):
npx prisma migrate deploy
```

## 5. Generate Prisma client

```bash
npx prisma generate
```
(migrate dev runs this automatically, but run it manually after deploy)

## 6. Verify

```bash
npx prisma studio   # Opens GUI at http://localhost:5555
```

---

## Migration workflow going forward

Every time you change schema.prisma:

```bash
# Development — creates migration file + applies it + regenerates client
npx prisma migrate dev --name describe_your_change

# Production — only applies pending migrations (never creates new ones)
npx prisma migrate deploy
```

## Resetting in development

```bash
# DESTRUCTIVE — drops all tables, re-runs all migrations, re-seeds
npx prisma migrate reset
```

---

## Connection pooling in production

For high-traffic deployments, add PgBouncer in front of PostgreSQL
or use Prisma Accelerate (prisma.io/accelerate).

Without a pooler, each Prisma instance holds up to 10 connections.
With MAX_CONCURRENT_SCANS=2, you need at minimum ~15 connections available.

PostgreSQL default max_connections = 100, which is fine for a single server.
For multi-instance deployments, use PgBouncer in transaction mode.

## Checking migration status

```bash
npx prisma migrate status
```
