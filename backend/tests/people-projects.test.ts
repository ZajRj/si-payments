import { beforeAll, describe, expect, it } from 'vitest';
import { loginAs } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>;

let generator: Agent;
let receiver: Agent;
let admin: Agent;
let physicsId: number;
let biweeklyId: number;
let monthlyId: number;

beforeAll(async () => {
  generator = await loginAs('generador@example.com');
  receiver = await loginAs('receptor@example.com');
  admin = await loginAs('admin@example.com');

  const areas = (await generator.get('/api/areas').expect(200)).body.areas;
  physicsId = areas.find((area: { name: string }) => area.name === 'Física').id;

  const groups = (await generator.get('/api/payment-groups').expect(200)).body.paymentGroups;
  biweeklyId = groups.find((group: { name: string }) => group.name === 'Quincenal').id;
  monthlyId = groups.find((group: { name: string }) => group.name === 'Mensual').id;
});

async function createPerson(idNumber: string, name = 'Persona de prueba') {
  const res = await generator.post('/api/people').send({ idNumber, name }).expect(201);
  return res.body.person.id as number;
}

async function createProject(code: string, startDate = '2026-01-01', endDate = '2026-12-31') {
  const res = await generator
    .post('/api/projects')
    .send({ code, name: `Proyecto ${code}`, areaId: physicsId, scope: 'INTERNAL', startDate, endDate })
    .expect(201);
  return res.body.project.id as number;
}

async function auditEntries(entity: string, entityId: number) {
  const res = await admin.get('/api/audit-log').query({ entity, entityId: String(entityId) }).expect(200);
  return res.body.entries;
}

describe('permisos', () => {
  it('el receptor consulta personas, proyectos y asignaciones, pero no los modifica', async () => {
    await receiver.get('/api/people').expect(200);
    await receiver.get('/api/projects').expect(200);
    await receiver.get('/api/assignments').expect(200);

    await receiver.post('/api/people').send({ idNumber: 'V-11111111', name: 'X' }).expect(403);
    await receiver.post('/api/projects').send({}).expect(403);
    await receiver.post('/api/assignments').send({}).expect(403);
  });

  it('el administrador no accede a personas, proyectos ni asignaciones', async () => {
    await admin.get('/api/people').expect(403);
    await admin.get('/api/projects').expect(403);
    await admin.get('/api/assignments').expect(403);
  });
});

describe('personas', () => {
  it('normaliza la cédula y rechaza duplicados o formatos inválidos', async () => {
    const res = await generator.post('/api/people').send({ idNumber: 'v30111222', name: 'Ana Prueba' }).expect(201);
    expect(res.body.person.idNumber).toBe('V-30111222');

    await generator.post('/api/people').send({ idNumber: 'V-30111222', name: 'Otra' }).expect(409);
    await generator.post('/api/people').send({ idNumber: '30111222', name: 'Sin letra' }).expect(400);
    await generator.post('/api/people').send({ idNumber: 'V-30111223', name: 'Mal email', email: 'no' }).expect(400);
  });

  it('busca por nombre o cédula', async () => {
    const res = await generator.get('/api/people').query({ search: 'Microalgas' }).expect(200);
    expect(res.body.people).toEqual([]);

    const byId = await generator.get('/api/people').query({ search: 'E-8234' }).expect(200);
    expect(byId.body.people.map((p: { name: string }) => p.name)).toEqual(['Pedro Almeida']);
  });
});

