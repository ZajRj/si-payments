import { Router } from 'express';
import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dates.js';
import { amountCentsSchema } from '../../lib/money.js';
import { idParamSchema, reasonSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  annulAssignment,
  changeAssignmentAmount,
  createAssignment,
  listAssignments,
  updateAssignmentEndDate,
} from './assignments.service.js';

const createAssignmentSchema = z.object({
  personId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  paymentGroupId: z.number().int().positive(),
  amountCents: amountCentsSchema,
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullable().optional(),
});

const updateEndDateSchema = z.object({
  endDate: dateOnlySchema.nullable(),
});

const changeAmountSchema = z.object({
  effectiveDate: dateOnlySchema,
  amountCents: amountCentsSchema,
});

const annulSchema = z.object({ reason: reasonSchema });

const optionalId = z.coerce.number().int().positive().optional();

const listQuerySchema = z.object({
  personId: optionalId,
  projectId: optionalId,
  paymentGroupId: optionalId,
  openOnly: z.stringbool().optional(),
});

export const assignmentsRouter = Router();

assignmentsRouter.use(authenticate);

assignmentsRouter.get('/', requirePermission(PERMISSIONS.PROJECTS_READ), async (req, res) => {
  res.json({ assignments: await listAssignments(listQuerySchema.parse(req.query)) });
});

assignmentsRouter.post('/', requirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE), async (req, res) => {
  const assignment = await createAssignment(req.user!.id, createAssignmentSchema.parse(req.body));
  res.status(201).json({ assignment });
});

assignmentsRouter.patch('/:id', requirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { endDate } = updateEndDateSchema.parse(req.body);
  res.json({ assignment: await updateAssignmentEndDate(req.user!.id, id, endDate) });
});

assignmentsRouter.post('/:id/annul', requirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = annulSchema.parse(req.body);
  res.json({ assignment: await annulAssignment(req.user!.id, id, reason) });
});

assignmentsRouter.post('/:id/amount-change', requirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const result = await changeAssignmentAmount(req.user!.id, id, changeAmountSchema.parse(req.body));
  res.status(201).json(result);
});
