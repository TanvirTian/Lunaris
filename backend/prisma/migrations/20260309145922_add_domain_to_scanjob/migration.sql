-- AlterTable
ALTER TABLE "scan_jobs" ADD COLUMN     "domain" TEXT;

-- CreateIndex
CREATE INDEX "domain_scans_domain_lastScannedAt_idx" ON "domain_scans"("domain", "lastScannedAt" DESC);

-- CreateIndex
CREATE INDEX "scan_jobs_domain_idx" ON "scan_jobs"("domain");

-- CreateIndex
CREATE INDEX "scan_jobs_domain_status_idx" ON "scan_jobs"("domain", "status");

-- CreateIndex
CREATE INDEX "scan_jobs_status_createdAt_idx" ON "scan_jobs"("status", "createdAt" DESC);
