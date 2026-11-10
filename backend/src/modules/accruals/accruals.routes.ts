import { Router } from 'express';
import { z } from 'zod';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { idParamSchema, reasonSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  ACCRUAL_STATUSES,
  annulAccrual,
  annulBatch,
  generateAccruals,
  listAccruals,
  listBatches,
} from './accruals.service.js';

const optionalId = z.coerce.number().int().positive().optional();

const listQuerySchema = paginationQuerySchema().extend({
  projectId: optionalId,
  personId: optionalId,
  periodId: optionalId,
  paymentGroupId: optionalId,
  batchId: optionalId,
  status: z.enum(ACCRUAL_STATUSES).optional(),
});

const batchesQuerySchema = paginationQuerySchema().extend({ projectId: optionalId, periodId: optionalId });

const generateSchema = z.object({
  periodId: z.number().int().positive(),
  projectId: z.number().int().positive().optional(),
});

const annulSchema = z.object({ reason: reasonSchema });

export const accrualsRouter = Router();

accrualsRouter.use(authenticate);

accrualsRouter.get('/', requirePermission(PERMISSIONS.PAYROLL_READ), async (req, res) => {
  const { page, pageSize, ...filters } = listQuerySchema.parse(req.query);
  res.json(await listAccruals(filters, { page, pageSize }));
});

accrualsRouter.get('/batches', requirePermission(PERMISSIONS.PAYROLL_READ), async (req, res) => {
  const { page, pageSize, ...filters } = batchesQuerySchema.parse(req.query);
  res.json(await listBatches(filters, { page, pageSize }));
});

accrualsRouter.post('/generate', requirePermission(PERMISSIONS.ACCRUALS_GENERATE), async (req, res) => {
  const batches = await generateAccruals(req.user!.id, generateSchema.parse(req.body));
  res.status(201).json({ batches });
});

accrualsRouter.post('/batches/:id/annul', requirePermission(PERMISSIONS.ACCRUALS_GENERATE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = annulSchema.parse(req.body);
  res.json({ batch: await annulBatch(req.user!.id, id, reason) });
});

accrualsRouter.post('/:id/annul', requirePermission(PERMISSIONS.ACCRUALS_GENERATE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = annulSchema.parse(req.body);
  res.json({ accrual: await annulAccrual(req.user!.id, id, reason) });
});
