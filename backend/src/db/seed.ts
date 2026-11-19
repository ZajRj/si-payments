import bcrypt from 'bcryptjs';
import { parseDateOnly } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';
import { seedDemoActivity } from './demo-activity.js';
import { buildPeriods, normalizeRule, type Frequency } from '../modules/payment-groups/periods.js';
import { SETTINGS } from '../modules/settings/settings.definitions.js';
import { PERMISSION_DESCRIPTIONS, ROLE_CODES, ROLES, type Permission, type RoleCode } from '../rbac/permissions.js';

const DEMO_USERS: { email: string; name: string; role: RoleCode }[] = [
  { email: 'admin@example.com', name: 'Ana Administradora', role: ROLE_CODES.ADMIN },
  { email: 'generador@example.com', name: 'Gabriel Coordinador', role: ROLE_CODES.PAYROLL_GENERATOR },
  { email: 'receptor@example.com', name: 'Rosa Gerente', role: ROLE_CODES.PAYROLL_RECEIVER },
];

const AREAS: { name: string; description: string }[] = [
  { name: 'Física', description: 'Proyectos de física: óptica, mecánica, sismología, instrumentación y mediciones.' },
  { name: 'Química', description: 'Proyectos de química: síntesis, análisis de materiales y procesos de laboratorio.' },
  { name: 'Biología', description: 'Proyectos de biología: genómica, ecología, microbiología y estudios de organismos vivos.' },
];

const DEMO_PAYMENT_GROUPS: { name: string; frequency: Frequency; cutoffDay: number | null }[] = [
  { name: 'Semanal (cierre viernes)', frequency: 'WEEKLY', cutoffDay: 5 },
  { name: 'Quincenal', frequency: 'BIWEEKLY', cutoffDay: 15 },
  { name: 'Mensual', frequency: 'MONTHLY', cutoffDay: null },
];

const DEMO_PERIODS_FROM = parseDateOnly('2026-01-01')!;
const DEMO_PERIODS_UNTIL = parseDateOnly('2026-12-31')!;

// Datos ficticios.
const DEMO_PEOPLE = [
  { idNumber: 'V-14567890', name: 'María Fernanda Pérez', phone: '0414-5550101', email: 'mfperez@example.com' },
  { idNumber: 'V-16789012', name: 'José Gregorio Rangel', phone: '0412-5550102', email: null },
  { idNumber: 'V-18901234', name: 'Andreína Castillo', phone: '0424-5550103', email: 'acastillo@example.com' },
  { idNumber: 'V-20123456', name: 'Luis Alberto Mendoza', phone: null, email: 'lmendoza@example.com' },
  { idNumber: 'V-21345678', name: 'Carolina Rivas', phone: '0416-5550105', email: null },
  { idNumber: 'E-82345678', name: 'Pedro Almeida', phone: '0414-5550106', email: 'palmeida@example.com' },
  { idNumber: 'V-23456789', name: 'Valentina Ochoa', phone: '0412-5550107', email: 'vochoa@example.com' },
  { idNumber: 'V-24567890', name: 'Daniel Herrera', phone: '0424-5550108', email: null },
  { idNumber: 'V-25678901', name: 'Gabriela Suárez', phone: '0414-5550109', email: 'gsuarez@example.com' },
  { idNumber: 'V-26789012', name: 'Ricardo Montilla', phone: null, email: null },
];

const DEMO_PROJECTS = [
  { code: 'FIS-001', name: 'Óptica cuántica aplicada', area: 'Física', scope: 'INTERNAL', start: '2026-01-01', end: '2026-12-31' },
  { code: 'FIS-002', name: 'Calibración de sensores sísmicos', area: 'Física', scope: 'EXTERNAL', start: '2026-03-01', end: '2026-08-31' },
  { code: 'QUI-001', name: 'Síntesis de polímeros biodegradables', area: 'Química', scope: 'EXTERNAL', start: '2026-02-01', end: '2026-11-30' },
  { code: 'BIO-001', name: 'Genómica de microalgas', area: 'Biología', scope: 'INTERNAL', start: '2026-01-15', end: '2026-12-15' },
];

