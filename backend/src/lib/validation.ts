import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

// bcrypt solo considera los primeros 72 bytes.
export const passwordSchema = z.string().min(8).max(72);

export const idParamSchema = z.coerce.number().int().positive();
