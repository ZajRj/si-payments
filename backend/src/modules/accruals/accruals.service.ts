import type { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { businessToday, displayDate, formatDateOnly } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';
import { pageArgs, pageResult, type PaginationQuery } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { openRequestByAccrual, paidByAccrual } from './ledger.js';
import { activeDaysInPeriod, computeAccrual } from './proration.js';

export const ACCRUAL_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'ANNULLED', 'UNPAID'] as const;
export type AccrualStatusFilter = (typeof ACCRUAL_STATUSES)[number];

type ListFilters = {
  projectId?: number;
  personId?: number;
  periodId?: number;
  paymentGroupId?: number;
  batchId?: number;
  status?: AccrualStatusFilter;
};

const periodSelect = {
  id: true,
  startDate: true,
  endDate: true,
  paymentGroup: { select: { id: true, name: true } },
} satisfies Prisma.PeriodSelect;

export const accrualInclude = {
  person: { select: { id: true, idNumber: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  period: { select: periodSelect },
} satisfies Prisma.AccrualInclude;

type AccrualRecord = Prisma.AccrualGetPayload<{ include: typeof accrualInclude }>;
type PeriodRecord = Prisma.PeriodGetPayload<{ select: typeof periodSelect }>;

export function toPeriodRefDto({ startDate, endDate, ...period }: PeriodRecord) {
  return { ...period, startDate: formatDateOnly(startDate), endDate: formatDateOnly(endDate) };
}

export function accrualStatus(accrual: { amountCents: number; annulledAt: Date | null }, paidCents: number) {
  if (accrual.annulledAt) return 'ANNULLED' as const;
  if (paidCents >= accrual.amountCents) return 'PAID' as const;
  return paidCents > 0 ? ('PARTIAL' as const) : ('PENDING' as const);
}

function toAccrualDto(accrual: AccrualRecord, paidCents: number, openRequestId: number | null) {
  const { period, annulledById: _annulledById, ...rest } = accrual;
  return {
    ...rest,
    period: toPeriodRefDto(period),
    paidCents,
    pendingCents: accrual.annulledAt ? 0 : accrual.amountCents - paidCents,
    status: accrualStatus(accrual, paidCents),
    openRequestId,
  };
}

// El estado y lo pagado salen del libro de pagos, no de una columna: por eso el filtro por estado y los
// totales se calculan sobre todo lo que coincide con los filtros y solo después se corta la página.
export async function listAccruals(
  { projectId, personId, periodId, paymentGroupId, batchId, status }: ListFilters,
  pagination: PaginationQuery,
) {
  const accruals = await prisma.accrual.findMany({
    where: {
      projectId,
      personId,
      periodId,
      batchId,
      period: paymentGroupId ? { paymentGroupId } : undefined,
      annulledAt: status === 'ANNULLED' ? { not: null } : status ? null : undefined,
    },
    include: accrualInclude,
    orderBy: [{ period: { startDate: 'desc' } }, { project: { code: 'asc' } }, { person: { name: 'asc' } }, { id: 'asc' }],
  });

  const ids = accruals.map((accrual) => accrual.id);
  const [paid, openRequests] = await Promise.all([paidByAccrual(prisma, ids), openRequestByAccrual(prisma, ids)]);
  let dtos = accruals.map((accrual) =>
    toAccrualDto(accrual, paid.get(accrual.id) ?? 0, openRequests.get(accrual.id) ?? null),
  );

  if (status === 'UNPAID') dtos = dtos.filter((accrual) => accrual.pendingCents > 0);
  else if (status && status !== 'ANNULLED') dtos = dtos.filter((accrual) => accrual.status === status);

  const totals = dtos.reduce(
    (sum, accrual) => ({
      amountCents: sum.amountCents + (accrual.status === 'ANNULLED' ? 0 : accrual.amountCents),
      paidCents: sum.paidCents + accrual.paidCents,
      pendingCents: sum.pendingCents + accrual.pendingCents,
    }),
    { amountCents: 0, paidCents: 0, pendingCents: 0 },
  );

  const { skip, take } = pageArgs(pagination);
  const { items, ...meta } = pageResult(dtos.slice(skip, skip + take), dtos.length, pagination);
  return { accruals: items, ...meta, totals };
}

const batchInclude = {
  project: { select: { id: true, code: true, name: true } },
  period: { select: periodSelect },
  createdBy: { select: { id: true, name: true } },
  accruals: { select: { id: true, amountCents: true, annulledAt: true } },
} satisfies Prisma.AccrualBatchInclude;

type BatchRecord = Prisma.AccrualBatchGetPayload<{ include: typeof batchInclude }>;

// `paid` trae lo pagado de cada causación. Sin él (al generar o anular un lote) se toma como cero.
function toBatchDto({ accruals, period, createdById: _createdById, ...batch }: BatchRecord, paid = new Map<number, number>()) {
  const active = accruals.filter((accrual) => !accrual.annulledAt);
  const totalCents = active.reduce((sum, accrual) => sum + accrual.amountCents, 0);
  const paidCents = active.reduce((sum, accrual) => sum + (paid.get(accrual.id) ?? 0), 0);
  return {
    ...batch,
    period: toPeriodRefDto(period),
    accrualCount: accruals.length,
    activeCount: active.length,
    totalCents,
    paidCents,
    pendingCents: totalCents - paidCents,
  };
}

type BatchFilters = { projectId?: number; periodId?: number; paymentGroupId?: number; personId?: number };

export async function listBatches({ projectId, periodId, paymentGroupId, personId }: BatchFilters, pagination: PaginationQuery) {
  const where = {
    projectId,
    periodId,
    period: paymentGroupId ? { paymentGroupId } : undefined,
    // Con persona: los lotes donde se le causó algo.
    accruals: personId ? { some: { personId } } : undefined,
  } satisfies Prisma.AccrualBatchWhereInput;
  const [batches, total] = await Promise.all([
    prisma.accrualBatch.findMany({
      where,
      include: batchInclude,
      orderBy: [{ period: { startDate: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(pagination),
    }),
    prisma.accrualBatch.count({ where }),
  ]);
  const paid = await paidByAccrual(
    prisma,
    batches.flatMap((batch) => batch.accruals.map((accrual) => accrual.id)),
  );
  const { items, ...meta } = pageResult(
    batches.map((batch) => toBatchDto(batch, paid)),
    total,
    pagination,
  );
  return { batches: items, ...meta };
}

// Causa por lote las asignaciones del grupo del período que aún no tengan causación vigente en él.
// Crea un lote por proyecto. Si se agrega una asignación retroactiva o se anula una causación,
// volver a generar crea un lote complementario solo con lo que falta.
export async function generateAccruals(actorId: number, { periodId, projectId }: { periodId: number; projectId?: number }) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.period.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new HttpError(404, 'PERIOD_NOT_FOUND', 'Período no encontrado');
    }
    if (period.endDate.getTime() > businessToday().getTime()) {
      throw new HttpError(
        409,
        'PERIOD_NOT_ENDED',
        `El período cierra el ${displayDate(period.endDate)}. Se puede causar a partir de ese día`,
      );
    }
    if (projectId !== undefined && !(await tx.project.findUnique({ where: { id: projectId } }))) {
      throw new HttpError(400, 'INVALID_PROJECT', 'El proyecto indicado no existe');
    }

    const assignments = await tx.assignment.findMany({
      where: {
        // Una asignación anulada no se causa.
        annulledAt: null,
        paymentGroupId: period.paymentGroupId,
        projectId,
        startDate: { lte: period.endDate },
        OR: [{ endDate: { gte: period.startDate } }, { endDate: null, project: { endDate: { gte: period.startDate } } }],
        accruals: { none: { periodId, annulledAt: null } },
      },
      include: { project: { select: { endDate: true } } },
      orderBy: [{ projectId: 'asc' }, { id: 'asc' }],
    });

    const byProject = new Map<number, Prisma.AccrualCreateManyInput[]>();
    for (const assignment of assignments) {
      const effectiveEnd = assignment.endDate ?? assignment.project.endDate;
      const computed = computeAccrual(assignment.amountCents, { startDate: assignment.startDate, endDate: effectiveEnd }, period);
      // Un monto que prorratea a 0 (p. ej. 1 centavo por 1 día de 31) no es deuda: no se causa.
      if (computed.activeDays === 0 || computed.amountCents === 0) continue;

      const rows = byProject.get(assignment.projectId) ?? [];
      rows.push({
        batchId: 0,
        assignmentId: assignment.id,
        personId: assignment.personId,
        projectId: assignment.projectId,
        periodId,
        assignmentAmountCents: assignment.amountCents,
        ...computed,
      });
      byProject.set(assignment.projectId, rows);
    }

    if (byProject.size === 0) {
      throw new HttpError(409, 'NOTHING_TO_ACCRUE', 'No hay asignaciones pendientes por causar en ese período');
    }

    const batchIds: number[] = [];
    for (const [batchProjectId, rows] of byProject) {
      const batch = await tx.accrualBatch.create({ data: { projectId: batchProjectId, periodId, createdById: actorId } });
      const accruals = await tx.accrual.createManyAndReturn({ data: rows.map((row) => ({ ...row, batchId: batch.id })) });
      await audit(tx, {
        userId: actorId,
        action: 'CREATE',
        entity: 'AccrualBatch',
        entityId: batch.id,
        after: { ...batch, accruals },
      });
      batchIds.push(batch.id);
    }

    const batches = await tx.accrualBatch.findMany({
      where: { id: { in: batchIds } },
      include: batchInclude,
      orderBy: { id: 'asc' },
    });
    // Recién generados: todavía no tienen pagos.
    return batches.map((batch) => toBatchDto(batch));
  });
}

// Una causación con pagos vigentes o retenida por una solicitud abierta no se puede anular.
async function assertAnnullable(tx: Prisma.TransactionClient, accrualIds: number[]) {
  const [paid, openRequests] = await Promise.all([paidByAccrual(tx, accrualIds), openRequestByAccrual(tx, accrualIds)]);

  for (const id of accrualIds) {
    if ((paid.get(id) ?? 0) > 0) {
      throw new HttpError(
        409,
        'ACCRUAL_HAS_PAYMENTS',
        `La causación #${id} tiene pagos registrados. Anula esos pagos antes de anularla`,
      );
    }
    const requestId = openRequests.get(id);
    if (requestId !== undefined) {
      throw new HttpError(
        409,
        'ACCRUAL_IN_REQUEST',
        `La causación #${id} está en la solicitud de pago #${requestId}. Cancélala, recházala o ciérrala antes`,
      );
    }
  }
}

export async function annulAccrual(actorId: number, id: number, reason: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.accrual.findUnique({ where: { id }, include: accrualInclude });
    if (!current) {
      throw new HttpError(404, 'ACCRUAL_NOT_FOUND', 'Causación no encontrada');
    }
    if (current.annulledAt) {
      throw new HttpError(409, 'ACCRUAL_ALREADY_ANNULLED', 'La causación ya está anulada');
    }
    await assertAnnullable(tx, [id]);

    const annulled = await tx.accrual.update({
      where: { id },
      data: { annulledAt: new Date(), annulledById: actorId, annulmentReason: reason },
      include: accrualInclude,
    });
    const before = toAccrualDto(current, 0, null);
    const after = toAccrualDto(annulled, 0, null);
    await audit(tx, { userId: actorId, action: 'UPDATE', entity: 'Accrual', entityId: id, before, after });
    return after;
  });
}

