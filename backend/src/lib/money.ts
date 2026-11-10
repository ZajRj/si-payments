import { z } from 'zod';

// Los montos se manejan en centavos enteros de USD para que sumas y prorrateos no pierdan centavos.
export const MAX_AMOUNT_CENTS = 100_000_000; // USD 1.000.000,00

export const amountCentsSchema = z
  .number()
  .int('El monto debe estar en centavos enteros')
  .positive('El monto debe ser mayor que cero')
  .max(MAX_AMOUNT_CENTS, 'El monto es demasiado alto');

// Monto para mostrar en mensajes al usuario, con el mismo formato de la interfaz (USD 1.150,00).
const usdDisplay = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' });
export function displayUsd(cents: number): string {
  return usdDisplay.format(cents / 100);
}
