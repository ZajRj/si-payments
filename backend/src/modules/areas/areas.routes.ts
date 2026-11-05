import { Router } from 'express';
import { z } from 'zod';
import { idParamSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { createArea, listAreas, updateArea } from './areas.service.js';

const createAreaSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const updateAreaSchema = createAreaSchema.partial().extend({ active: z.boolean().optional() });

export const areasRouter = Router();

areasRouter.use(authenticate);

areasRouter.get('/', requirePermission(PERMISSIONS.CATALOGS_READ), async (_req, res) => {
  res.json({ areas: await listAreas() });
});

areasRouter.post('/', requirePermission(PERMISSIONS.CATALOGS_MANAGE), async (req, res) => {
  const area = await createArea(req.user!.id, createAreaSchema.parse(req.body));
  res.status(201).json({ area });
});

areasRouter.patch('/:id', requirePermission(PERMISSIONS.CATALOGS_MANAGE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const area = await updateArea(req.user!.id, id, updateAreaSchema.parse(req.body));
  res.json({ area });
});
