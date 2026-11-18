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

  it('bloquea una cuenta tras 10 intentos fallidos aunque cambie la IP', async () => {
    const attempt = (i: number) =>
      request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `10.1.0.${i}`)
        .send({ email: 'objetivo@example.com', password: `intento-${i}` });
    for (let i = 0; i < 10; i++) await attempt(i).expect(401);
    const res = await attempt(99).expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    // Otras cuentas no quedan afectadas.
    await request(app).post('/api/auth/login').send({ email: 'otra@example.com', password: 'incorrecta' }).expect(401);
  });

  it('entrega una cookie httpOnly y devuelve los permisos del rol sin el hash', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ADMIN@example.com', password: PASSWORD })
      .expect(200);

    expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie']?.[0]).toMatch(/SameSite=Strict/);
    // Cookie de sesión: el navegador la borra al cerrarse.
    expect(res.headers['set-cookie']?.[0]).not.toMatch(/Max-Age|Expires/i);
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

  it('la matriz de permisos no se puede modificar desde la API', async () => {
    const admin = await loginAs('admin@example.com');
    const adminRole = await roleId(ROLE_CODES.ADMIN);

    await admin
      .put(`/api/roles/${adminRole}/permissions`)
      .send({ permissionCodes: [...ROLES.ADMIN.permissions, PERMISSIONS.PAYMENTS_REGISTER] })
      .expect(404);

    const links = await prisma.rolePermission.findMany({ where: { roleId: adminRole }, include: { permission: true } });
    expect(links.map((link) => link.permission.code)).not.toContain(PERMISSIONS.PAYMENTS_REGISTER);
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

  it('guardar un usuario sin cambios no deja un registro vacío en la auditoría', async () => {
    const admin = await loginAs('admin@example.com');
    const { body } = await admin.get('/api/auth/me').expect(200);
    const { user } = body;
    const countAudit = () => prisma.auditLog.count({ where: { entity: 'User', entityId: String(user.id) } });

    const before = await countAudit();
    await admin.patch(`/api/users/${user.id}`).send({ name: user.name, email: user.email }).expect(200);
    expect(await countAudit()).toBe(before);

    await admin.patch(`/api/users/${user.id}`).send({ name: `${user.name} (editado)` }).expect(200);
    expect(await countAudit()).toBe(before + 1);
    await admin.patch(`/api/users/${user.id}`).send({ name: user.name }).expect(200);
  });

  it('valida los datos y rechaza emails duplicados o roles inexistentes', async () => {
    const admin = await loginAs('admin@example.com');
    const valid = { email: 'otro@example.com', name: 'Otro', password: 'Otro1234!', roleId: await roleId(ROLE_CODES.ADMIN) };

    await admin.post('/api/users').send({ ...valid, password: 'corta' }).expect(400);
    await admin.post('/api/users').send({ ...valid, email: 'admin@example.com' }).expect(409);
    await admin.post('/api/users').send({ ...valid, roleId: 9999 }).expect(400);
  });

  it('elimina un usuario via soft delete registrando fecha y operador responsable', async () => {
    const admin = await loginAs('admin@example.com');
    const { body: me } = await admin.get('/api/auth/me').expect(200);

    const created = await admin
      .post('/api/users')
      .send({
        email: 'paraeliminar@example.com',
        name: 'Para Eliminar',
        password: 'Password1234!',
        roleId: await roleId(ROLE_CODES.PAYROLL_RECEIVER),
      })
      .expect(201);

    const targetId = created.body.user.id;
    const session = await loginAs('paraeliminar@example.com', 'Password1234!');
    await session.get('/api/auth/me').expect(200);

    // No se puede autoeliminar el administrador
    await admin.delete(`/api/users/${me.user.id}`).expect(409);

    // Usuario sin permiso USERS_MANAGE no puede eliminar
    const receiver = await loginAs('receptor@example.com');
    await receiver.delete(`/api/users/${targetId}`).expect(403);

    // El admin ejecuta soft delete
    const deleteRes = await admin.delete(`/api/users/${targetId}`).expect(200);
    expect(deleteRes.body.user.deleteDate).not.toBeNull();
    expect(deleteRes.body.user.delete_date).not.toBeNull();
    expect(deleteRes.body.user.deletedById).toBe(me.user.id);
    expect(deleteRes.body.user.deletedBy?.id).toBe(me.user.id);
    expect(deleteRes.body.user.active).toBe(false);

    // La sesión abierta se invalida de inmediato y no puede volver a ingresar
    await session.get('/api/auth/me').expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'paraeliminar@example.com', password: 'Password1234!' })
      .expect(401);

    // No se puede modificar ni volver a eliminar
    await admin.patch(`/api/users/${targetId}`).send({ name: 'Otro Nombre' }).expect(400);
    await admin.delete(`/api/users/${targetId}`).expect(400);

    // Verifica que en la base de datos figure delete_date y deleted_by_id
    const dbUser = await prisma.user.findUnique({ where: { id: targetId } });
    expect(dbUser?.deleteDate).not.toBeNull();
    expect(dbUser?.deletedById).toBe(me.user.id);

    // Se registró en la auditoría
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entity: 'User', entityId: String(targetId), action: 'DELETE' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.userId).toBe(me.user.id);
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
