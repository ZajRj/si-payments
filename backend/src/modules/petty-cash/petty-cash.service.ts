import type { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { businessToday, formatDateOnly } from '../../lib/dates.js';
import { displayUsd } from '../../lib/money.js';
import { HttpError } from '../../lib/http-error.js';
import { sameName } from '../../lib/names.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';

export const VOUCHER_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'DISBURSED', 'SETTLED'] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

// Vales que todavía no terminan su ciclo. Un mes no se cierra mientras tenga alguno.
const PENDING_VOUCHER_STATUSES: VoucherStatus[] = ['REQUESTED', 'APPROVED', 'DISBURSED'];

type Tx = Prisma.TransactionClient;

const userRef = { select: { id: true, name: true } } as const;
const projectRef = { select: { id: true, code: true, name: true, active: true } } as const;

// ---------------------------------------------------------------------------
// Saldos
// ---------------------------------------------------------------------------

type BalanceVoucher = { status: string; amountCents: number; spentCents: number | null };
type BalancePeriod = { openingBalanceCents: number; replenishmentCents: number; vouchers: BalanceVoucher[] };

// - fundsCents: saldo inicial (arrastre) más la reposición del mes.
// - spentCents: lo gastado según los comprobantes de los vales rendidos.
// - disbursedCents: entregado y aún sin rendir.
// - reservedCents: vales aprobados que todavía no se desembolsan.
// - cashCents: efectivo que debería haber en la caja.
// - availableCents: lo que queda para aprobar vales nuevos.
export function periodBalance({ openingBalanceCents, replenishmentCents, vouchers }: BalancePeriod) {
  const sum = (status: VoucherStatus, pick: (voucher: BalanceVoucher) => number) =>
    vouchers.filter((voucher) => voucher.status === status).reduce((total, voucher) => total + pick(voucher), 0);

  const fundsCents = openingBalanceCents + replenishmentCents;
  const spentCents = sum('SETTLED', (voucher) => voucher.spentCents ?? 0);
  const disbursedCents = sum('DISBURSED', (voucher) => voucher.amountCents);
  const reservedCents = sum('APPROVED', (voucher) => voucher.amountCents);
  const cashCents = fundsCents - spentCents - disbursedCents;
  return { fundsCents, spentCents, disbursedCents, reservedCents, cashCents, availableCents: cashCents - reservedCents };
}

const periodInclude = {
  openedBy: userRef,
  closedBy: userRef,
  vouchers: { select: { status: true, amountCents: true, spentCents: true } },
} satisfies Prisma.PettyCashPeriodInclude;

type PeriodRecord = Prisma.PettyCashPeriodGetPayload<{ include: typeof periodInclude }>;

function toPeriodDto({ vouchers, openedById: _o, closedById: _c, ...period }: PeriodRecord) {
  return {
    ...period,
    ...periodBalance({ ...period, vouchers }),
    voucherCount: vouchers.length,
    pendingVoucherCount: vouchers.filter((voucher) => PENDING_VOUCHER_STATUSES.includes(voucher.status as VoucherStatus))
      .length,
  };
}

// ---------------------------------------------------------------------------
// Cajas
// ---------------------------------------------------------------------------

const fundInclude = {
  project: projectRef,
  periods: { where: { status: 'OPEN' }, include: periodInclude },
} satisfies Prisma.PettyCashFundInclude;

type FundRecord = Prisma.PettyCashFundGetPayload<{ include: typeof fundInclude }>;

function toFundDto({ periods, ...fund }: FundRecord) {
  return { ...fund, openPeriod: periods[0] ? toPeriodDto(periods[0]) : null };
}

export async function listFunds() {
  const funds = await prisma.pettyCashFund.findMany({ include: fundInclude, orderBy: { name: 'asc' } });
  return funds.map(toFundDto);
}

async function findFundOrThrow(client: Tx, id: number) {
  const fund = await client.pettyCashFund.findUnique({ where: { id }, include: fundInclude });
  if (!fund) {
    throw new HttpError(404, 'PETTY_CASH_FUND_NOT_FOUND', 'Caja chica no encontrada');
  }
  return fund;
}

async function assertProjectUsable(tx: Tx, projectId: number) {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new HttpError(400, 'INVALID_PROJECT', 'El proyecto indicado no existe');
  }
  if (!project.active) {
    throw new HttpError(409, 'PROJECT_INACTIVE', 'El proyecto está inactivo');
  }
}

