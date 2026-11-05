// La API maneja montos en centavos enteros. Aquí se convierten desde y hacia lo que escribe el usuario.

const usdFormatter = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' });

export function formatUsd(cents: number) {
  return usdFormatter.format(cents / 100);
}

// Acepta "150", "150.5" o "150,50". Devuelve null si el texto no es un monto válido.
export function parseUsd(input: string): number | null {
  const match = input.trim().replace(',', '.').match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2);
}
