import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { PERMISSIONS, ROLE_CODES, ROLES } from '../src/rbac/permissions.js';
import { app, loginAs } from './helpers.js';
import { testEnv } from './test-env.js';

const PASSWORD = testEnv.SEED_USER_PASSWORD;

const roleId = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { code } })).id;

describe('autenticación', () => {
  it('rechaza peticiones sin sesión', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/users').expect(401);
    await request(app).get('/api/roles').expect(401);
  });

  it('rechaza credenciales incorrectas y un token manipulado', async () => {
    await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'incorrecta' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'nadie@example.com', password: PASSWORD }).expect(401);
    await request(app).get('/api/auth/me').set('Cookie', 'session=token.falso.123').expect(401);
  });

  it('entrega una cookie httpOnly y devuelve los permisos del rol sin el hash', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ADMIN@example.com', password: PASSWORD })
      .expect(200);

    expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie']?.[0]).toMatch(/SameSite=Strict/);
    expect(res.body.user.permissions).toContain(PERMISSIONS.USERS_MANAGE);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('cierra la sesión', async () => {
    const agent = await loginAs('admin@example.com');
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });
});

describe('autorización por permisos', () => {
  it.each(['generador@example.com', 'receptor@example.com'])('%s no accede a la gestión de usuarios', async (email) => {
    const agent = await loginAs(email);
    await agent.get('/api/users').expect(403);
    await agent.get('/api/roles').expect(403);
    await agent.post('/api/users').send({}).expect(403);
    await agent.patch('/api/users/1').send({ active: false }).expect(403);
  });

  it('el administrador consulta usuarios y roles sin exponer hashes', async () => {
    const agent = await loginAs('admin@example.com');
    const users = await agent.get('/api/users').expect(200);
    const roles = await agent.get('/api/roles').expect(200);

    expect(users.body.users.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(users.body)).not.toContain('passwordHash');
    expect(roles.body.roles).toHaveLength(3);
  });
});

describe('gestión de usuarios', () => {
  it('un cambio de rol aplica de inmediato sobre la sesión abierta', async () => {
    const admin = await loginAs('admin@example.com');
    const created = await admin
      .post('/api/users')
      .send({
        email: 'nuevo@example.com',
        name: 'Nuevo',
        password: 'Nuevo1234!',
        roleId: await roleId(ROLE_CODES.PAYROLL_GENERATOR),
      })
      .expect(201);

    const session = await loginAs('nuevo@example.com', 'Nuevo1234!');
    await session.get('/api/users').expect(403);

    await admin
      .patch(`/api/users/${created.body.user.id}`)
      .send({ roleId: await roleId(ROLE_CODES.ADMIN) })
      .expect(200);
    await session.get('/api/users').expect(200);
  });

  it('una desactivación invalida la sesión abierta e impide volver a entrar', async () => {
    const admin = await loginAs('admin@example.com');
    const created = await admin
      .post('/api/users')
      .send({
        email: 'temporal@example.com',
        name: 'Temporal',
        password: 'Temporal1234!',
        roleId: await roleId(ROLE_CODES.PAYROLL_RECEIVER),
      })
      .expect(201);

    const session = await loginAs('temporal@example.com', 'Temporal1234!');
    await admin.patch(`/api/users/${created.body.user.id}`).send({ active: false }).expect(200);

    await session.get('/api/auth/me').expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'temporal@example.com', password: 'Temporal1234!' })
      .expect(401);
  });

  it('impide que un administrador se quite su propio acceso', async () => {
    const admin = await loginAs('admin@example.com');
    const { body } = await admin.get('/api/auth/me').expect(200);

    await admin.patch(`/api/users/${body.user.id}`).send({ active: false }).expect(409);
    await admin
      .patch(`/api/users/${body.user.id}`)
      .send({ roleId: await roleId(ROLE_CODES.PAYROLL_RECEIVER) })
      .expect(409);
  });

  it('valida los datos y rechaza emails duplicados o roles inexistentes', async () => {
    const admin = await loginAs('admin@example.com');
    const valid = { email: 'otro@example.com', name: 'Otro', password: 'Otro1234!', roleId: await roleId(ROLE_CODES.ADMIN) };

    await admin.post('/api/users').send({ ...valid, password: 'corta' }).expect(400);
    await admin.post('/api/users').send({ ...valid, email: 'admin@example.com' }).expect(409);
    await admin.post('/api/users').send({ ...valid, roleId: 9999 }).expect(400);
  });
});

describe('segregación de funciones', () => {
  const MONEY_PERMISSIONS = [
    PERMISSIONS.ACCRUALS_GENERATE,
    PERMISSIONS.PAYMENT_REQUESTS_CREATE,
    PERMISSIONS.PAYMENT_REQUESTS_DECIDE,
    PERMISSIONS.PAYMENTS_REGISTER,
    PERMISSIONS.PETTY_CASH_REQUEST,
    PERMISSIONS.PETTY_CASH_MANAGE,
  ];

  it('el administrador no tiene permisos sobre operaciones de dinero', () => {
    for (const permission of MONEY_PERMISSIONS) {
      expect(ROLES.ADMIN.permissions).not.toContain(permission);
    }
  });

  it('quien genera un pago no puede aprobarlo ni entregarlo, y viceversa', () => {
    const generator = ROLES.PAYROLL_GENERATOR.permissions;
    const receiver = ROLES.PAYROLL_RECEIVER.permissions;

    for (const permission of MONEY_PERMISSIONS) {
      expect(generator.includes(permission) && receiver.includes(permission)).toBe(false);
    }
  });

  it('el seed guarda en la base de datos la misma matriz definida en el código', async () => {
    for (const [code, definition] of Object.entries(ROLES)) {
      const links = await prisma.rolePermission.findMany({
        where: { role: { code } },
        include: { permission: true },
      });
      expect(links.map((link) => link.permission.code).sort()).toEqual([...definition.permissions].sort());
    }
  });
});