describe('proyectos', () => {
  it('valida el área, la vigencia y el código', async () => {
    const base = { code: 'TST-001', name: 'Prueba', areaId: physicsId, scope: 'EXTERNAL' };

    await generator.post('/api/projects').send({ ...base, startDate: '2026-05-01', endDate: '2026-04-01' }).expect(400);
    await generator.post('/api/projects').send({ ...base, areaId: 9999, startDate: '2026-01-01', endDate: '2026-12-31' }).expect(400);
    await generator.post('/api/projects').send({ ...base, scope: 'OTRO', startDate: '2026-01-01', endDate: '2026-12-31' }).expect(400);
    await generator.post('/api/projects').send({ ...base, code: 'FIS-001', startDate: '2026-01-01', endDate: '2026-12-31' }).expect(409);

    const res = await generator
      .post('/api/projects')
      .send({ ...base, code: 'tst-001', startDate: '2026-01-01', endDate: '2026-12-31' })
      .expect(201);
    expect(res.body.project).toMatchObject({ code: 'TST-001', area: { name: 'Física' }, startDate: '2026-01-01' });
  });

  it('no permite una vigencia que deje asignaciones fuera', async () => {
    const projectId = await createProject('TST-002');
    const personId = await createPerson('V-30222333');
    await generator
      .post('/api/assignments')
      .send({ personId, projectId, paymentGroupId: biweeklyId, amountCents: 10_000, startDate: '2026-03-01', endDate: '2026-10-31' })
      .expect(201);

    await generator.patch(`/api/projects/${projectId}`).send({ endDate: '2026-09-30' }).expect(409);
    await generator.patch(`/api/projects/${projectId}`).send({ startDate: '2026-04-01' }).expect(409);
    await generator.patch(`/api/projects/${projectId}`).send({ endDate: '2026-10-31' }).expect(200);
  });
});

