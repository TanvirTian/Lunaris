-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MODERATE', 'ELEVATED', 'HIGH');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "targetUrl" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_results" (
    "id" UUID NOT NULL,
    "scanJobId" UUID NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "scan_jobs_targetUrl_idx" ON "scan_jobs"("targetUrl");

-- CreateIndex
CREATE INDEX "scan_jobs_status_idx" ON "scan_jobs"("status");

-- CreateIndex
CREATE INDEX "scan_jobs_userId_idx" ON "scan_jobs"("userId");

-- CreateIndex
CREATE INDEX "scan_jobs_createdAt_idx" ON "scan_jobs"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "scan_jobs_targetUrl_createdAt_idx" ON "scan_jobs"("targetUrl", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scan_results_scanJobId_key" ON "scan_results"("scanJobId");

-- CreateIndex
CREATE INDEX "scan_results_score_idx" ON "scan_results"("score");

-- CreateIndex
CREATE INDEX "scan_results_riskLevel_idx" ON "scan_results"("riskLevel");

-- CreateIndex
CREATE INDEX "scan_results_createdAt_idx" ON "scan_results"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "scan_results_canvasFingerprint_idx" ON "scan_results"("canvasFingerprint");

-- CreateIndex
CREATE INDEX "scan_results_keylogger_idx" ON "scan_results"("keylogger");

-- AddForeignKey
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
