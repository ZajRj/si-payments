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

// Zona horaria del negocio: define qué día es "hoy" y cómo se interpretan los filtros por fecha,
// sin importar la zona horaria del servidor (en Docker suele ser UTC).
export const BUSINESS_TIME_ZONE = 'America/Caracas';

const businessDateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: BUSINESS_TIME_ZONE });
const businessClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// El día de hoy en la zona del negocio, como fecha sin hora.
export function businessToday(): Date {
  return parseDateOnly(businessDateFormat.format(new Date()))!;
}

// Instante en que empieza el día `date` en la zona del negocio. Sirve para filtrar marcas de tiempo
// (como createdAt) por día local: 2026-11-03 en Caracas empieza a las 04:00 UTC.
export function startOfBusinessDay(date: Date): Date {
  const parts = Object.fromEntries(businessClockFormat.formatToParts(date).map(({ type, value }) => [type, value]));
  const wallClockAsUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return new Date(date.getTime() - (wallClockAsUtc - date.getTime()));
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
