-- CreateTable
CREATE TABLE "domain_scans" (
    "id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "lastJobId" UUID,
    "score" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "summary" TEXT NOT NULL,
    "trackerCount" INTEGER NOT NULL DEFAULT 0,
    "cookieCount" INTEGER NOT NULL DEFAULT 0,
    "externalDomains" INTEGER NOT NULL DEFAULT 0,
    "isHttps" BOOLEAN NOT NULL DEFAULT false,
    "pagesCrawled" INTEGER NOT NULL DEFAULT 1,
    "hasCsp" BOOLEAN NOT NULL DEFAULT false,
    "canvasFingerprint" BOOLEAN NOT NULL DEFAULT false,
    "webglFingerprint" BOOLEAN NOT NULL DEFAULT false,
    "fontFingerprint" BOOLEAN NOT NULL DEFAULT false,
    "keylogger" BOOLEAN NOT NULL DEFAULT false,
    "rawData" JSONB NOT NULL,
    "lastScannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "domain_scans_domain_key" ON "domain_scans"("domain");

-- CreateIndex
CREATE INDEX "domain_scans_lastScannedAt_idx" ON "domain_scans"("lastScannedAt" DESC);

-- CreateIndex
CREATE INDEX "domain_scans_riskLevel_idx" ON "domain_scans"("riskLevel");

-- CreateIndex
CREATE INDEX "domain_scans_score_idx" ON "domain_scans"("score");
