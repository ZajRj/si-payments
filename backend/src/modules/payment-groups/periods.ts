import { addDays, daysInMonth, formatDateOnly, utcDate } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';

export const FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

// Significado de cutoffDay según la periodicidad:
// - WEEKLY: día de la semana en que cierra el período (0 = domingo … 6 = sábado). Obligatorio.
// - BIWEEKLY: último día de la primera quincena (1-27, por defecto 15). La segunda cierra a fin de mes.
// - MONTHLY: día del mes en que cierra el período (1-28). Si es null, cierra a fin de mes.
export type PeriodRule = { frequency: Frequency; cutoffDay: number | null };

export const MAX_PERIODS_PER_GENERATION = 120;

const CUTOFF_RANGES: Record<Frequency, { min: number; max: number; message: string }> = {
  WEEKLY: { min: 0, max: 6, message: 'En un grupo semanal el corte es un día de la semana (0 = domingo … 6 = sábado)' },
  BIWEEKLY: { min: 1, max: 27, message: 'En un grupo quincenal el corte de la primera quincena va del día 1 al 27' },
  MONTHLY: { min: 1, max: 28, message: 'En un grupo mensual el corte va del día 1 al 28, o vacío para fin de mes' },
};

export function normalizeRule(frequency: Frequency, cutoffDay: number | null | undefined): PeriodRule {
  if (cutoffDay === null || cutoffDay === undefined) {
    if (frequency === 'BIWEEKLY') return { frequency, cutoffDay: 15 };
    if (frequency === 'MONTHLY') return { frequency, cutoffDay: null };
  }

  const range = CUTOFF_RANGES[frequency];
  if (cutoffDay === null || cutoffDay === undefined || cutoffDay < range.min || cutoffDay > range.max) {
    throw new HttpError(400, 'INVALID_CUTOFF', range.message);
  }
  return { frequency, cutoffDay };
}

// El período empieza en `start` y termina en el siguiente corte, que puede ser el mismo día.
export function periodEnd(start: Date, { frequency, cutoffDay }: PeriodRule): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const monthEnd = utcDate(year, month, daysInMonth(year, month));

  switch (frequency) {
    case 'WEEKLY':
      return addDays(start, (cutoffDay! - start.getUTCDay() + 7) % 7);
    case 'BIWEEKLY':
      return day <= cutoffDay! ? utcDate(year, month, cutoffDay!) : monthEnd;
    case 'MONTHLY':
      if (cutoffDay === null) return monthEnd;
      return day <= cutoffDay ? utcDate(year, month, cutoffDay) : utcDate(year, month + 1, cutoffDay);
  }
}

// Períodos consecutivos desde `from` hasta cubrir `until`. Cambiar la regla de un grupo solo afecta
// a los períodos que se generen después, porque siempre se continúa desde el último corte.
export function buildPeriods(rule: PeriodRule, from: Date, until: Date) {
  const periods: { startDate: Date; endDate: Date }[] = [];

  for (let start = from; start.getTime() <= until.getTime(); ) {
    if (periods.length === MAX_PERIODS_PER_GENERATION) {
      throw new HttpError(
        400,
        'TOO_MANY_PERIODS',
        `Se pueden generar como máximo ${MAX_PERIODS_PER_GENERATION} períodos a la vez`,
      );
    }
    const endDate = periodEnd(start, rule);
    periods.push({ startDate: start, endDate });
    start = addDays(endDate, 1);
  }

  return periods;
}

export function periodDays({ startDate, endDate }: { startDate: Date; endDate: Date }): number {
  return Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

export function toPeriodDto(period: { id: number; paymentGroupId: number; startDate: Date; endDate: Date }) {
  return {
    id: period.id,
    paymentGroupId: period.paymentGroupId,
    startDate: formatDateOnly(period.startDate),
    endDate: formatDateOnly(period.endDate),
    days: periodDays(period),
  };
}
