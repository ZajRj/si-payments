import { periodDays } from '../payment-groups/periods.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type DateRange = { startDate: Date; endDate: Date };

// Días en que la asignación estuvo activa dentro del período, contando ambos extremos.
// `assignment.endDate` es el fin efectivo: la fecha de fin o, si no tiene, el fin del proyecto.
export function activeDaysInPeriod(assignment: DateRange, period: DateRange): number {
  const start = Math.max(assignment.startDate.getTime(), period.startDate.getTime());
  const end = Math.min(assignment.endDate.getTime(), period.endDate.getTime());
  return end < start ? 0 : Math.round((end - start) / DAY_MS) + 1;
}

// Monto causado: monto por período × días activos ÷ días del período, redondeado al centavo
// (la mitad sube). Se calcula con enteros para no arrastrar errores de punto flotante.
export function prorate(amountCents: number, activeDays: number, totalDays: number): number {
  if (activeDays <= 0) return 0;
  if (activeDays >= totalDays) return amountCents;
  return Math.floor((amountCents * activeDays * 2 + totalDays) / (2 * totalDays));
}

export function computeAccrual(amountCents: number, assignment: DateRange, period: DateRange) {
  const totalDays = periodDays(period);
  const activeDays = activeDaysInPeriod(assignment, period);
  return { activeDays, periodDays: totalDays, amountCents: prorate(amountCents, activeDays, totalDays) };
}