// Anula todas las causaciones vigentes del lote. Si alguna no se puede anular, no se anula ninguna.
export async function annulBatch(actorId: number, id: number, reason: string) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.accrualBatch.findUnique({ where: { id } });
    if (!batch) {
      throw new HttpError(404, 'BATCH_NOT_FOUND', 'Lote de causación no encontrado');
    }

    const active = await tx.accrual.findMany({ where: { batchId: id, annulledAt: null }, include: accrualInclude });
    if (active.length === 0) {
      throw new HttpError(409, 'BATCH_ALREADY_ANNULLED', 'El lote no tiene causaciones vigentes');
    }
    await assertAnnullable(
      tx,
      active.map((accrual) => accrual.id),
    );

    const annulledAt = new Date();
    await tx.accrual.updateMany({
      where: { batchId: id, annulledAt: null },
      data: { annulledAt, annulledById: actorId, annulmentReason: reason },
    });
    await audit(
      tx,
      ...active.map((accrual) => ({
        userId: actorId,
        action: 'UPDATE' as const,
        entity: 'Accrual',
        entityId: accrual.id,
        before: toAccrualDto(accrual, 0, null),
        after: { ...toAccrualDto(accrual, 0, null), annulledAt, annulmentReason: reason, status: 'ANNULLED', pendingCents: 0 },
      })),
    );

    const updated = await tx.accrualBatch.findUniqueOrThrow({ where: { id }, include: batchInclude });
    return toBatchDto(updated);
  });
}

// Un cambio en el fin efectivo de una asignación no puede alterar los días de un período ya causado:
// la causación quedaría con un monto distinto al que corresponde. Primero hay que anularla.
export async function assertAccrualsUnaffected(
  tx: Prisma.TransactionClient,
  assignment: { id: number; startDate: Date },
  newEffectiveEnd: Date,
) {
  const accruals = await tx.accrual.findMany({
    where: { assignmentId: assignment.id, annulledAt: null },
    include: { period: true },
    orderBy: { period: { startDate: 'asc' } },
  });

  for (const accrual of accruals) {
    const days = activeDaysInPeriod({ startDate: assignment.startDate, endDate: newEffectiveEnd }, accrual.period);
    if (days !== accrual.activeDays) {
      throw new HttpError(
        409,
        'ASSIGNMENT_HAS_ACCRUALS',
        `El cambio altera días ya causados en el período del ${displayDate(accrual.period.startDate)} al ${displayDate(accrual.period.endDate)}. Anula esa causación antes de cambiar la asignación`,
      );
    }
  }
}
