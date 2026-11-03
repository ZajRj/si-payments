import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/db/seed.ts',
  },
  datasource: {
    // `prisma generate` no se conecta a la base de datos, pero sí exige una URL.
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
  },
});
