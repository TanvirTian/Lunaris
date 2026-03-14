-- DropIndex
DROP INDEX "scan_jobs_targetUrl_idx";

-- DropIndex
DROP INDEX "scan_results_canvasFingerprint_idx";

-- DropIndex
DROP INDEX "scan_results_keylogger_idx";

-- CreateIndex
CREATE INDEX "scan_jobs_completedAt_status_idx" ON "scan_jobs"("completedAt", "status");
