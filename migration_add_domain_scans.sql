-- =============================================================================
-- Migration: Add domain_scans table (state-registry for 24h cache)
-- =============================================================================
-- Run manually with:
--   psql $DATABASE_URL -f migration_add_domain_scans.sql
-- OR via Prisma:
--   npx prisma migrate dev --name add_domain_scans
-- =============================================================================

-- Create the domain_scans table
CREATE TABLE IF NOT EXISTS "domain_scans" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "domain"           TEXT NOT NULL,
  "lastJobId"        UUID,
  "score"            INTEGER NOT NULL,
  "riskLevel"        "RiskLevel" NOT NULL,
  "summary"          TEXT NOT NULL,
  "trackerCount"     INTEGER NOT NULL DEFAULT 0,
  "cookieCount"      INTEGER NOT NULL DEFAULT 0,
  "externalDomains"  INTEGER NOT NULL DEFAULT 0,
  "isHttps"          BOOLEAN NOT NULL DEFAULT false,
  "pagesCrawled"     INTEGER NOT NULL DEFAULT 1,
  "hasCsp"           BOOLEAN NOT NULL DEFAULT false,
  "canvasFingerprint" BOOLEAN NOT NULL DEFAULT false,
  "webglFingerprint" BOOLEAN NOT NULL DEFAULT false,
  "fontFingerprint"  BOOLEAN NOT NULL DEFAULT false,
  "keylogger"        BOOLEAN NOT NULL DEFAULT false,
  "rawData"          JSONB NOT NULL,
  "lastScannedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "domain_scans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "domain_scans_domain_key" UNIQUE ("domain")
);

-- Index for stale-check queries (ORDER BY lastScannedAt DESC)
CREATE INDEX IF NOT EXISTS "domain_scans_lastScannedAt_idx"
  ON "domain_scans"("lastScannedAt" DESC);

-- Index for risk-level filtered dashboards
CREATE INDEX IF NOT EXISTS "domain_scans_riskLevel_idx"
  ON "domain_scans"("riskLevel");

-- Index for score-based leaderboard queries
CREATE INDEX IF NOT EXISTS "domain_scans_score_idx"
  ON "domain_scans"("score");

-- =============================================================================
-- Optional: Backfill existing domains from scan history
--
-- This populates domain_scans from existing ScanResult rows so that
-- users who already scanned sites don't lose their cache on migration.
-- Each domain gets its most recent successful scan result.
-- =============================================================================

INSERT INTO "domain_scans" (
  "domain",
  "lastJobId",
  "score",
  "riskLevel",
  "summary",
  "trackerCount",
  "cookieCount",
  "externalDomains",
  "isHttps",
  "pagesCrawled",
  "hasCsp",
  "canvasFingerprint",
  "webglFingerprint",
  "fontFingerprint",
  "keylogger",
  "rawData",
  "lastScannedAt",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT ON (
  -- Extract hostname from targetUrl; strip www. prefix for canonical form
  regexp_replace(
    regexp_replace(sj."targetUrl", '^https?://', ''),
    '^www\.', ''
  )
)
  regexp_replace(
    regexp_replace(sj."targetUrl", '^https?://', ''),
    '^www\.', ''
  )                     AS "domain",
  sj."id"               AS "lastJobId",
  sr."score",
  sr."riskLevel",
  sr."summary",
  sr."trackerCount",
  sr."cookieCount",
  sr."externalDomains",
  sr."isHttps",
  sr."pagesCrawled",
  sr."hasCsp",
  sr."canvasFingerprint",
  sr."webglFingerprint",
  sr."fontFingerprint",
  sr."keylogger",
  sr."rawData",
  sj."completedAt"      AS "lastScannedAt",
  now()                 AS "createdAt",
  now()                 AS "updatedAt"
FROM "scan_jobs"   sj
JOIN "scan_results" sr ON sr."scanJobId" = sj."id"
WHERE sj."status" = 'SUCCESS'
  AND sj."completedAt" IS NOT NULL
ORDER BY
  regexp_replace(
    regexp_replace(sj."targetUrl", '^https?://', ''),
    '^www\.', ''
  ),
  sj."completedAt" DESC
ON CONFLICT ("domain") DO NOTHING;

-- Verify
SELECT COUNT(*) AS "domains_backfilled" FROM "domain_scans";
