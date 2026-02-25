/**
 * API client — handles the async job polling pattern.
 *
 * Flow:
 *   1. POST /analyze  → returns { jobId, status: 'PENDING' }
 *   2. Poll GET /scan/:id every POLL_INTERVAL_MS
 *   3. When status = SUCCESS → resolve with result
 *   4. When status = FAILED  → reject with errorMessage
 *   5. onProgress callback fires on each poll with current status
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 60; // 60 × 2.5s = 2.5 minutes max wait

export async function startScan(url, { onProgress } = {}) {
  // Step 1: Create the job
  const initRes = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || 'Failed to start scan');

  // Dedup hit — already have a recent result
  if (initData.cached && initData.status === 'SUCCESS') {
    onProgress?.({ status: 'SUCCESS', cached: true });
    const r = await fetch(`${API_BASE}/scan/${initData.jobId}`);
    return r.json();
  }

  const { jobId } = initData;
  onProgress?.({ status: 'PENDING', jobId });

  // Step 2: Poll until terminal state
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${API_BASE}/scan/${jobId}`);
    const job = await pollRes.json();

    if (!pollRes.ok) throw new Error(job.error || 'Poll failed');

    onProgress?.({ status: job.status, jobId, attempt });

    if (job.status === 'SUCCESS') return job;
    if (job.status === 'FAILED')  throw new Error(job.errorMessage || 'Scan failed');
    // PENDING or RUNNING — keep polling
  }

  throw new Error('Scan timed out after 2.5 minutes. Please try again.');
}
