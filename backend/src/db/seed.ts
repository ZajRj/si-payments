import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { PERMISSION_DESCRIPTIONS, ROLE_CODES, ROLES, type Permission, type RoleCode } from '../rbac/permissions.js';

const DEMO_USERS: { email: string; name: string; role: RoleCode }[] = [
  { email: 'admin@example.com', name: 'Ana Administradora', role: ROLE_CODES.ADMIN },
  { email: 'generador@example.com', name: 'Gabriel Coordinador', role: ROLE_CODES.PAYROLL_GENERATOR },
  { email: 'receptor@example.com', name: 'Rosa Gerente', role: ROLE_CODES.PAYROLL_RECEIVER },
];

// Sincroniza el catálogo con el código: se puede ejecutar en cada arranque.
async function syncRbac() {
  await prisma.$transaction(async (tx) => {
    const permissionIds = new Map<Permission, number>();

    for (const [code, description] of Object.entries(PERMISSION_DESCRIPTIONS)) {
      const permission = await tx.permission.upsert({
        where: { code },
        update: { description },
        create: { code, description },
      });
      permissionIds.set(code as Permission, permission.id);
    }

    await tx.permission.deleteMany({ where: { code: { notIn: [...permissionIds.keys()] } } });

    for (const [code, definition] of Object.entries(ROLES)) {
      const { name, description, permissions } = definition;
      const role = await tx.role.upsert({
        where: { code },
        update: { name, description },
        create: { code, name, description },
      });

      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permissionIds.get(permission)!,
        })),
      });
    }
  });
}

// Solo crea los usuarios que faltan, para no revertir cambios hechos desde la aplicación.
async function seedDemoUsers(password: string) {
  const passwordHash = await bcrypt.hash(password, 10);

  for (const { email, name, role } of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, passwordHash, role: { connect: { code: role } } },
    });
  }
}

await syncRbac();

const password = process.env.SEED_USER_PASSWORD;
if (password) {
  await seedDemoUsers(password);
  console.log('Seed: roles, permisos y usuarios de prueba listos.');
} else {
  console.log('Seed: roles y permisos listos. Usuarios de prueba omitidos (SEED_USER_PASSWORD vacío).');
}

await prisma.$disconnect();
