import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import './lib/zod-es.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { accrualsRouter } from './modules/accruals/accruals.routes.js';
import { areasRouter } from './modules/areas/areas.routes.js';
import { assignmentsRouter } from './modules/assignments/assignments.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { paymentGroupsRouter } from './modules/payment-groups/payment-groups.routes.js';
import { paymentRequestsRouter, paymentsRouter } from './modules/payment-requests/payment-requests.routes.js';
import { peopleRouter } from './modules/people/people.routes.js';
import { pettyCashRouter } from './modules/petty-cash/petty-cash.routes.js';
import { projectsRouter } from './modules/projects/projects.routes.js';
import { rolesRouter } from './modules/roles/roles.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export function createApp() {
  const app = express();

  // El backend solo es accesible a través del proxy nginx del frontend.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/areas', areasRouter);
  app.use('/api/payment-groups', paymentGroupsRouter);
  app.use('/api/audit-log', auditRouter);
  app.use('/api/people', peopleRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/assignments', assignmentsRouter);
  app.use('/api/accruals', accrualsRouter);
  app.use('/api/payment-requests', paymentRequestsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/petty-cash', pettyCashRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
