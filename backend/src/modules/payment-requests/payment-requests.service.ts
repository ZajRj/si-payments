import type { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { businessToday, formatDateOnly } from '../../lib/dates.js';
import { displayUsd } from '../../lib/money.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { toPeriodRefDto } from '../accruals/accruals.service.js';
import { openRequestByAccrual, paidByAccrual } from '../accruals/ledger.js';
import { allocateFifo } from './fifo.js';

export const REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

type Tx = Prisma.TransactionClient;

const userRef = { select: { id: true, name: true } } as const;

const requestInclude = {
  project: { select: { id: true, code: true, name: true } },
  createdBy: userRef,
  decidedBy: userRef,
  closedBy: userRef,
  items: {
    include: {
      accrual: {
        include: {
          person: { select: { id: true, idNumber: true, name: true } },
          period: { select: { id: true, startDate: true, endDate: true, paymentGroup: { select: { id: true, name: true } } } },
        },
      },
    },
  },
  payments: {
    include: {
      person: { select: { id: true, idNumber: true, name: true } },
      createdBy: userRef,
      annulledBy: userRef,
      allocations: { select: { accrualId: true, amountCents: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.PaymentRequestInclude;

type RequestRecord = Prisma.PaymentRequestGetPayload<{ include: typeof requestInclude }>;
type ItemRecord = RequestRecord['items'][number];

// Lo pagado de cada causación dentro de esta solicitud, sin contar pagos anulados.
function paidInRequest(request: RequestRecord): Map<number, number> {
  const paid = new Map<number, number>();
  for (const payment of request.payments) {
    if (payment.annulledAt) continue;
    for (const allocation of payment.allocations) {
      paid.set(allocation.accrualId, (paid.get(allocation.accrualId) ?? 0) + allocation.amountCents);
    }
  }
  return paid;
}

// Orden FIFO: primero la deuda más antigua (período que empieza antes), luego por número de causación.
function fifoOrder(a: ItemRecord, b: ItemRecord) {
  return a.accrual.period.startDate.getTime() - b.accrual.period.startDate.getTime() || a.accrualId - b.accrualId;
}

function summarize(request: RequestRecord) {
  const paid = paidInRequest(request);
  const items = [...request.items].sort(fifoOrder).map((item) => {
    const paidCents = paid.get(item.accrualId) ?? 0;
    return {
      id: item.id,
      accrualId: item.accrualId,
      person: item.accrual.person,
      period: toPeriodRefDto(item.accrual.period),
      activeDays: item.accrual.activeDays,
      periodDays: item.accrual.periodDays,
      accrualAmountCents: item.accrual.amountCents,
      requestedCents: item.requestedCents,
      paidCents,
      outstandingCents: item.requestedCents - paidCents,
    };
  });

  const people = new Map<number, { person: ItemRecord['accrual']['person']; requestedCents: number; paidCents: number; outstandingCents: number }>();
  for (const item of items) {
    const entry = people.get(item.person.id) ?? { person: item.person, requestedCents: 0, paidCents: 0, outstandingCents: 0 };
    entry.requestedCents += item.requestedCents;
    entry.paidCents += item.paidCents;
    entry.outstandingCents += item.outstandingCents;
    people.set(item.person.id, entry);
  }

  const totals = items.reduce(
    (sum, item) => ({
      requestedCents: sum.requestedCents + item.requestedCents,
      paidCents: sum.paidCents + item.paidCents,
      outstandingCents: sum.outstandingCents + item.outstandingCents,
    }),
    { requestedCents: 0, paidCents: 0, outstandingCents: 0 },
  );

  return { items, people: [...people.values()].sort((a, b) => a.person.name.localeCompare(b.person.name, 'es')), totals };
}

function toPaymentDto(payment: RequestRecord['payments'][number]) {
  const { createdById: _c, annulledById: _a, paidOn, ...rest } = payment;
  return { ...rest, paidOn: formatDateOnly(paidOn) };
}

function toRequestSummaryDto(request: RequestRecord) {
  const { items: _items, payments: _payments, createdById: _c, decidedById: _d, closedById: _cl, ...rest } = request;
  const { totals, people } = summarize(request);
  return { ...rest, ...totals, personCount: people.length };
}

function toRequestDetailDto(request: RequestRecord) {
  const summary = summarize(request);
  return {
    ...toRequestSummaryDto(request),
    items: summary.items,
    people: summary.people,
    payments: request.payments.map(toPaymentDto),
  };
}

export async function listRequests({ projectId, status }: { projectId?: number; status?: RequestStatus }) {
  const requests = await prisma.paymentRequest.findMany({
    where: { projectId, status },
    include: requestInclude,
    orderBy: { id: 'desc' },
  });
  return requests.map(toRequestSummaryDto);
}

export async function getRequest(id: number) {
  return toRequestDetailDto(await findRequestOrThrow(prisma, id));
}

async function findRequestOrThrow(client: Tx, id: number) {
  const request = await client.paymentRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) {
    throw new HttpError(404, 'PAYMENT_REQUEST_NOT_FOUND', 'Solicitud de pago no encontrada');
  }
  return request;
}

function assertStatus(request: { status: string }, allowed: RequestStatus[], action: string) {
  if (!allowed.includes(request.status as RequestStatus)) {
    throw new HttpError(409, 'INVALID_REQUEST_STATUS', `No se puede ${action} una solicitud en estado ${request.status}`);
  }
}

// Crea la solicitud con la deuda pendiente del proyecto: todas sus causaciones vigentes con saldo
// que no estén en otra solicitud abierta, o solo las indicadas en `accrualIds`.
export async function createRequest(
  actorId: number,
  { projectId, accrualIds, notes }: { projectId: number; accrualIds?: number[]; notes?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new HttpError(400, 'INVALID_PROJECT', 'El proyecto indicado no existe');
    }

    const candidates = await tx.accrual.findMany({
      where: { projectId, annulledAt: null, id: accrualIds ? { in: accrualIds } : undefined },
      select: { id: true, amountCents: true },
    });
    if (accrualIds && candidates.length !== new Set(accrualIds).size) {
      throw new HttpError(400, 'INVALID_ACCRUALS', 'Alguna causación no existe, está anulada o no es de este proyecto');
    }

    const ids = candidates.map((accrual) => accrual.id);
    const [paid, openRequests] = await Promise.all([paidByAccrual(tx, ids), openRequestByAccrual(tx, ids)]);

    const items: { accrualId: number; requestedCents: number }[] = [];
    for (const accrual of candidates) {
      const pending = accrual.amountCents - (paid.get(accrual.id) ?? 0);
      const heldBy = openRequests.get(accrual.id);
      if (accrualIds && heldBy !== undefined) {
        throw new HttpError(409, 'ACCRUAL_IN_REQUEST', `La causación #${accrual.id} ya está en la solicitud #${heldBy}`);
      }
      if (accrualIds && pending <= 0) {
        throw new HttpError(409, 'ACCRUAL_ALREADY_PAID', `La causación #${accrual.id} ya está pagada`);
      }
      if (heldBy === undefined && pending > 0) {
        items.push({ accrualId: accrual.id, requestedCents: pending });
      }
    }

    if (items.length === 0) {
      throw new HttpError(409, 'NOTHING_TO_REQUEST', 'El proyecto no tiene deuda pendiente fuera de otras solicitudes');
    }

    const created = await tx.paymentRequest.create({
      data: { projectId, notes: notes ?? null, createdById: actorId, items: { create: items } },
    });
    const request = await findRequestOrThrow(tx, created.id);
    await audit(tx, {
      userId: actorId,
      action: 'CREATE',
      entity: 'PaymentRequest',
      entityId: created.id,
      after: { ...created, items },
    });
    return toRequestDetailDto(request);
  });
}

async function transition(
  actorId: number,
  id: number,
  allowed: RequestStatus[],
  action: string,
  data: (request: RequestRecord) => Prisma.PaymentRequestUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const current = await findRequestOrThrow(tx, id);
    assertStatus(current, allowed, action);

    await tx.paymentRequest.update({ where: { id }, data: data(current) });
    const updated = await findRequestOrThrow(tx, id);
    await audit(tx, {
      userId: actorId,
      action: 'UPDATE',
      entity: 'PaymentRequest',
      entityId: id,
      before: toRequestSummaryDto(current),
      after: toRequestSummaryDto(updated),
    });
    return toRequestDetailDto(updated);
  });
}

export function submitRequest(actorId: number, id: number) {
  return transition(actorId, id, ['DRAFT'], 'enviar', () => ({ status: 'SUBMITTED', submittedAt: new Date() }));
}

// El generador puede retirar una solicitud mientras nadie la haya decidido. Sus causaciones quedan libres.
export function cancelRequest(actorId: number, id: number) {
  return transition(actorId, id, ['DRAFT', 'SUBMITTED'], 'cancelar', () => ({
    status: 'CANCELLED',
    cancelledAt: new Date(),
  }));
}

export function approveRequest(actorId: number, id: number, note?: string | null) {
  return transition(actorId, id, ['SUBMITTED'], 'aprobar', () => ({
    status: 'APPROVED',
    decidedBy: { connect: { id: actorId } },
    decidedAt: new Date(),
    decisionNote: note ?? null,
  }));
}

export function rejectRequest(actorId: number, id: number, reason: string) {
  return transition(actorId, id, ['SUBMITTED'], 'rechazar', () => ({
    status: 'REJECTED',
    decidedBy: { connect: { id: actorId } },
    decidedAt: new Date(),
    decisionNote: reason,
  }));
}

// Cerrar con saldo pendiente exige una nota; ese saldo vuelve a la deuda y puede ir en otra solicitud.
export function closeRequest(actorId: number, id: number, note?: string | null) {
  return transition(actorId, id, ['APPROVED'], 'cerrar', (request) => {
    if (summarize(request).totals.outstandingCents > 0 && !note) {
      throw new HttpError(
        400,
        'CLOSING_NOTE_REQUIRED',
        'La solicitud tiene saldo pendiente. Indica el motivo del cierre',
      );
    }
    return { status: 'CLOSED', closedBy: { connect: { id: actorId } }, closedAt: new Date(), closingNote: note ?? null };
  });
}

type PaymentInput = { personId: number; amountCents: number };

// Registra la entrega de fondos. Cada pago es por persona, puede ser parcial y se aplica FIFO
// sobre lo que la persona tiene pendiente en la solicitud, de la causación más antigua a la más nueva.
export async function registerPayments(
  actorId: number,
  id: number,
  { paidOn, reference, payments }: { paidOn?: Date; reference?: string | null; payments: PaymentInput[] },
) {
  const date = paidOn ?? businessToday();
  if (date.getTime() > businessToday().getTime()) {
    throw new HttpError(400, 'FUTURE_PAYMENT_DATE', 'La fecha del pago no puede ser futura');
  }
  if (new Set(payments.map((payment) => payment.personId)).size !== payments.length) {
    throw new HttpError(400, 'DUPLICATE_PERSON', 'Cada persona puede aparecer una sola vez');
  }

  return prisma.$transaction(async (tx) => {
    const request = await findRequestOrThrow(tx, id);
    assertStatus(request, ['APPROVED'], 'registrar pagos en');
    const { items } = summarize(request);

    for (const { personId, amountCents } of payments) {
      const personItems = items.filter((item) => item.person.id === personId && item.outstandingCents > 0);
      if (!request.items.some((item) => item.accrual.personId === personId)) {
        throw new HttpError(400, 'PERSON_NOT_IN_REQUEST', 'La persona no está en esta solicitud');
      }

      const allocations = allocateFifo(
        personItems.map((item) => ({ accrualId: item.accrualId, outstandingCents: item.outstandingCents })),
        amountCents,
      );
      if (!allocations) {
        const outstanding = personItems.reduce((sum, item) => sum + item.outstandingCents, 0);
        throw new HttpError(
          409,
          'AMOUNT_EXCEEDS_DEBT',
          `El monto supera lo pendiente de la persona en esta solicitud (${displayUsd(outstanding)})`,
        );
      }

      const payment = await tx.payment.create({
        data: {
          requestId: id,
          personId,
          amountCents,
          paidOn: date,
          reference: reference ?? null,
          createdById: actorId,
          allocations: { create: allocations },
        },
        include: { allocations: true },
      });
      await audit(tx, {
        userId: actorId,
        action: 'CREATE',
        entity: 'Payment',
        entityId: payment.id,
        after: { ...payment, paidOn: formatDateOnly(payment.paidOn) },
      });
    }

    return toRequestDetailDto(await findRequestOrThrow(tx, id));
  });
}

const paymentInclude = {
  person: { select: { id: true, idNumber: true, name: true } },
  createdBy: userRef,
  annulledBy: userRef,
  allocations: { select: { accrualId: true, amountCents: true } },
  request: { select: { id: true, status: true, project: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.PaymentInclude;

type PaymentRecord = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

function toPaymentListDto(payment: PaymentRecord) {
  const { createdById: _c, annulledById: _a, paidOn, ...rest } = payment;
  return { ...rest, paidOn: formatDateOnly(paidOn) };
}

export async function listPayments({ personId, requestId, projectId }: { personId?: number; requestId?: number; projectId?: number }) {
  const payments = await prisma.payment.findMany({
    where: { personId, requestId, request: projectId ? { projectId } : undefined },
    include: paymentInclude,
    orderBy: [{ paidOn: 'desc' }, { id: 'desc' }],
  });
  return payments.map(toPaymentListDto);
}

// Un pago no se borra ni se edita: se anula con motivo y su monto vuelve a la deuda de la persona.
export async function annulPayment(actorId: number, id: number, reason: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.payment.findUnique({ where: { id }, include: paymentInclude });
    if (!current) {
      throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Pago no encontrado');
    }
    if (current.annulledAt) {
      throw new HttpError(409, 'PAYMENT_ALREADY_ANNULLED', 'El pago ya está anulado');
    }

    const annulled = await tx.payment.update({
      where: { id },
      data: { annulledAt: new Date(), annulledById: actorId, annulmentReason: reason },
      include: paymentInclude,
    });
    const after = toPaymentListDto(annulled);
    await audit(tx, {
      userId: actorId,
      action: 'UPDATE',
      entity: 'Payment',
      entityId: id,
      before: toPaymentListDto(current),
      after,
    });
    return after;
  });
}