describe('asignaciones', () => {
  it('crea una asignación dentro de la vigencia y la audita', async () => {
    const projectId = await createProject('TST-003', '2026-02-01', '2026-11-30');
    const personId = await createPerson('V-30333444');
    const base = { personId, projectId, paymentGroupId: biweeklyId, amountCents: 25_050 };

    await generator.post('/api/assignments').send({ ...base, startDate: '2026-01-15' }).expect(400);
    await generator.post('/api/assignments').send({ ...base, startDate: '2026-02-01', endDate: '2026-12-31' }).expect(400);
    await generator.post('/api/assignments').send({ ...base, amountCents: 0, startDate: '2026-02-01' }).expect(400);
    await generator.post('/api/assignments').send({ ...base, amountCents: 100.5, startDate: '2026-02-01' }).expect(400);

    const res = await generator.post('/api/assignments').send({ ...base, startDate: '2026-02-10' }).expect(201);
    expect(res.body.assignment).toMatchObject({
      amountCents: 25_050,
      startDate: '2026-02-10',
      endDate: null,
      effectiveEndDate: '2026-11-30',
      person: { idNumber: 'V-30333444' },
      project: { code: 'TST-003' },
    });

    const [created] = await auditEntries('Assignment', res.body.assignment.id);
    expect(created).toMatchObject({ action: 'CREATE', user: { email: 'generador@example.com' } });
  });

  it('impide asignaciones que se solapan en el mismo proyecto y grupo de pago', async () => {
    const projectId = await createProject('TST-004');
    const personId = await createPerson('V-30444555');
    const base = { personId, projectId, amountCents: 10_000 };

    await generator.post('/api/assignments').send({ ...base, paymentGroupId: biweeklyId, startDate: '2026-01-01', endDate: '2026-06-30' }).expect(201);
    await generator.post('/api/assignments').send({ ...base, paymentGroupId: biweeklyId, startDate: '2026-06-30' }).expect(409);
    // Otro grupo de pago no se solapa, y el día siguiente al cierre tampoco.
    await generator.post('/api/assignments').send({ ...base, paymentGroupId: monthlyId, startDate: '2026-03-01' }).expect(201);
    await generator.post('/api/assignments').send({ ...base, paymentGroupId: biweeklyId, startDate: '2026-07-01' }).expect(201);
  });

  it('un cambio de monto cierra la asignación y abre otra en una sola operación', async () => {
    const projectId = await createProject('TST-005');
    const personId = await createPerson('V-30555666');
    const created = await generator
      .post('/api/assignments')
      .send({ personId, projectId, paymentGroupId: biweeklyId, amountCents: 30_000, startDate: '2026-01-01', endDate: '2026-10-31' })
      .expect(201);
    const id = created.body.assignment.id;

    await generator.post(`/api/assignments/${id}/amount-change`).send({ effectiveDate: '2026-06-01', amountCents: 30_000 }).expect(400);
    await generator.post(`/api/assignments/${id}/amount-change`).send({ effectiveDate: '2026-01-01', amountCents: 35_000 }).expect(400);
    await generator.post(`/api/assignments/${id}/amount-change`).send({ effectiveDate: '2026-11-01', amountCents: 35_000 }).expect(400);

    const res = await generator
      .post(`/api/assignments/${id}/amount-change`)
      .send({ effectiveDate: '2026-06-01', amountCents: 35_000 })
      .expect(201);
    expect(res.body.closed).toMatchObject({ id, amountCents: 30_000, endDate: '2026-05-31' });
    expect(res.body.created).toMatchObject({ amountCents: 35_000, startDate: '2026-06-01', endDate: '2026-10-31' });

    const list = await generator.get('/api/assignments').query({ personId }).expect(200);
    expect(list.body.assignments).toHaveLength(2);

    const [update] = await auditEntries('Assignment', id);
    expect(update).toMatchObject({ action: 'UPDATE', before: { endDate: '2026-10-31' }, after: { endDate: '2026-05-31' } });
  });

  it('solo se modifica la fecha de fin, sin crear solapamientos', async () => {
    const projectId = await createProject('TST-006');
    const personId = await createPerson('V-30666777');
    const base = { personId, projectId, paymentGroupId: biweeklyId, amountCents: 10_000 };
    const first = await generator.post('/api/assignments').send({ ...base, startDate: '2026-01-01', endDate: '2026-03-31' }).expect(201);
    await generator.post('/api/assignments').send({ ...base, startDate: '2026-05-01' }).expect(201);
    const id = first.body.assignment.id;

    await generator.patch(`/api/assignments/${id}`).send({ endDate: '2026-05-15' }).expect(409);
    await generator.patch(`/api/assignments/${id}`).send({ endDate: '2025-12-31' }).expect(400);
    const res = await generator.patch(`/api/assignments/${id}`).send({ endDate: '2026-04-30', amountCents: 99 }).expect(200);
    expect(res.body.assignment).toMatchObject({ endDate: '2026-04-30', amountCents: 10_000 });
  });

  it('no asigna a personas o proyectos inactivos, ni los desactiva con asignaciones vigentes', async () => {
    const projectId = await createProject('TST-007', '2026-01-01', '2030-12-31');
    const personId = await createPerson('V-30777888');
    const inactiveId = await createPerson('V-30777999');
    await generator.patch(`/api/people/${inactiveId}`).send({ active: false }).expect(200);

    const base = { projectId, paymentGroupId: biweeklyId, amountCents: 10_000, startDate: '2026-01-01' };
    await generator.post('/api/assignments').send({ ...base, personId: inactiveId }).expect(409);
    const created = await generator.post('/api/assignments').send({ ...base, personId }).expect(201);

    await generator.patch(`/api/people/${personId}`).send({ active: false }).expect(409);
    await generator.patch(`/api/projects/${projectId}`).send({ active: false }).expect(409);

    // Una vez cerrada en el pasado, ya no está vigente.
    await generator.patch(`/api/assignments/${created.body.assignment.id}`).send({ endDate: '2026-01-31' }).expect(200);
    await generator.patch(`/api/people/${personId}`).send({ active: false }).expect(200);
    await generator.patch(`/api/projects/${projectId}`).send({ active: false }).expect(200);
  });

  it('el seed carga datos de ejemplo coherentes', async () => {
    const res = await generator.get('/api/assignments').query({ openOnly: 'false' }).expect(200);
    const seeded = res.body.assignments.filter((a: { project: { code: string } }) => !a.project.code.startsWith('TST'));
    expect(seeded).toHaveLength(12);
  });
});
