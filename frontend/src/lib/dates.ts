// Formato único de fechas en toda la interfaz: DD/MM/AAAA y, con hora, DD/MM/AAAA HH:mm (24 horas).
// La API entrega las fechas de calendario como AAAA-MM-DD; se reordenan como texto para que la zona
// horaria del navegador no pueda correrlas un día.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (value: number) => String(value).padStart(2, '0');

export function formatDate(value: string | null | undefined) {
  if (!value) return '';
  const match = DATE_ONLY.exec(value);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${formatDate(value)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatRange(start: string, end: string) {
  return `${formatDate(start)} al ${formatDate(end)}`;
}

// Marca de tiempo ISO completa (2026-11-10T03:40:21.262Z), como las que guarda la auditoría.
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// Para textos que pueden ser fechas, como los valores del historial de auditoría.
export function formatIfDate(value: string) {
  if (ISO_DATETIME.test(value)) return formatDateTime(value);
  if (DATE_ONLY.test(value)) return formatDate(value);
  return value;
}
