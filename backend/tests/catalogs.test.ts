import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { app, loginAs } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>;

async function auditEntries(admin: Agent, entity: string, entityId: number | string) {
  const res = await admin.get('/api/audit-log').query({ entity, entityId: String(entityId) }).expect(200);
  return res.body.entries;
}

describe('áreas', () => {
  it('todos los roles las consultan, pero solo el administrador las modifica', async () => {
    for (const email of ['generador@example.com', 'receptor@example.com']) {
      const agent = await loginAs(email);
      const res = await agent.get('/api/areas').expect(200);
      expect(res.body.areas.map((area: { name: string }) => area.name)).toContain('Física');

      await agent.post('/api/areas').send({ name: 'No permitida', description: 'Área que no se debería crear' }).expect(403);
      await agent.patch('/api/areas/1').send({ active: false }).expect(403);
    }
  });

  it('el administrador crea y desactiva un área, y cada cambio queda auditado', async () => {
    const admin = await loginAs('admin@example.com');
    const description = 'Proyectos de suelos, rocas y estudios del subsuelo';
    const created = await admin.post('/api/areas').send({ name: 'Geología', description }).expect(201);
    const id = created.body.area.id;
    expect(created.body.area).toMatchObject({ name: 'Geología', description });

    await admin.post('/api/areas').send({ name: 'Geología', description }).expect(409);
    // Tampoco con otra capitalización o sin acentos.
    await admin.post('/api/areas').send({ name: 'geologia', description }).expect(409);
    await admin.post('/api/areas').send({ name: 'FÍSICA', description }).expect(409);
    await admin.patch(`/api/areas/${id}`).send({ active: false }).expect(200);

    const [update, create] = await auditEntries(admin, 'Area', id);
    expect(create).toMatchObject({ action: 'CREATE', after: { name: 'Geología', description, active: true } });
    expect(update).toMatchObject({
      action: 'UPDATE',
      before: { active: true },
      after: { active: false },
      user: { email: 'admin@example.com' },
    });
  });

  it('exige una descripción que diga qué proyectos van en el área', async () => {
    const admin = await loginAs('admin@example.com');
    await admin.post('/api/areas').send({ name: 'Astronomía' }).expect(400);
    await admin.post('/api/areas').send({ name: 'Astronomía', description: 'corta' }).expect(400);

    const res = await admin.get('/api/areas').expect(200);
    const physics = res.body.areas.find((area: { name: string }) => area.name === 'Física');
    expect(physics.description).not.toBe('');
  });

  it('un área no se borra ni con SQL directo', async () => {
    const area = await prisma.area.findFirstOrThrow({ where: { name: 'Física' } });
    await expect(prisma.area.delete({ where: { id: area.id } })).rejects.toThrow();
    // Ni siquiera una sin proyectos.
    const empty = await prisma.area.create({ data: { name: 'Área sin proyectos', description: 'Solo para la prueba' } });
    await expect(prisma.area.delete({ where: { id: empty.id } })).rejects.toThrow();
  });
});

describe('reglas de desactivación de catálogos', () => {
  it('no desactiva un área con proyectos activos ni un grupo con asignaciones vigentes', async () => {
    const admin = await loginAs('admin@example.com');
    const generator = await loginAs('generador@example.com');
    const areas = (await admin.get('/api/areas').expect(200)).body.areas;
    const physics = areas.find((area: { name: string }) => area.name === 'Física');
    await admin.patch(`/api/areas/${physics.id}`).send({ active: false }).expect(409);

    const groups = (await generator.get('/api/payment-groups').expect(200)).body.paymentGroups;
    const monthly = groups.find((group: { name: string }) => group.name === 'Mensual');
    await generator.patch(`/api/payment-groups/${monthly.id}`).send({ active: false }).expect(409);
    await generator.post('/api/payment-groups').send({ name: 'mensual', frequency: 'MONTHLY' }).expect(409);
  });
});

describe('mensajes de validación', () => {
  it('se devuelven en español', async () => {
    const generator = await loginAs('generador@example.com');
    const res = await generator.post('/api/payment-groups').send({ name: ' ', frequency: 'MONTHLY', cutoffDay: 1.5 }).expect(400);
    expect(res.body.error.details).toEqual({
      name: ['Este campo es obligatorio'],
      cutoffDay: ['Debe ser un número entero'],
    });
  });
});

