import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { listSettings, updateSetting } from './settings.service.js';

const updateSettingSchema = z.object({
  value: z.string().trim().min(1).max(500),
});

export const settingsRouter = Router();

settingsRouter.use(authenticate, requirePermission(PERMISSIONS.SETTINGS_MANAGE));

settingsRouter.get('/', async (_req, res) => {
  res.json({ settings: await listSettings() });
});

settingsRouter.put('/:key', async (req, res) => {
  const { value } = updateSettingSchema.parse(req.body);
  const setting = await updateSetting(req.user!.id, req.params.key, value);
  res.json({ setting });
});
