import { Router } from 'express';
import { z } from 'zod';
import { emailSchema, idParamSchema, passwordSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { createUser, listUsers, updateUser } from './users.service.js';

const createUserSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
  roleId: z.number().int().positive(),
});

const updateUserSchema = createUserSchema.partial().extend({ active: z.boolean().optional() });

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get('/', requirePermission(PERMISSIONS.USERS_READ), async (_req, res) => {
  res.json({ users: await listUsers() });
});

usersRouter.post('/', requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
  const user = await createUser(createUserSchema.parse(req.body));
  res.status(201).json({ user });
});

usersRouter.patch('/:id', requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const user = await updateUser(req.user!.id, id, updateUserSchema.parse(req.body));
  res.json({ user });
});
