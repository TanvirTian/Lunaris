/**
 * Scan Routes
 * -----------------------------------------------------------------------------
 * GET /scan/:id       — poll a single job (status + result if complete)
 * GET /scans          — paginated scan history, filterable by URL / status
 * DELETE /scan/:id    — cancel a pending job or delete a completed one
 * -----------------------------------------------------------------------------
 */

import { db } from '../lib/db.js';

export default async function scanRoutes(fastify) {

  // ── GET /scan/:id ──────────────────────────────────────────────────────────
  // Primary polling endpoint. Clients call this after POST /analyze.
  // Returns job metadata + result if SUCCESS, errorMessage if FAILED.
  fastify.get('/scan/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const job = await db.scanJob.findUnique({
      where: { id },
      include: {
        // Only fetch result columns when job succeeded
        // Prisma doesn't support conditional includes, so we always
        // fetch result and filter in the response shaping below
        result: true,
      },
    });

    if (!job) {
      return reply.status(404).send({ error: 'Scan job not found.' });
    }

    // Shape response based on current status
    const base = {
      jobId:       job.id,
      targetUrl:   job.targetUrl,
      status:      job.status,
      createdAt:   job.createdAt,
      startedAt:   job.startedAt,
      completedAt: job.completedAt,
    };

    if (job.status === 'PENDING' || job.status === 'RUNNING') {
      return reply.send({ ...base, result: null });
    }

    if (job.status === 'FAILED') {
      return reply.send({
        ...base,
        result:       null,
        errorMessage: job.errorMessage,
      });
    }

    // SUCCESS — shape the result for the client
    // rawData contains the full analyzer output; typed fields are also
    // available directly for clients that want them without parsing rawData
    const r = job.result;
    return reply.send({
      ...base,
      result: {
        id:               r.id,
        score:            r.score,
        riskLevel:        r.riskLevel,
        summary:          r.summary,
        trackerCount:     r.trackerCount,
        cookieCount:      r.cookieCount,
        externalDomains:  r.externalDomains,
        isHttps:          r.isHttps,
        pagesCrawled:     r.pagesCrawled,
        hasCsp:           r.hasCsp,
        fingerprinting: {
          canvas:  r.canvasFingerprint,
          webgl:   r.webglFingerprint,
          font:    r.fontFingerprint,
          keylogger: r.keylogger,
        },
        // Full analysis blob — trackers, cookies, signals, ownership graph, etc.
        data:    r.rawData,
        createdAt: r.createdAt,
      },
    });
  });


  // ── GET /scans ─────────────────────────────────────────────────────────────
  // Paginated scan history. Used for:
  //   - Showing a user their past scans
  //   - Tracking score changes for a domain over time
  //   - Admin dashboard / analytics
  //
  // Query params:
  //   url      - filter by exact targetUrl
  //   status   - filter by ScanStatus
  //   page     - page number (1-indexed, default 1)
  //   limit    - results per page (default 20, max 100)
  fastify.get('/scans', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          url:    { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED'] },
          page:   { type: 'integer', minimum: 1, default: 1 },
          limit:  { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { url, status, page = 1, limit = 20 } = request.query;

    const where = {};
    if (url)    where.targetUrl = url;
    if (status) where.status    = status;

    // Run count + page fetch in parallel for efficiency
    const [total, jobs] = await Promise.all([
      db.scanJob.count({ where }),
      db.scanJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * limit,
        take:  limit,
        select: {
          id:          true,
          targetUrl:   true,
          status:      true,
          createdAt:   true,
          completedAt: true,
          errorMessage: true,
          // Include a lightweight result summary (no rawData blob)
          result: {
            select: {
              score:        true,
              riskLevel:    true,
              trackerCount: true,
              isHttps:      true,
            },
          },
        },
      }),
    ]);

    return reply.send({
      data:       jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext:    page * limit < total,
        hasPrev:    page > 1,
      },
    });
  });


  // ── DELETE /scan/:id ───────────────────────────────────────────────────────
  // Soft-cancel a PENDING job (before the crawler picks it up)
  // or permanently delete a completed/failed job and its result.
  fastify.delete('/scan/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const job = await db.scanJob.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!job) {
      return reply.status(404).send({ error: 'Scan job not found.' });
    }

    if (job.status === 'RUNNING') {
      return reply.status(409).send({
        error: 'Cannot delete a running scan. Wait for it to complete or fail.',
      });
    }

    // Cascade delete removes ScanResult automatically (onDelete: Cascade)
    await db.scanJob.delete({ where: { id } });

    return reply.send({ deleted: true, jobId: id });
  });
}
