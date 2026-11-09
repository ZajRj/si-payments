import { Router } from 'express';
import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dates.js';
import { amountCentsSchema } from '../../lib/money.js';
import { idParamSchema, nullableTextSchema, reasonSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  annulPayment,
  approveRequest,
  cancelRequest,
  closeRequest,
  createRequest,
  getRequest,
  listPayments,
  listRequests,
  registerPayments,
  rejectRequest,
  REQUEST_STATUSES,
  submitRequest,
} from './payment-requests.service.js';

const optionalId = z.coerce.number().int().positive().optional();

const listQuerySchema = z.object({ projectId: optionalId, status: z.enum(REQUEST_STATUSES).optional() });

const createSchema = z.object({
  projectId: z.number().int().positive(),
  accrualIds: z.array(z.number().int().positive()).min(1).max(1000).optional(),
  notes: nullableTextSchema(500).optional(),
});

const noteSchema = z.object({ note: nullableTextSchema(500).optional() });
const reasonBodySchema = z.object({ reason: reasonSchema });

const paymentsSchema = z.object({
  paidOn: dateOnlySchema.optional(),
  reference: nullableTextSchema(120).optional(),
  payments: z
    .array(z.object({ personId: z.number().int().positive(), amountCents: amountCentsSchema }))
    .min(1)
    .max(500),
});

export const paymentRequestsRouter = Router();

paymentRequestsRouter.use(authenticate);

paymentRequestsRouter.get('/', requirePermission(PERMISSIONS.PAYROLL_READ), async (req, res) => {
  res.json({ paymentRequests: await listRequests(listQuerySchema.parse(req.query)) });
});

paymentRequestsRouter.get('/:id', requirePermission(PERMISSIONS.PAYROLL_READ), async (req, res) => {
  res.json({ paymentRequest: await getRequest(idParamSchema.parse(req.params.id)) });
});

paymentRequestsRouter.post('/', requirePermission(PERMISSIONS.PAYMENT_REQUESTS_CREATE), async (req, res) => {
  const paymentRequest = await createRequest(req.user!.id, createSchema.parse(req.body));
  res.status(201).json({ paymentRequest });
});

paymentRequestsRouter.post('/:id/submit', requirePermission(PERMISSIONS.PAYMENT_REQUESTS_CREATE), async (req, res) => {
  res.json({ paymentRequest: await submitRequest(req.user!.id, idParamSchema.parse(req.params.id)) });
});

paymentRequestsRouter.post('/:id/cancel', requirePermission(PERMISSIONS.PAYMENT_REQUESTS_CREATE), async (req, res) => {
  res.json({ paymentRequest: await cancelRequest(req.user!.id, idParamSchema.parse(req.params.id)) });
});

paymentRequestsRouter.post('/:id/approve', requirePermission(PERMISSIONS.PAYMENT_REQUESTS_DECIDE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { note } = noteSchema.parse(req.body ?? {});
  res.json({ paymentRequest: await approveRequest(req.user!.id, id, note) });
});

paymentRequestsRouter.post('/:id/reject', requirePermission(PERMISSIONS.PAYMENT_REQUESTS_DECIDE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = reasonBodySchema.parse(req.body);
  res.json({ paymentRequest: await rejectRequest(req.user!.id, id, reason) });
});

paymentRequestsRouter.post('/:id/payments', requirePermission(PERMISSIONS.PAYMENTS_REGISTER), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const paymentRequest = await registerPayments(req.user!.id, id, paymentsSchema.parse(req.body));
  res.status(201).json({ paymentRequest });
});

paymentRequestsRouter.post('/:id/close', requirePermission(PERMISSIONS.PAYMENTS_REGISTER), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { note } = noteSchema.parse(req.body ?? {});
  res.json({ paymentRequest: await closeRequest(req.user!.id, id, note) });
});

const paymentsQuerySchema = z.object({ personId: optionalId, requestId: optionalId, projectId: optionalId });

export const paymentsRouter = Router();

paymentsRouter.use(authenticate);

paymentsRouter.get('/', requirePermission(PERMISSIONS.PAYROLL_READ), async (req, res) => {
  res.json({ payments: await listPayments(paymentsQuerySchema.parse(req.query)) });
});

paymentsRouter.post('/:id/annul', requirePermission(PERMISSIONS.PAYMENTS_REGISTER), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = reasonBodySchema.parse(req.body);
  res.json({ payment: await annulPayment(req.user!.id, id, reason) });
});
