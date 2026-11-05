import { Router } from 'express';
import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dates.js';
import { idParamSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  createPaymentGroup,
  deleteLastPeriod,
  generatePeriods,
  listPaymentGroups,
  listPeriods,
  updatePaymentGroup,
} from './payment-groups.service.js';
import { FREQUENCIES } from './periods.js';

// El rango de cutoffDay depende de la periodicidad y se valida en el servicio.
const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  frequency: z.enum(FREQUENCIES),
  cutoffDay: z.number().int().nullable().optional(),
});

const updateGroupSchema = createGroupSchema.partial().extend({ active: z.boolean().optional() });

const generatePeriodsSchema = z.object({
  from: dateOnlySchema.optional(),
  until: dateOnlySchema,
});

export const paymentGroupsRouter = Router();

paymentGroupsRouter.use(authenticate);

paymentGroupsRouter.get('/', requirePermission(PERMISSIONS.CATALOGS_READ), async (_req, res) => {
  res.json({ paymentGroups: await listPaymentGroups() });
});

paymentGroupsRouter.post('/', requirePermission(PERMISSIONS.CATALOGS_MANAGE), async (req, res) => {
  const paymentGroup = await createPaymentGroup(req.user!.id, createGroupSchema.parse(req.body));
  res.status(201).json({ paymentGroup });
});

paymentGroupsRouter.patch('/:id', requirePermission(PERMISSIONS.CATALOGS_MANAGE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const paymentGroup = await updatePaymentGroup(req.user!.id, id, updateGroupSchema.parse(req.body));
  res.json({ paymentGroup });
});

paymentGroupsRouter.get('/:id/periods', requirePermission(PERMISSIONS.CATALOGS_READ), async (req, res) => {
  res.json({ periods: await listPeriods(idParamSchema.parse(req.params.id)) });
});

paymentGroupsRouter.post('/:id/periods', requirePermission(PERMISSIONS.CATALOGS_MANAGE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const periods = await generatePeriods(req.user!.id, id, generatePeriodsSchema.parse(req.body));
  res.status(201).json({ periods });
});

paymentGroupsRouter.delete('/:id/periods/last', requirePermission(PERMISSIONS.CATALOGS_MANAGE), async (req, res) => {
  const period = await deleteLastPeriod(req.user!.id, idParamSchema.parse(req.params.id));
  res.json({ period });
});
