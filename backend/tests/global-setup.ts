import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { testEnv } from './test-env.js';

export default function setup() {
  rmSync('prisma/test.db', { force: true });

  const options = { env: { ...process.env, ...testEnv }, stdio: 'pipe' as const };
  execSync('npx prisma migrate deploy', options);
  execSync('npx tsx src/db/seed.ts', options);
}
