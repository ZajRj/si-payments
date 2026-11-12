import { Router } from 'express';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

export const rolesRouter = Router();

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

rolesRouter.put('/:id/permissions', authenticate, requirePermission(PERMISSIONS.ROLES_READ), async (req, res) => {
  const roleId = Number(req.params.id);
  if (!Number.isInteger(roleId) || roleId <= 0) {
    throw new HttpError(400, 'BAD_REQUEST', 'ID de rol inválido');
  }

  const { permissionCodes } = req.body as { permissionCodes?: string[] };
  if (!Array.isArray(permissionCodes)) {
    throw new HttpError(400, 'BAD_REQUEST', 'permissionCodes debe ser un arreglo de códigos');
  }

  const currentRole = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } } },
  });

  if (!currentRole) {
    throw new HttpError(404, 'NOT_FOUND', 'Rol no encontrado');
  }

  if (req.user?.role.id === roleId && !permissionCodes.includes(PERMISSIONS.ROLES_READ)) {
    throw new HttpError(409, 'SELF_LOCKOUT', 'No puedes revocar el permiso de consultar roles de tu propio rol');
  }

  const targetPermissions = await prisma.permission.findMany({
    where: { code: { in: permissionCodes } },
  });

  const previousCodes = currentRole.permissions.map((p) => p.permission.code);

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (targetPermissions.length > 0) {
      await tx.rolePermission.createMany({
        data: targetPermissions.map((p) => ({
          roleId,
          permissionId: p.id,
        })),
      });
    }

    await audit(tx, {
      userId: req.user!.id,
      action: 'UPDATE',
      entity: 'RolePermission',
      entityId: roleId,
      before: { role: currentRole.code, permissions: previousCodes },
      after: { role: currentRole.code, permissions: targetPermissions.map((p) => p.code) },
    });
  });

  const updated = await prisma.role.findUniqueOrThrow({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } } },
  });

  res.json({
    role: {
      ...updated,
      permissions: updated.permissions.map(({ permission: { code, description } }) => ({ code, description })),
    },
  });
});