async function assertNameAvailable(tx: Tx, name: string, excludeId?: number) {
  const funds = await tx.pettyCashFund.findMany({ select: { id: true, name: true } });
  if (funds.some((fund) => fund.id !== excludeId && sameName(fund.name, name))) {
    throw nameTaken();
  }
}

function nameTaken() {
  return new HttpError(409, 'PETTY_CASH_FUND_NAME_TAKEN', 'Ya existe una caja chica con ese nombre');
}

export async function createFund(actorId: number, { name, projectId }: { name: string; projectId: number }) {
  try {
    return await prisma.$transaction(async (tx) => {
      await assertNameAvailable(tx, name);
      await assertProjectUsable(tx, projectId);
      const created = await tx.pettyCashFund.create({ data: { name, projectId } });
      const fund = toFundDto(await findFundOrThrow(tx, created.id));
      await audit(tx, { userId: actorId, action: 'CREATE', entity: 'PettyCashFund', entityId: fund.id, after: created });
      return fund;
    });
  } catch (error) {
    throw isUniqueViolation(error) ? nameTaken() : error;
  }
}

// La caja se puede reasignar a otro proyecto desde la interfaz. Solo se desactiva sin un mes abierto.
export async function updateFund(
  actorId: number,
  id: number,
  data: { name?: string; projectId?: number; active?: boolean },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await findFundOrThrow(tx, id);
      if (data.name !== undefined) await assertNameAvailable(tx, data.name, id);
      if (data.projectId !== undefined && data.projectId !== current.projectId) {
        await assertProjectUsable(tx, data.projectId);
      }
      if (current.active && data.active === false && current.periods.length > 0) {
        throw new HttpError(409, 'PETTY_CASH_FUND_HAS_OPEN_PERIOD', 'La caja tiene un mes abierto. Ciérralo antes de desactivarla');
      }

      const { periods: _p, ...before } = current;
      const updated = await tx.pettyCashFund.update({ where: { id }, data });
      await audit(tx, { userId: actorId, action: 'UPDATE', entity: 'PettyCashFund', entityId: id, before, after: updated });
      return toFundDto(await findFundOrThrow(tx, id));
    });
  } catch (error) {
    throw isUniqueViolation(error) ? nameTaken() : error;
  }
}

// ---------------------------------------------------------------------------
// Meses (apertura, cierre y arrastre de saldo)
// ---------------------------------------------------------------------------

