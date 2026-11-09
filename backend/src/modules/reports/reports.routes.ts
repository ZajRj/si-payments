import { Router, type Response } from 'express';
import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dates.js';
import { idParamSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { paymentRequestPdf, receiptPdf } from './documents.js';
import { balances, GROUP_BY, paymentsReport, personStatement } from './reports.service.js';

const optionalId = z.coerce.number().int().positive().optional();

const filtersSchema = z.object({
  projectId: optionalId,
  personId: optionalId,
  areaId: optionalId,
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

const balancesQuerySchema = filtersSchema.extend({ groupBy: z.enum(GROUP_BY).default('person') });
const statementQuerySchema = filtersSchema.omit({ personId: true });

function sendPdf(res: Response, { pdf, filename }: { pdf: Buffer; filename: string }) {
  res
    .type('application/pdf')
    .set('Content-Disposition', `inline; filename="${filename}"`)
    .set('Cache-Control', 'no-store')
    .send(pdf);
}

export const reportsRouter = Router();

reportsRouter.use(authenticate, requirePermission(PERMISSIONS.REPORTS_READ));

reportsRouter.get('/balances', async (req, res) => {
  const { groupBy, ...filters } = balancesQuerySchema.parse(req.query);
  res.json(await balances(groupBy, filters));
});

reportsRouter.get('/payments', async (req, res) => {
  res.json(await paymentsReport(filtersSchema.parse(req.query)));
});

reportsRouter.get('/people/:id/statement', async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  res.json(await personStatement(id, statementQuerySchema.parse(req.query)));
});

reportsRouter.get('/payments/:id/receipt', async (req, res) => {
  sendPdf(res, await receiptPdf(idParamSchema.parse(req.params.id)));
});

reportsRouter.get('/payment-requests/:id/consolidated', async (req, res) => {
  sendPdf(res, await paymentRequestPdf(idParamSchema.parse(req.params.id)));
});
