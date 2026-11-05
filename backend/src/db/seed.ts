import bcrypt from 'bcryptjs';
import { parseDateOnly } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';
import { buildPeriods, normalizeRule, type Frequency } from '../modules/payment-groups/periods.js';
import { SETTINGS } from '../modules/settings/settings.definitions.js';
import { PERMISSION_DESCRIPTIONS, ROLE_CODES, ROLES, type Permission, type RoleCode } from '../rbac/permissions.js';

const DEMO_USERS: { email: string; name: string; role: RoleCode }[] = [
  { email: 'admin@example.com', name: 'Ana Administradora', role: ROLE_CODES.ADMIN },
  { email: 'generador@example.com', name: 'Gabriel Coordinador', role: ROLE_CODES.PAYROLL_GENERATOR },
  { email: 'receptor@example.com', name: 'Rosa Gerente', role: ROLE_CODES.PAYROLL_RECEIVER },
];

const AREAS = ['Física', 'Química', 'Biología'];

const DEMO_PAYMENT_GROUPS: { name: string; frequency: Frequency; cutoffDay: number | null }[] = [
  { name: 'Semanal (cierre viernes)', frequency: 'WEEKLY', cutoffDay: 5 },
  { name: 'Quincenal', frequency: 'BIWEEKLY', cutoffDay: 15 },
  { name: 'Mensual', frequency: 'MONTHLY', cutoffDay: null },
];

const DEMO_PERIODS_FROM = parseDateOnly('2026-01-01')!;
const DEMO_PERIODS_UNTIL = parseDateOnly('2026-12-31')!;

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

// Las áreas y los parámetros solo se crean si faltan, para no revertir cambios hechos desde la aplicación.
// El seed no escribe en audit_log: no hay un usuario que haga el cambio.
async function seedCatalogs() {
  for (const name of AREAS) {
    await prisma.area.upsert({ where: { name }, update: {}, create: { name } });
  }

  for (const [key, { defaultValue }] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: defaultValue } });
  }
}

async function seedDemoPaymentGroups() {
  for (const { name, frequency, cutoffDay } of DEMO_PAYMENT_GROUPS) {
    const rule = normalizeRule(frequency, cutoffDay);
    const group = await prisma.paymentGroup.upsert({ where: { name }, update: {}, create: { name, ...rule } });

    if ((await prisma.period.count({ where: { paymentGroupId: group.id } })) === 0) {
      await prisma.period.createMany({
        data: buildPeriods(rule, DEMO_PERIODS_FROM, DEMO_PERIODS_UNTIL).map((period) => ({
          ...period,
          paymentGroupId: group.id,
        })),
      });
    }
  }
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
await seedCatalogs();

const password = process.env.SEED_USER_PASSWORD;
if (password) {
  await seedDemoUsers(password);
  await seedDemoPaymentGroups();
  console.log('Seed: roles, permisos, catálogos y datos de prueba listos.');
} else {
  console.log('Seed: roles, permisos y catálogos listos. Datos de prueba omitidos (SEED_USER_PASSWORD vacío).');
}

await prisma.$disconnect();
