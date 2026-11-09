// Monto en letras para los recibos: 15050 centavos -> "CIENTO CINCUENTA DÓLARES CON 50/100".
// Cubre de sobra hasta MAX_AMOUNT_CENTS (USD 1.000.000,00).

const UNITS = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve',
];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos',
  'ochocientos', 'novecientos',
];

// 0-999. "uno" queda tal cual; quien lo usa delante de un sustantivo lo apocopa.
function belowThousand(n: number): string {
  if (n === 100) return 'cien';
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]!);
  if (rest > 0 || hundreds === 0) {
    if (rest < 30) parts.push(UNITS[rest]!);
    else parts.push(rest % 10 === 0 ? TENS[rest / 10]! : `${TENS[Math.floor(rest / 10)]} y ${UNITS[rest % 10]}`);
  }
  return parts.join(' ');
}

// "uno" -> "un" y "veintiuno" -> "veintiún" delante de "mil", "millones" o "dólares".
function apocopate(words: string): string {
  return words.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
}

export function integerInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000_000) {
    throw new RangeError(`Fuera de rango: ${n}`);
  }
  if (n === 0) return 'cero';

  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];

  if (millions === 1) parts.push('un millón');
  else if (millions > 1) parts.push(`${apocopate(belowThousand(millions))} millones`);

  if (thousands === 1) parts.push('mil');
  else if (thousands > 1) parts.push(`${apocopate(belowThousand(thousands))} mil`);

  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(' ');
}

export function amountInWords(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const centsPart = String(cents % 100).padStart(2, '0');
  const words = dollars === 1 ? 'un dólar' : `${apocopate(integerInWords(dollars))}${dollars >= 1_000_000 && dollars % 1_000_000 === 0 ? ' de' : ''} dólares`;
  return `${words} con ${centsPart}/100`.toUpperCase();
}