export async function listFundPeriods(fundId: number) {
  await findFundOrThrow(prisma, fundId);
  const periods = await prisma.pettyCashPeriod.findMany({
    where: { fundId },
    include: periodInclude,
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
  return periods.map(toPeriodDto);
}

function monthIndex(year: number, month: number) {
  return year * 12 + (month - 1);
}

function monthLabel(year: number, month: number) {
  return `${String(month).padStart(2, '0')}/${year}`;
}

// Abre el mes siguiente al último cerrado, con su saldo final como saldo inicial (arrastre).
// El primer mes de una caja empieza en cero y necesita una reposición.
export async function openPeriod(
  actorId: number,
  fundId: number,
  { year, month, replenishmentCents }: { year?: number; month?: number; replenishmentCents: number },
) {
  return prisma.$transaction(async (tx) => {
    const fund = await findFundOrThrow(tx, fundId);
    if (!fund.active) {
      throw new HttpError(409, 'PETTY_CASH_FUND_INACTIVE', 'La caja chica está inactiva');
    }
    if (fund.periods.length > 0) {
      const open = fund.periods[0]!;
      throw new HttpError(409, 'PERIOD_ALREADY_OPEN', `La caja ya tiene abierto el mes ${monthLabel(open.year, open.month)}`);
    }

    const last = await tx.pettyCashPeriod.findFirst({ where: { fundId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    let target: { year: number; month: number };
    if (last) {
      const next = monthIndex(last.year, last.month) + 1;
      target = { year: Math.floor(next / 12), month: (next % 12) + 1 };
      if ((year !== undefined && year !== target.year) || (month !== undefined && month !== target.month)) {
        throw new HttpError(
          409,
          'NON_CONSECUTIVE_MONTH',
          `Los meses son consecutivos: el siguiente mes de esta caja es ${monthLabel(target.year, target.month)}`,
        );
      }
    } else {
      if (year === undefined || month === undefined) {
        throw new HttpError(400, 'MONTH_REQUIRED', 'Indica el año y el mes de la primera apertura');
      }
      if (replenishmentCents <= 0) {
        throw new HttpError(400, 'INITIAL_FUNDS_REQUIRED', 'La primera apertura necesita un monto inicial mayor que cero');
      }
      target = { year, month };
    }

    const today = businessToday();
    if (monthIndex(target.year, target.month) > monthIndex(today.getUTCFullYear(), today.getUTCMonth() + 1)) {
      throw new HttpError(409, 'FUTURE_MONTH', `El mes ${monthLabel(target.year, target.month)} todavía no empieza`);
    }

    const created = await tx.pettyCashPeriod.create({
      data: {
        fundId,
        ...target,
        openingBalanceCents: last?.closingBalanceCents ?? 0,
        replenishmentCents,
        openedById: actorId,
      },
      include: periodInclude,
    });
    const period = toPeriodDto(created);
    await audit(tx, { userId: actorId, action: 'CREATE', entity: 'PettyCashPeriod', entityId: period.id, after: period });
    return period;
  });
}

// Cierra el mes cuando todos sus vales terminaron su ciclo. El saldo final pasa al mes siguiente.
export async function closePeriod(actorId: number, periodId: number) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.pettyCashPeriod.findUnique({ where: { id: periodId }, include: periodInclude });
    if (!current) {
      throw new HttpError(404, 'PETTY_CASH_PERIOD_NOT_FOUND', 'Mes de caja chica no encontrado');
    }
    if (current.status !== 'OPEN') {
      throw new HttpError(409, 'PERIOD_ALREADY_CLOSED', 'El mes ya está cerrado');
    }
    const before = toPeriodDto(current);
    if (before.pendingVoucherCount > 0) {
      throw new HttpError(
        409,
        'PENDING_VOUCHERS',
        'El mes tiene vales sin terminar. Deben quedar rendidos, rechazados o cancelados antes del cierre',
      );
    }

    const closed = await tx.pettyCashPeriod.update({
      where: { id: periodId },
      data: { status: 'CLOSED', closingBalanceCents: before.cashCents, closedById: actorId, closedAt: new Date() },
      include: periodInclude,
    });
    const after = toPeriodDto(closed);
    await audit(tx, { userId: actorId, action: 'UPDATE', entity: 'PettyCashPeriod', entityId: periodId, before, after });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Vales
// ---------------------------------------------------------------------------

const voucherInclude = {
  fund: { select: { id: true, name: true, project: projectRef } },
  period: { select: { id: true, year: true, month: true, status: true } },
  requestedBy: userRef,
  decidedBy: userRef,
  disbursedBy: userRef,
  settledBy: userRef,
} satisfies Prisma.PettyCashVoucherInclude;

type VoucherRecord = Prisma.PettyCashVoucherGetPayload<{ include: typeof voucherInclude }>;

function toVoucherDto(voucher: VoucherRecord) {
  const {
    requestedById: _r,
    decidedById: _d,
    disbursedById: _db,
    settledById: _s,
    receiptDate,
    ...rest
  } = voucher;
  return {
    ...rest,
    receiptDate: receiptDate ? formatDateOnly(receiptDate) : null,
    returnedCents: voucher.status === 'SETTLED' ? voucher.amountCents - (voucher.spentCents ?? 0) : null,
  };
}

export async function listVouchers({ fundId, periodId, status }: { fundId?: number; periodId?: number; status?: VoucherStatus }) {
  const vouchers = await prisma.pettyCashVoucher.findMany({
    where: { fundId, periodId, status },
    include: voucherInclude,
    orderBy: { id: 'desc' },
  });
  return vouchers.map(toVoucherDto);
}

async function openPeriodBalance(tx: Tx, periodId: number) {
  const period = await tx.pettyCashPeriod.findUniqueOrThrow({ where: { id: periodId }, include: periodInclude });
  return periodBalance(period);
}

function insufficientFunds(availableCents: number) {
  return new HttpError(
    409,
    'INSUFFICIENT_FUNDS',
    `La caja no tiene saldo suficiente. Disponible: ${displayUsd(availableCents)}`,
  );
}

export async function requestVoucher(
  actorId: number,
  fundId: number,
  data: { concept: string; beneficiary: string; amountCents: number },
) {
  return prisma.$transaction(async (tx) => {
    const fund = await findFundOrThrow(tx, fundId);
    if (!fund.active) {
      throw new HttpError(409, 'PETTY_CASH_FUND_INACTIVE', 'La caja chica está inactiva');
    }
    const period = fund.periods[0];
    if (!period) {
      throw new HttpError(409, 'NO_OPEN_PERIOD', 'La caja no tiene un mes abierto');
    }
    const { availableCents } = periodBalance(period);
    if (data.amountCents > availableCents) {
      throw insufficientFunds(availableCents);
    }

    const created = await tx.pettyCashVoucher.create({
      data: { ...data, fundId, periodId: period.id, requestedById: actorId },
      include: voucherInclude,
    });
    const voucher = toVoucherDto(created);
    await audit(tx, { userId: actorId, action: 'CREATE', entity: 'PettyCashVoucher', entityId: voucher.id, after: voucher });
    return voucher;
  });
}

async function voucherTransition(
  actorId: number,
  id: number,
  from: VoucherStatus,
  action: string,
  build: (voucher: VoucherRecord, tx: Tx) => Promise<Prisma.PettyCashVoucherUncheckedUpdateInput>,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.pettyCashVoucher.findUnique({ where: { id }, include: voucherInclude });
    if (!current) {
      throw new HttpError(404, 'VOUCHER_NOT_FOUND', 'Vale no encontrado');
    }
    if (current.status !== from) {
      throw new HttpError(409, 'INVALID_VOUCHER_STATUS', `No se puede ${action} un vale en estado ${current.status}`);
    }

    const data = await build(current, tx);
    const updated = await tx.pettyCashVoucher.update({ where: { id }, data, include: voucherInclude });
    const after = toVoucherDto(updated);
    await audit(tx, {
      userId: actorId,
      action: 'UPDATE',
      entity: 'PettyCashVoucher',
      entityId: id,
      before: toVoucherDto(current),
      after,
    });
    return after;
  });
}

// Solo quien pidió el vale puede cancelarlo o rendirlo: otro solicitante no actúa sobre vales ajenos.
function assertRequester(voucher: VoucherRecord, actorId: number) {
  if (voucher.requestedById !== actorId) {
    throw new HttpError(403, 'NOT_VOUCHER_REQUESTER', 'Solo quien solicitó el vale puede hacer esta acción');
  }
}

export function cancelVoucher(actorId: number, id: number) {
  return voucherTransition(actorId, id, 'REQUESTED', 'cancelar', async (voucher) => {
    assertRequester(voucher, actorId);
    return { status: 'CANCELLED', cancelledAt: new Date() };
  });
}

// Aprobar reserva el monto: el saldo disponible debe cubrirlo.
export function approveVoucher(actorId: number, id: number) {
  return voucherTransition(actorId, id, 'REQUESTED', 'aprobar', async (voucher, tx) => {
    const { availableCents } = await openPeriodBalance(tx, voucher.periodId);
    if (voucher.amountCents > availableCents) {
      throw insufficientFunds(availableCents);
    }
    return { status: 'APPROVED', decidedById: actorId, decidedAt: new Date() };
  });
}

export function rejectVoucher(actorId: number, id: number, reason: string) {
  return voucherTransition(actorId, id, 'REQUESTED', 'rechazar', async () => ({
    status: 'REJECTED',
    decidedById: actorId,
    decidedAt: new Date(),
    rejectionReason: reason,
  }));
}

export function disburseVoucher(actorId: number, id: number) {
  return voucherTransition(actorId, id, 'APPROVED', 'desembolsar', async () => ({
    status: 'DISBURSED',
    disbursedById: actorId,
    disbursedAt: new Date(),
  }));
}

// Rendición: lo gastado según el comprobante, como máximo lo desembolsado. El resto vuelve a la caja.
export function settleVoucher(
  actorId: number,
  id: number,
  { spentCents, receiptReference, receiptDate }: { spentCents: number; receiptReference: string; receiptDate: Date },
) {
  return voucherTransition(actorId, id, 'DISBURSED', 'rendir', async (voucher) => {
    assertRequester(voucher, actorId);
    if (spentCents > voucher.amountCents) {
      throw new HttpError(400, 'SPENT_EXCEEDS_DISBURSED', 'Lo gastado no puede superar lo desembolsado');
    }
    if (receiptDate.getTime() > businessToday().getTime()) {
      throw new HttpError(400, 'FUTURE_RECEIPT_DATE', 'La fecha del comprobante no puede ser futura');
    }
    return { status: 'SETTLED', spentCents, receiptReference, receiptDate, settledById: actorId, settledAt: new Date() };
  });
}
