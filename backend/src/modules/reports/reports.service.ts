import type { Prisma } from '../../generated/prisma/client.js';
import { formatDateOnly } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { accrualInclude, accrualStatus, toPeriodRefDto } from '../accruals/accruals.service.js';
import { paidByAccrual } from '../accruals/ledger.js';

// Los reportes solo leen: responden cuánto se ha causado, cuánto se ha pagado, cuándo, a quién,
// por qué proyecto y cuánto se le adeuda a cada persona.

export const GROUP_BY = ['person', 'project'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export type ReportFilters = {
  projectId?: number;
  personId?: number;
  areaId?: number;
  // Rango de fechas, ambos extremos inclusivos. Las causaciones se ubican por la fecha de fin
  // de su período (cuándo se causaron) y los pagos por la fecha de entrega.
  from?: Date;
  to?: Date;
};

function dateRange({ from, to }: ReportFilters) {
  if (from && to && from.getTime() > to.getTime()) {
    throw new HttpError(400, 'INVALID_RANGE', 'La fecha desde no puede ser posterior a la fecha hasta');
  }
  return from || to ? { gte: from, lte: to } : undefined;
}

function accrualWhere(filters: ReportFilters): Prisma.AccrualWhereInput {
  const endDate = dateRange(filters);
  return {
    annulledAt: null,
    projectId: filters.projectId,
    personId: filters.personId,
    project: filters.areaId ? { areaId: filters.areaId } : undefined,
    period: endDate ? { endDate } : undefined,
  };
}

function paymentWhere(filters: ReportFilters): Prisma.PaymentWhereInput {
  return {
    personId: filters.personId,
    paidOn: dateRange(filters),
    request: filters.projectId || filters.areaId
      ? { projectId: filters.projectId, project: filters.areaId ? { areaId: filters.areaId } : undefined }
      : undefined,
  };
}

type Totals = { accruedCents: number; paidCents: number; owedCents: number; accrualCount: number };

const emptyTotals = (): Totals => ({ accruedCents: 0, paidCents: 0, owedCents: 0, accrualCount: 0 });

function add(totals: Totals, accruedCents: number, paidCents: number) {
  totals.accruedCents += accruedCents;
  totals.paidCents += paidCents;
  totals.owedCents += accruedCents - paidCents;
  totals.accrualCount += 1;
}

// Causado, pagado y adeudado, agrupado por persona o por proyecto. Lo pagado es lo aplicado a esas
// causaciones por pagos vigentes, sin importar la fecha del pago; lo adeudado es la diferencia.
export async function balances(groupBy: GroupBy, filters: ReportFilters) {
  const accruals = await prisma.accrual.findMany({
    where: accrualWhere(filters),
    select: {
      id: true,
      amountCents: true,
      person: { select: { id: true, idNumber: true, name: true } },
      project: { select: { id: true, code: true, name: true, area: { select: { id: true, name: true } } } },
    },
  });
  const paid = await paidByAccrual(prisma, accruals.map((accrual) => accrual.id));

  const rows = new Map<number, Totals & { person?: (typeof accruals)[number]['person']; project?: (typeof accruals)[number]['project'] }>();
  const totals = emptyTotals();
  for (const accrual of accruals) {
    const key = groupBy === 'person' ? accrual.person.id : accrual.project.id;
    const row = rows.get(key) ?? {
      ...emptyTotals(),
      ...(groupBy === 'person' ? { person: accrual.person } : { project: accrual.project }),
    };
    const paidCents = paid.get(accrual.id) ?? 0;
    add(row, accrual.amountCents, paidCents);
    add(totals, accrual.amountCents, paidCents);
    rows.set(key, row);
  }

  const sorted = [...rows.values()].sort((a, b) =>
    groupBy === 'person' ? a.person!.name.localeCompare(b.person!.name, 'es') : a.project!.code.localeCompare(b.project!.code, 'es'),
  );
  return { groupBy, rows: sorted, totals };
}

const paymentReportInclude = {
  person: { select: { id: true, idNumber: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  annulledBy: { select: { id: true, name: true } },
  request: { select: { id: true, project: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.PaymentInclude;

type PaymentReportRecord = Prisma.PaymentGetPayload<{ include: typeof paymentReportInclude }>;

function toPaymentReportDto({ request, createdById: _c, annulledById: _a, paidOn, ...payment }: PaymentReportRecord) {
  return { ...payment, paidOn: formatDateOnly(paidOn), project: request.project };
}

// Pagos entregados en el rango: cuándo, a quién y por qué proyecto. Los anulados se listan,
// pero no suman en el total.
export async function paymentsReport(filters: ReportFilters) {
  const payments = await prisma.payment.findMany({
    where: paymentWhere(filters),
    include: paymentReportInclude,
    orderBy: [{ paidOn: 'asc' }, { id: 'asc' }],
  });
  const valid = payments.filter((payment) => !payment.annulledAt);
  return {
    payments: payments.map(toPaymentReportDto),
    totals: {
      paymentCount: valid.length,
      amountCents: valid.reduce((sum, payment) => sum + payment.amountCents, 0),
      annulledCount: payments.length - valid.length,
    },
  };
}

// Estado de cuenta de una persona: cada causación con lo pagado y lo adeudado, y sus pagos.
export async function personStatement(personId: number, filters: Omit<ReportFilters, 'personId'>) {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, idNumber: true, name: true, active: true } });
  if (!person) {
    throw new HttpError(404, 'PERSON_NOT_FOUND', 'Persona no encontrada');
  }

  const scoped = { ...filters, personId };
  const accruals = await prisma.accrual.findMany({
    where: accrualWhere(scoped),
    include: accrualInclude,
    orderBy: [{ period: { startDate: 'asc' } }, { id: 'asc' }],
  });
  const paid = await paidByAccrual(prisma, accruals.map((accrual) => accrual.id));

  const totals = emptyTotals();
  const accrualRows = accruals.map((accrual) => {
    const paidCents = paid.get(accrual.id) ?? 0;
    add(totals, accrual.amountCents, paidCents);
    return {
      id: accrual.id,
      project: accrual.project,
      period: toPeriodRefDto(accrual.period),
      activeDays: accrual.activeDays,
      periodDays: accrual.periodDays,
      amountCents: accrual.amountCents,
      paidCents,
      owedCents: accrual.amountCents - paidCents,
      status: accrualStatus(accrual, paidCents),
    };
  });

  const { payments } = await paymentsReport(scoped);
  return { person, accruals: accrualRows, payments, totals };
}
