import { describe, expect, it } from 'vitest';
import { parseDateOnly } from '../src/lib/dates.js';
import { activeDaysInPeriod, computeAccrual, prorate } from '../src/modules/accruals/proration.js';
import { allocateFifo } from '../src/modules/payment-requests/fifo.js';
import { periodBalance } from '../src/modules/petty-cash/petty-cash.service.js';

const d = (value: string) => parseDateOnly(value)!;
const range = (startDate: string, endDate: string) => ({ startDate: d(startDate), endDate: d(endDate) });

describe('días activos', () => {
  it('cuenta ambos extremos de la intersección', () => {
    expect(activeDaysInPeriod(range('2026-01-06', '2026-12-31'), range('2026-01-01', '2026-01-15'))).toBe(10);
    expect(activeDaysInPeriod(range('2026-02-20', '2026-03-05'), range('2026-02-16', '2026-02-28'))).toBe(9);
    expect(activeDaysInPeriod(range('2026-01-15', '2026-01-15'), range('2026-01-01', '2026-01-15'))).toBe(1);
  });

  it('devuelve cero si la asignación no toca el período', () => {
    expect(activeDaysInPeriod(range('2026-01-16', '2026-01-31'), range('2026-01-01', '2026-01-15'))).toBe(0);
    expect(activeDaysInPeriod(range('2025-12-01', '2025-12-31'), range('2026-01-01', '2026-01-15'))).toBe(0);
  });

  it('no depende de cambios de horario: marzo completo son 31 días', () => {
    expect(activeDaysInPeriod(range('2026-01-01', '2026-12-31'), range('2026-03-01', '2026-03-31'))).toBe(31);
  });
});

describe('prorrateo', () => {
  it('causa el monto completo si la asignación cubre todo el período', () => {
    expect(prorate(40_000, 15, 15)).toBe(40_000);
  });

  it('causa en proporción a los días activos', () => {
    expect(prorate(45_000, 10, 15)).toBe(30_000);
    expect(prorate(10_000, 5, 16)).toBe(3_125);
  });

  it('redondea al centavo, con la mitad hacia arriba', () => {
    expect(prorate(100_000, 1, 13)).toBe(7_692); // 7692,307…
    expect(prorate(100_000, 12, 13)).toBe(92_308); // 92307,69…
    expect(prorate(1, 1, 2)).toBe(1); // 0,5
    expect(prorate(3, 1, 2)).toBe(2); // 1,5
  });

  it('usa los días reales del período: la segunda quincena de febrero tiene 13 días', () => {
    const accrual = computeAccrual(39_000, range('2026-02-20', '2026-12-31'), range('2026-02-16', '2026-02-28'));
    expect(accrual).toEqual({ activeDays: 9, periodDays: 13, amountCents: 27_000 });
  });

  it('no causa nada sin días activos', () => {
    expect(prorate(50_000, 0, 15)).toBe(0);
  });
});

describe('aplicación FIFO', () => {
  const debts = [
    { accrualId: 1, outstandingCents: 20_000 },
    { accrualId: 2, outstandingCents: 20_000 },
    { accrualId: 3, outstandingCents: 10_000 },
  ];

  it('cubre primero la deuda más antigua', () => {
    expect(allocateFifo(debts, 25_000)).toEqual([
      { accrualId: 1, amountCents: 20_000 },
      { accrualId: 2, amountCents: 5_000 },
    ]);
  });

  it('salta las deudas ya cubiertas', () => {
    expect(allocateFifo([{ accrualId: 1, outstandingCents: 0 }, ...debts.slice(1)], 30_000)).toEqual([
      { accrualId: 2, amountCents: 20_000 },
      { accrualId: 3, amountCents: 10_000 },
    ]);
  });

  it('rechaza montos que superan la deuda o no son positivos', () => {
    expect(allocateFifo(debts, 50_001)).toBeNull();
    expect(allocateFifo(debts, 0)).toBeNull();
    expect(allocateFifo(debts, 50_000)).toHaveLength(3);
  });
});

describe('saldo de caja chica', () => {
  it('descuenta lo gastado, lo desembolsado y lo reservado', () => {
    const balance = periodBalance({
      openingBalanceCents: 5_000,
      replenishmentCents: 45_000,
      vouchers: [
        { status: 'SETTLED', amountCents: 20_000, spentCents: 15_000 },
        { status: 'DISBURSED', amountCents: 10_000, spentCents: null },
        { status: 'APPROVED', amountCents: 5_000, spentCents: null },
        { status: 'REQUESTED', amountCents: 99_000, spentCents: null },
        { status: 'REJECTED', amountCents: 99_000, spentCents: null },
      ],
    });
    expect(balance).toEqual({
      fundsCents: 50_000,
      spentCents: 15_000,
      disbursedCents: 10_000,
      reservedCents: 5_000,
      cashCents: 25_000,
      availableCents: 20_000,
    });
  });
});
