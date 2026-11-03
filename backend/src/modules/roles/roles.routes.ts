import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

export const rolesRouter = Router();

rolesRouter.get('/', authenticate, requirePermission(PERMISSIONS.ROLES_READ), async (_req, res) => {
  const roles = await prisma.role.findMany({
    orderBy: { id: 'asc' },
    include: { permissions: { include: { permission: true } } },
  });

  res.json({
    roles: roles.map(({ permissions, ...role }) => ({
      ...role,
      permissions: permissions.map(({ permission: { code, description } }) => ({ code, description })),
    })),
  });
});
