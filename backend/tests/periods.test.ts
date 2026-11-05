import { describe, expect, it } from 'vitest';
import { formatDateOnly, parseDateOnly, startOfBusinessDay } from '../src/lib/dates.js';
import { buildPeriods, normalizeRule, periodDays, type PeriodRule } from '../src/modules/payment-groups/periods.js';

const date = (value: string) => parseDateOnly(value)!;

function periods(rule: PeriodRule, from: string, until: string) {
  return buildPeriods(rule, date(from), date(until)).map(
    ({ startDate, endDate }) => `${formatDateOnly(startDate)}..${formatDateOnly(endDate)}`,
  );
}

describe('fechas', () => {
  it('rechaza fechas imposibles o mal formadas', () => {
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(parseDateOnly('2026-2-3')).toBeNull();
    expect(parseDateOnly('2028-02-29')).not.toBeNull();
  });

  it('el día de negocio empieza a medianoche de Caracas (UTC-4)', () => {
    expect(startOfBusinessDay(date('2026-11-03')).toISOString()).toBe('2026-11-03T04:00:00.000Z');
  });
});

describe('reglas de corte', () => {
  it('aplica los cortes por defecto y valida los rangos', () => {
    expect(normalizeRule('BIWEEKLY', null)).toEqual({ frequency: 'BIWEEKLY', cutoffDay: 15 });
    expect(normalizeRule('MONTHLY', undefined)).toEqual({ frequency: 'MONTHLY', cutoffDay: null });
    expect(() => normalizeRule('WEEKLY', null)).toThrow();
    expect(() => normalizeRule('WEEKLY', 7)).toThrow();
    expect(() => normalizeRule('BIWEEKLY', 28)).toThrow();
    expect(() => normalizeRule('MONTHLY', 29)).toThrow();
  });
});

describe('generación de períodos', () => {
  it('semanal: el primer período se acorta hasta el día de cierre', () => {
    // 2026-01-01 es jueves; el cierre es el viernes.
    expect(periods({ frequency: 'WEEKLY', cutoffDay: 5 }, '2026-01-01', '2026-01-16')).toEqual([
      '2026-01-01..2026-01-02',
      '2026-01-03..2026-01-09',
      '2026-01-10..2026-01-16',
    ]);
  });

  it('quincenal: la segunda quincena cierra a fin de mes', () => {
    expect(periods({ frequency: 'BIWEEKLY', cutoffDay: 15 }, '2026-01-01', '2026-02-28')).toEqual([
      '2026-01-01..2026-01-15',
      '2026-01-16..2026-01-31',
      '2026-02-01..2026-02-15',
      '2026-02-16..2026-02-28',
    ]);
  });

  it('quincenal: genera hasta cubrir la fecha final aunque empiece a mitad de quincena', () => {
    expect(periods({ frequency: 'BIWEEKLY', cutoffDay: 15 }, '2026-01-10', '2026-01-20')).toEqual([
      '2026-01-10..2026-01-15',
      '2026-01-16..2026-01-31',
    ]);
  });

  it('mensual a fin de mes respeta los años bisiestos', () => {
    const result = buildPeriods({ frequency: 'MONTHLY', cutoffDay: null }, date('2028-01-01'), date('2028-03-01'));

    expect(result.map(periodDays)).toEqual([31, 29, 31]);
  });

  it('mensual con día de corte cruza el cambio de año', () => {
    expect(periods({ frequency: 'MONTHLY', cutoffDay: 25 }, '2026-11-26', '2027-01-10')).toEqual([
      '2026-11-26..2026-12-25',
      '2026-12-26..2027-01-25',
    ]);
  });

  it('limita la cantidad de períodos por generación', () => {
    expect(() => buildPeriods({ frequency: 'WEEKLY', cutoffDay: 5 }, date('2026-01-01'), date('2029-12-31'))).toThrow();
  });
});
