import { z } from 'zod';

// Las fechas sin hora (inicio y fin de período, vigencias) se manejan como medianoche UTC
// para que el cálculo de días no dependa de la zona horaria del servidor.

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && formatDateOnly(date) === value ? date : null;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

// Rechaza fechas imposibles como 2026-02-30.
export const dateOnlySchema = z.string().transform((value, ctx) => {
  const date = parseDateOnly(value);
  if (!date) {
    ctx.addIssue({ code: 'custom', message: 'Fecha inválida, usa el formato AAAA-MM-DD' });
    return z.NEVER;
  }
  return date;
});
