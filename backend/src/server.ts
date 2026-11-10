import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { registerProcessErrorHandlers } from './middleware/error-handler.js';

const server = createApp().listen(env.PORT, () => {
  console.log(`API escuchando en el puerto ${env.PORT}`);
});

let closing = false;

function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  setTimeout(() => process.exit(exitCode || 1), 10_000).unref();
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(exitCode));
  });
}

process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
registerProcessErrorHandlers(shutdown);
