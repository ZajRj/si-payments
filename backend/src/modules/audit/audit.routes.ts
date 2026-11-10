import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { addDays, dateOnlySchema, startOfBusinessDay } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';
import { pageArgs, pageResult, paginationQuerySchema } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

const querySchema = paginationQuerySchema().extend({
  entity: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(60).optional(),
  userId: z.coerce.number().int().positive().optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

export const auditRouter = Router();

auditRouter.get('/', authenticate, requirePermission(PERMISSIONS.AUDIT_READ), async (req, res) => {
  const { entity, entityId, userId, from, to, ...pagination } = querySchema.parse(req.query);
  if (from && to && from.getTime() > to.getTime()) {
    throw new HttpError(400, 'INVALID_RANGE', 'La fecha "desde" no puede ser posterior a la fecha "hasta"');
  }

  const where: Prisma.AuditLogWhereInput = {
    entity,
    entityId,
    userId,
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
      ...pageArgs(pagination),
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const entries = rows.map(({ before, after, ...entry }) => ({
    ...entry,
    before: before === null ? null : JSON.parse(before),
    after: after === null ? null : JSON.parse(after),
  }));
  const { items, ...meta } = pageResult(entries, total, pagination);
  res.json({ entries: items, ...meta });
});
