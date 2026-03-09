/*
  Warnings:

  - You are about to alter the column `targetUrl` on the `scan_jobs` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(2048)`.

*/
-- AlterTable
ALTER TABLE "scan_jobs" ALTER COLUMN "targetUrl" SET DATA TYPE VARCHAR(2048);
