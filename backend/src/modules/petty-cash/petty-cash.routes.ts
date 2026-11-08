import { Router } from 'express';
import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dates.js';
import { amountCentsSchema, MAX_AMOUNT_CENTS } from '../../lib/money.js';
import { idParamSchema, reasonSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  approveVoucher,
  cancelVoucher,
  closePeriod,
  createFund,
  disburseVoucher,
  listFundPeriods,
  listFunds,
  listVouchers,
  openPeriod,
  rejectVoucher,
  requestVoucher,
  settleVoucher,
  updateFund,
  VOUCHER_STATUSES,
} from './petty-cash.service.js';

const createFundSchema = z.object({
  name: z.string().trim().min(1).max(80),
  projectId: z.number().int().positive(),
});

const updateFundSchema = createFundSchema.partial().extend({ active: z.boolean().optional() });

const openPeriodSchema = z.object({
  year: z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  replenishmentCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
});

const optionalId = z.coerce.number().int().positive().optional();
const vouchersQuerySchema = z.object({
  fundId: optionalId,
  periodId: optionalId,
  status: z.enum(VOUCHER_STATUSES).optional(),
});

const requestVoucherSchema = z.object({
  concept: z.string().trim().min(3).max(200),
  beneficiary: z.string().trim().min(1).max(120),
  amountCents: amountCentsSchema,
});

const settleSchema = z.object({
  spentCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
  receiptReference: z.string().trim().min(1).max(120),
  receiptDate: dateOnlySchema,
});

const reasonBodySchema = z.object({ reason: reasonSchema });

export const pettyCashRouter = Router();

pettyCashRouter.use(authenticate);

const manage = requirePermission(PERMISSIONS.PETTY_CASH_MANAGE);
const request = requirePermission(PERMISSIONS.PETTY_CASH_REQUEST);
const read = requirePermission(PERMISSIONS.PETTY_CASH_READ);

pettyCashRouter.get('/funds', read, async (_req, res) => {
  res.json({ funds: await listFunds() });
});

pettyCashRouter.post('/funds', manage, async (req, res) => {
  res.status(201).json({ fund: await createFund(req.user!.id, createFundSchema.parse(req.body)) });
});

pettyCashRouter.patch('/funds/:id', manage, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  res.json({ fund: await updateFund(req.user!.id, id, updateFundSchema.parse(req.body)) });
});

pettyCashRouter.get('/funds/:id/periods', read, async (req, res) => {
  res.json({ periods: await listFundPeriods(idParamSchema.parse(req.params.id)) });
});

pettyCashRouter.post('/funds/:id/periods', manage, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  res.status(201).json({ period: await openPeriod(req.user!.id, id, openPeriodSchema.parse(req.body)) });
});

pettyCashRouter.post('/periods/:id/close', manage, async (req, res) => {
  res.json({ period: await closePeriod(req.user!.id, idParamSchema.parse(req.params.id)) });
});

pettyCashRouter.get('/vouchers', read, async (req, res) => {
  res.json({ vouchers: await listVouchers(vouchersQuerySchema.parse(req.query)) });
});

pettyCashRouter.post('/funds/:id/vouchers', request, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  res.status(201).json({ voucher: await requestVoucher(req.user!.id, id, requestVoucherSchema.parse(req.body)) });
});

pettyCashRouter.post('/vouchers/:id/cancel', request, async (req, res) => {
  res.json({ voucher: await cancelVoucher(req.user!.id, idParamSchema.parse(req.params.id)) });
});

pettyCashRouter.post('/vouchers/:id/settle', request, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  res.json({ voucher: await settleVoucher(req.user!.id, id, settleSchema.parse(req.body)) });
});

pettyCashRouter.post('/vouchers/:id/approve', manage, async (req, res) => {
  res.json({ voucher: await approveVoucher(req.user!.id, idParamSchema.parse(req.params.id)) });
});

pettyCashRouter.post('/vouchers/:id/reject', manage, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = reasonBodySchema.parse(req.body);
  res.json({ voucher: await rejectVoucher(req.user!.id, id, reason) });
});

pettyCashRouter.post('/vouchers/:id/disburse', manage, async (req, res) => {
  res.json({ voucher: await disburseVoucher(req.user!.id, idParamSchema.parse(req.params.id)) });
});
