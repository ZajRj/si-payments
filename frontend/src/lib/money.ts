// La API maneja montos en centavos enteros. Aquí se convierten desde y hacia lo que escribe el usuario.

const usdFormatter = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' });

export function formatUsd(cents: number) {
  return usdFormatter.format(cents / 100);
}

// Acepta como lo escribe la gente: "150", "150,50", "150.50", "1.260,00", "1260.5", "$ 5.000" o "USD 5000,00".
// Un solo punto seguido de exactamente tres cifras se lee como separador de miles ("1.260" = 1260).
// Devuelve null si el texto no es un monto válido.
export function parseUsd(input: string): number | null {
  const text = input.trim().replace(/^(usd|\$)\s*/i, '').replace(/\s+/g, '');
  if (!text) return null;

  let normalized: string;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Los dos signos: el último es el decimal y el otro separa miles.
    const decimalIsComma = lastComma > lastDot;
    normalized = decimalIsComma ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  } else if (lastDot >= 0) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text;
  } else {
    normalized = text;
  }

  const match = normalized.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

// Monto listo para un campo de texto, con coma decimal como se ve en pantalla: 126000 → "1260,00".
export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

// Ejemplo de cómo escribir un monto, para los textos de ayuda.
export const MONEY_EXAMPLE = 'Por ejemplo: 150 o 150,50';
