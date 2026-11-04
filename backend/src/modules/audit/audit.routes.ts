import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { addDays, dateOnlySchema, startOfBusinessDay } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

const PAGE_SIZE = 50;

const querySchema = z.object({
  entity: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(60).optional(),
  userId: z.coerce.number().int().positive().optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const auditRouter = Router();

auditRouter.get('/', authenticate, requirePermission(PERMISSIONS.AUDIT_READ), async (req, res) => {
  const { entity, entityId, userId, from, to, page } = querySchema.parse(req.query);
  if (from && to && from.getTime() > to.getTime()) {
    throw new HttpError(400, 'INVALID_RANGE', 'La fecha "desde" no puede ser posterior a la fecha "hasta"');
  }

  const where: Prisma.AuditLogWhereInput = {
    entity,
    entityId,
    userId,
    // Los días se interpretan en la zona del negocio, y `to` incluye todo ese día.
    createdAt: {
      gte: from ? startOfBusinessDay(from) : undefined,
      lt: to ? startOfBusinessDay(addDays(to, 1)) : undefined,
    },
  };

  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  res.json({
    entries: rows.map(({ before, after, ...entry }) => ({
      ...entry,
      before: before === null ? null : JSON.parse(before),
      after: after === null ? null : JSON.parse(after),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
});