// Incluye asignaciones que empiezan o terminan a mitad de período (para el prorrateo),
// un cambio de monto y una persona en dos proyectos.
const DEMO_ASSIGNMENTS = [
  { person: 'V-14567890', project: 'FIS-001', group: 'Quincenal', amountCents: 40_000, start: '2026-01-01', end: null },
  { person: 'V-16789012', project: 'FIS-001', group: 'Quincenal', amountCents: 35_000, start: '2026-01-01', end: '2026-05-31' },
  { person: 'V-16789012', project: 'FIS-001', group: 'Quincenal', amountCents: 42_000, start: '2026-06-01', end: null },
  { person: 'V-18901234', project: 'FIS-001', group: 'Mensual', amountCents: 80_000, start: '2026-02-10', end: null },
  { person: 'V-20123456', project: 'FIS-002', group: 'Semanal (cierre viernes)', amountCents: 15_000, start: '2026-03-01', end: null },
  { person: 'V-21345678', project: 'FIS-002', group: 'Semanal (cierre viernes)', amountCents: 15_000, start: '2026-03-18', end: null },
  { person: 'E-82345678', project: 'QUI-001', group: 'Mensual', amountCents: 90_000, start: '2026-02-01', end: null },
  { person: 'V-23456789', project: 'QUI-001', group: 'Quincenal', amountCents: 30_000, start: '2026-02-01', end: '2026-07-20' },
  { person: 'V-14567890', project: 'QUI-001', group: 'Mensual', amountCents: 25_000, start: '2026-04-01', end: null },
  { person: 'V-24567890', project: 'BIO-001', group: 'Quincenal', amountCents: 45_000, start: '2026-01-15', end: null },
  { person: 'V-25678901', project: 'BIO-001', group: 'Quincenal', amountCents: 38_000, start: '2026-02-01', end: null },
  { person: 'V-26789012', project: 'BIO-001', group: 'Mensual', amountCents: 70_000, start: '2026-01-15', end: '2026-09-30' },
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

// Las áreas y los parámetros solo se crean si faltan, para no revertir cambios hechos desde la aplicación.
// El seed no escribe en audit_log: no hay un usuario que haga el cambio.
async function seedCatalogs() {
  for (const { name, description } of AREAS) {
    await prisma.area.upsert({ where: { name }, update: {}, create: { name, description } });
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

async function seedDemoProjects() {
  for (const person of DEMO_PEOPLE) {
    await prisma.person.upsert({ where: { idNumber: person.idNumber }, update: {}, create: person });
  }

  for (const { code, name, area, scope, start, end } of DEMO_PROJECTS) {
    await prisma.project.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name,
        scope,
        startDate: parseDateOnly(start)!,
        endDate: parseDateOnly(end)!,
        area: { connect: { name: area } },
      },
    });
  }

  // Las asignaciones no tienen una clave natural, así que solo se cargan si no hay ninguna.
  if ((await prisma.assignment.count()) > 0) return;

  for (const { person, project, group, amountCents, start, end } of DEMO_ASSIGNMENTS) {
    await prisma.assignment.create({
      data: {
        amountCents,
        startDate: parseDateOnly(start)!,
        endDate: end ? parseDateOnly(end)! : null,
        person: { connect: { idNumber: person } },
        project: { connect: { code: project } },
        paymentGroup: { connect: { name: group } },
      },
    });
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
  await seedDemoProjects();
  // Los tests parten sin movimientos para poder causar y pagar sus propios datos desde cero.
  if (process.env.NODE_ENV !== 'test') await seedDemoActivity();
  console.log('Seed: roles, permisos, catálogos y datos de prueba listos.');
} else {
  console.log('Seed: roles, permisos y catálogos listos. Datos de prueba omitidos (SEED_USER_PASSWORD vacío).');
}

await prisma.$disconnect();