describe('grupos de pago y períodos', () => {
  it('valida el día de corte según la periodicidad', async () => {
    const generator = await loginAs('generador@example.com');

    await generator.post('/api/payment-groups').send({ name: 'Sin corte', frequency: 'WEEKLY' }).expect(400);
    await generator.post('/api/payment-groups').send({ name: 'Corte 30', frequency: 'MONTHLY', cutoffDay: 30 }).expect(400);
    await generator.post('/api/payment-groups').send({ name: 'Diario', frequency: 'DAILY' }).expect(400);
  });

  it('genera períodos consecutivos y un cambio de corte solo afecta a los siguientes', async () => {
    const generator = await loginAs('generador@example.com');
    const created = await generator
      .post('/api/payment-groups')
      .send({ name: 'Quincenal pruebas', frequency: 'BIWEEKLY' })
      .expect(201);
    const id = created.body.paymentGroup.id;
    expect(created.body.paymentGroup.cutoffDay).toBe(15);

    await generator.post(`/api/payment-groups/${id}/periods`).send({ until: '2026-01-31' }).expect(400);

    const first = await generator
      .post(`/api/payment-groups/${id}/periods`)
      .send({ from: '2026-01-01', until: '2026-01-31' })
      .expect(201);
    expect(first.body.periods).toMatchObject([
      { startDate: '2026-01-01', endDate: '2026-01-15', days: 15 },
      { startDate: '2026-01-16', endDate: '2026-01-31', days: 16 },
    ]);

    await generator
      .post(`/api/payment-groups/${id}/periods`)
      .send({ from: '2026-02-01', until: '2026-02-28' })
      .expect(409);

    await generator.patch(`/api/payment-groups/${id}`).send({ cutoffDay: 10 }).expect(200);
    const next = await generator.post(`/api/payment-groups/${id}/periods`).send({ until: '2026-02-28' }).expect(201);
    expect(next.body.periods).toMatchObject([
      { startDate: '2026-02-01', endDate: '2026-02-10' },
      { startDate: '2026-02-11', endDate: '2026-02-28' },
    ]);

    const removed = await generator.delete(`/api/payment-groups/${id}/periods/last`).expect(200);
    expect(removed.body.period).toMatchObject({ startDate: '2026-02-11', endDate: '2026-02-28' });

    const list = await generator.get(`/api/payment-groups/${id}/periods`).expect(200);
    expect(list.body.periods.map((period: { endDate: string }) => period.endDate)).toEqual([
      '2026-01-15',
      '2026-01-31',
      '2026-02-10',
    ]);

    const [deletion] = await auditEntries(await loginAs('admin@example.com'), 'Period', removed.body.period.id);
    expect(deletion).toMatchObject({ action: 'DELETE', before: { startDate: '2026-02-11' }, after: null });
  });

  it('no genera períodos en un grupo inactivo', async () => {
    const generator = await loginAs('generador@example.com');
    const created = await generator
      .post('/api/payment-groups')
      .send({ name: 'Mensual inactivo', frequency: 'MONTHLY' })
      .expect(201);
    const id = created.body.paymentGroup.id;

    await generator.patch(`/api/payment-groups/${id}`).send({ active: false }).expect(200);
    await generator
      .post(`/api/payment-groups/${id}/periods`)
      .send({ from: '2026-01-01', until: '2026-03-31' })
      .expect(409);
  });

  it('el administrador y el receptor consultan grupos y períodos, pero no los modifican', async () => {
    for (const email of ['admin@example.com', 'receptor@example.com']) {
      const agent = await loginAs(email);
      const res = await agent.get('/api/payment-groups').expect(200);
      const group = res.body.paymentGroups.find((g: { name: string }) => g.name === 'Quincenal');

      expect(group.periodCount).toBe(24);
      await agent.get(`/api/payment-groups/${group.id}/periods`).expect(200);
      await agent.post('/api/payment-groups').send({ name: 'No permitido', frequency: 'MONTHLY' }).expect(403);
      await agent.patch(`/api/payment-groups/${group.id}`).send({ active: false }).expect(403);
      await agent.post(`/api/payment-groups/${group.id}/periods`).send({ until: '2027-01-31' }).expect(403);
      await agent.delete(`/api/payment-groups/${group.id}/periods/last`).expect(403);
    }
  });
});

describe('parámetros', () => {
  it('solo el administrador los consulta y modifica, con auditoría', async () => {
    const admin = await loginAs('admin@example.com');
    const generator = await loginAs('generador@example.com');

    await generator.get('/api/settings').expect(403);
    await admin.put('/api/settings/company.name').send({ value: '' }).expect(400);
    await admin.put('/api/settings/no.existe').send({ value: 'x' }).expect(404);
    await admin.put('/api/settings/company.name').send({ value: 'Empresa de Pruebas' }).expect(200);

    const res = await admin.get('/api/settings').expect(200);
    expect(res.body.settings).toContainEqual(expect.objectContaining({ key: 'company.name', value: 'Empresa de Pruebas' }));

    const [change] = await auditEntries(admin, 'Setting', 'company.name');
    expect(change).toMatchObject({ action: 'UPDATE', after: { value: 'Empresa de Pruebas' } });
  });
});

describe('log de auditoría', () => {
  it('rechaza un rango de fechas invertido', async () => {
    const admin = await loginAs('admin@example.com');
    await admin.get('/api/audit-log').query({ from: '2026-05-02', to: '2026-05-01' }).expect(400);
  });

  it('solo el administrador lo consulta', async () => {
    await request(app).get('/api/audit-log').expect(401);
    for (const email of ['generador@example.com', 'receptor@example.com']) {
      const agent = await loginAs(email);
      await agent.get('/api/audit-log').expect(403);
    }
  });

  it('registra los cambios de usuarios sin guardar el hash de la contraseña', async () => {
    const admin = await loginAs('admin@example.com');
    const roles = await admin.get('/api/roles').expect(200);
    const created = await admin
      .post('/api/users')
      .send({ email: 'auditado@example.com', name: 'Auditado', password: 'Auditado1234!', roleId: roles.body.roles[0].id })
      .expect(201);
    const id = created.body.user.id;

    await admin.patch(`/api/users/${id}`).send({ password: 'Nueva1234!' }).expect(200);

    const entries = await auditEntries(admin, 'User', id);
    expect(entries.map((entry: { action: string }) => entry.action)).toEqual(['UPDATE', 'CREATE']);
    expect(entries[0].after.passwordChanged).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('passwordHash');
  });

  it('no permite modificar ni borrar registros, ni siquiera directo en la base de datos', async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "audit_log" SET "action" = 'X'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "audit_log"`)).rejects.toThrow();
  });
});
