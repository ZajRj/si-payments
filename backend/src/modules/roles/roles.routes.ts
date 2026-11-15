import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

export const rolesRouter = Router();

// Solo lectura: la matriz de permisos se define en src/rbac/permissions.ts y el seed la sincroniza en
// cada arranque. Editarla desde la API permitiría a un administrador darse permisos de dinero.

rolesRouter.get('/', authenticate, requirePermission(PERMISSIONS.ROLES_READ), async (_req, res) => {
  const [roles, allPermissions] = await Promise.all([
    prisma.role.findMany({
      orderBy: { id: 'asc' },
      include: { permissions: { include: { permission: true } } },
    }),
    prisma.permission.findMany({
      orderBy: { code: 'asc' },
    }),
  ]);

  res.json({
    roles: roles.map(({ permissions, ...role }) => ({
      ...role,
      permissions: permissions.map(({ permission: { code, description } }) => ({ code, description })),
    })),
    permissions: allPermissions.map(({ code, description }) => ({ code, description })),
  });
});
