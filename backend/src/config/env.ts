import { config } from 'dotenv';
import { z } from 'zod';

config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRES_IN_HOURS: z.coerce.number().int().positive().default(8),
  COOKIE_SECURE: z.stringbool().default(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuración inválida:', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
