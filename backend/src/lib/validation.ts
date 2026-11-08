import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

// bcrypt solo considera los primeros 72 bytes.
export const passwordSchema = z.string().min(8).max(72);

export const idParamSchema = z.coerce.number().int().positive();

// En los campos opcionales, un texto vacío o solo con espacios se guarda como null.
const emptyToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

export function nullableTextSchema(max: number) {
  return z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
}

// Motivo obligatorio de una anulación, un rechazo o un cierre con saldo pendiente.
export const reasonSchema = z.string().trim().min(5).max(500);

export const nullableEmailSchema = z.preprocess(emptyToNull, emailSchema.nullable());
