import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { loginAs } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>;
type Period = { id: number; startDate: string; endDate: string; days: number };

let generator: Agent;
let receiver: Agent;
let admin: Agent;
let groupId: number;
let periods: Period[];
let projectId: number;
let physicsId: number;

const period = (startDate: string) => {
  const found = periods.find((p) => p.startDate === startDate);
  if (!found) throw new Error(`Sin período ${startDate}`);
  return found;
};

async function createPerson(idNumber: string, name: string) {
  return (await generator.post('/api/people').send({ idNumber, name }).expect(201)).body.person.id as number;
}

async function createProject(code: string, endDate = '2026-12-31') {
  const res = await generator
    .post('/api/projects')
    .send({ code, name: `Proyecto ${code}`, areaId: physicsId, scope: 'INTERNAL', startDate: '2026-01-01', endDate })
    .expect(201);
  return res.body.project.id as number;
}

async function createAssignment(personId: number, project: number, amountCents: number, startDate: string, endDate: string | null = null) {
  const res = await generator
    .post('/api/assignments')
    .send({ personId, projectId: project, paymentGroupId: groupId, amountCents, startDate, endDate })
    .expect(201);
  return res.body.assignment.id as number;
}

let ana: number;
let beto: number;
let carla: number;
let anaAssignment: number;
let betoAssignment: number;

beforeAll(async () => {
  generator = await loginAs('generador@example.com');
  receiver = await loginAs('receptor@example.com');
  admin = await loginAs('admin@example.com');

  const areas = (await generator.get('/api/areas').expect(200)).body.areas;
  physicsId = areas.find((area: { name: string }) => area.name === 'Física').id;

  // Grupo propio de estas pruebas, para que la causación sin proyecto solo vea asignaciones de aquí.
  const group = await generator.post('/api/payment-groups').send({ name: 'Quincenal causación', frequency: 'BIWEEKLY' }).expect(201);
  groupId = group.body.paymentGroup.id;
  periods = (await generator.post(`/api/payment-groups/${groupId}/periods`).send({ from: '2026-01-01', until: '2026-03-31' }).expect(201))
    .body.periods;

  projectId = await createProject('TST-CAU-001');
  ana = await createPerson('V-40100001', 'Ana Causación');
  beto = await createPerson('V-40100002', 'Beto Causación');
  carla = await createPerson('V-40100003', 'Carla Causación');

  anaAssignment = await createAssignment(ana, projectId, 30_000, '2026-01-01');
  betoAssignment = await createAssignment(beto, projectId, 45_000, '2026-01-06');
  await createAssignment(carla, projectId, 10_000, '2026-01-16', '2026-01-20');
});

describe('permisos', () => {
  it('el receptor consulta la causación pero no la genera ni la anula', async () => {
    await receiver.get('/api/accruals').expect(200);
    await receiver.get('/api/accruals/batches').expect(200);
    await receiver.post('/api/accruals/generate').send({ periodId: period('2026-01-01').id }).expect(403);
    await receiver.post('/api/accruals/1/annul').send({ reason: 'No debería poder' }).expect(403);
  });

  it('el administrador no participa en operaciones de dinero', async () => {
    await admin.get('/api/accruals').expect(403);
    await admin.post('/api/accruals/generate').send({ periodId: period('2026-01-01').id }).expect(403);
  });
});

describe('generación por lote', () => {
  it('causa el período con prorrateo por días activos', async () => {
    const res = await generator
      .post('/api/accruals/generate')
      .send({ periodId: period('2026-01-01').id, projectId })
      .expect(201);

    expect(res.body.batches).toHaveLength(1);
    expect(res.body.batches[0]).toMatchObject({ activeCount: 2, totalCents: 60_000, project: { code: 'TST-CAU-001' } });

    const accruals = (await generator.get('/api/accruals').query({ batchId: res.body.batches[0].id }).expect(200)).body.accruals;
    const byPerson = Object.fromEntries(accruals.map((a: { person: { id: number } }) => [a.person.id, a]));
    // Ana cubre las 15 días; Beto empieza el 6: 10 de 15 días de 45.000 = 30.000.
    expect(byPerson[ana]).toMatchObject({ amountCents: 30_000, activeDays: 15, periodDays: 15, status: 'PENDING', pendingCents: 30_000 });
    expect(byPerson[beto]).toMatchObject({ amountCents: 30_000, activeDays: 10, periodDays: 15, assignmentAmountCents: 45_000 });
    expect(byPerson[carla]).toBeUndefined();
  });

  it('no causa dos veces el mismo período', async () => {
    const res = await generator
      .post('/api/accruals/generate')
      .send({ periodId: period('2026-01-01').id, projectId })
      .expect(409);
    expect(res.body.error.code).toBe('NOTHING_TO_ACCRUE');
  });

  it('usa los días reales de la segunda quincena', async () => {
    const res = await generator
      .post('/api/accruals/generate')
      .send({ periodId: period('2026-01-16').id, projectId })
      .expect(201);
    const accruals = (await generator.get('/api/accruals').query({ batchId: res.body.batches[0].id }).expect(200)).body.accruals;
    const carlaAccrual = accruals.find((a: { person: { id: number } }) => a.person.id === carla);
    // Del 16 al 20 de enero: 5 de 16 días de 10.000 = 3.125.
    expect(carlaAccrual).toMatchObject({ activeDays: 5, periodDays: 16, amountCents: 3_125 });
    expect(res.body.batches[0].totalCents).toBe(30_000 + 45_000 + 3_125);
  });

  it('filtra los lotes por grupo de pago y por persona, con lo pagado y lo pendiente', async () => {
    const byGroup = (await generator.get('/api/accruals/batches').query({ paymentGroupId: groupId, pageSize: 50 }).expect(200)).body
      .batches;
    expect(byGroup.length).toBeGreaterThan(0);
    expect(byGroup.every((b: { period: { paymentGroup: { id: number } } }) => b.period.paymentGroup.id === groupId)).toBe(true);

    // Carla solo trabajó del 16 al 20 de enero: un único lote la incluye.
    const byCarla = (await generator.get('/api/accruals/batches').query({ personId: carla }).expect(200)).body.batches;
    expect(byCarla).toHaveLength(1);
    expect(byCarla[0]).toMatchObject({ period: { startDate: '2026-01-16' }, paidCents: 0 });
    expect(byCarla[0].pendingCents).toBe(byCarla[0].totalCents);
  });

  it('una asignación retroactiva se causa en un lote complementario', async () => {
    const dario = await createPerson('V-40100004', 'Darío Retroactivo');
    await createAssignment(dario, projectId, 15_000, '2026-01-11');

    const res = await generator
      .post('/api/accruals/generate')
      .send({ periodId: period('2026-01-01').id, projectId })
      .expect(201);
    expect(res.body.batches[0]).toMatchObject({ activeCount: 1, totalCents: 5_000 }); // 5 de 15 días
  });

  it('sin proyecto, crea un lote por cada proyecto con asignaciones del grupo', async () => {
    const other = await createProject('TST-CAU-002');
    const eva = await createPerson('V-40100005', 'Eva Otro Proyecto');
    await createAssignment(eva, other, 20_000, '2026-02-01');

    const res = await generator.post('/api/accruals/generate').send({ periodId: period('2026-02-01').id }).expect(201);
    const codes = res.body.batches.map((b: { project: { code: string } }) => b.project.code).sort();
    expect(codes).toEqual(['TST-CAU-001', 'TST-CAU-002']);
  });

  it('no causa un período que todavía no termina', async () => {
    const monthly = await generator.post('/api/payment-groups').send({ name: 'Mensual futuro', frequency: 'MONTHLY' }).expect(201);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Caracas' });
    const until = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const created = (
      await generator.post(`/api/payment-groups/${monthly.body.paymentGroup.id}/periods`).send({ from: today, until }).expect(201)
    ).body.periods;

    const res = await generator.post('/api/accruals/generate').send({ periodId: created[1].id }).expect(409);
    expect(res.body.error.code).toBe('PERIOD_NOT_ENDED');
  });

  it('valida el período y el proyecto', async () => {
    await generator.post('/api/accruals/generate').send({ periodId: 999_999 }).expect(404);
    await generator.post('/api/accruals/generate').send({ periodId: period('2026-01-01').id, projectId: 999_999 }).expect(400);
    await generator.post('/api/accruals/generate').send({}).expect(400);
  });
});

describe('anulaciones', () => {
  it('anula con motivo y permite volver a causar', async () => {
    const [accrual] = (
      await generator.get('/api/accruals').query({ projectId, personId: beto, periodId: period('2026-02-01').id }).expect(200)
    ).body.accruals;

    await generator.post(`/api/accruals/${accrual.id}/annul`).send({ reason: 'no' }).expect(400);
    const res = await generator.post(`/api/accruals/${accrual.id}/annul`).send({ reason: 'Monto mal cargado' }).expect(200);
    expect(res.body.accrual).toMatchObject({ status: 'ANNULLED', pendingCents: 0, annulmentReason: 'Monto mal cargado' });

    await generator.post(`/api/accruals/${accrual.id}/annul`).send({ reason: 'Otra vez' }).expect(409);

    const regenerated = await generator
      .post('/api/accruals/generate')
      .send({ periodId: period('2026-02-01').id, projectId })
      .expect(201);
    expect(regenerated.body.batches[0].activeCount).toBe(1);

    const annulled = (await generator.get('/api/accruals').query({ projectId, status: 'ANNULLED' }).expect(200)).body.accruals;
    expect(annulled.map((a: { id: number }) => a.id)).toContain(accrual.id);
  });

  it('anula un lote completo', async () => {
    const created = await generator
      .post('/api/accruals/generate')
      .send({ periodId: period('2026-02-16').id, projectId })
      .expect(201);
    const batchId = created.body.batches[0].id;

    const res = await generator.post(`/api/accruals/batches/${batchId}/annul`).send({ reason: 'Lote generado por error' }).expect(200);
    expect(res.body.batch).toMatchObject({ activeCount: 0, totalCents: 0 });
    await generator.post(`/api/accruals/batches/${batchId}/annul`).send({ reason: 'Lote generado por error' }).expect(409);
  });

  it('queda registrada en la auditoría', async () => {
    const [accrual] = (await generator.get('/api/accruals').query({ projectId, status: 'ANNULLED' }).expect(200)).body.accruals;
    const entries = (await admin.get('/api/audit-log').query({ entity: 'Accrual', entityId: String(accrual.id) }).expect(200)).body
      .entries;
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('protección de lo causado', () => {
  it('no permite cambiar la fecha de fin si altera días causados', async () => {
    const res = await generator.patch(`/api/assignments/${betoAssignment}`).send({ endDate: '2026-01-10' }).expect(409);
    expect(res.body.error.code).toBe('ASSIGNMENT_HAS_ACCRUALS');

    // Después de lo causado sí se puede.
    await generator.patch(`/api/assignments/${betoAssignment}`).send({ endDate: '2026-06-30' }).expect(200);
  });

  it('no permite un cambio de monto dentro de un período causado', async () => {
    await generator
      .post(`/api/assignments/${anaAssignment}/amount-change`)
      .send({ effectiveDate: '2026-01-10', amountCents: 35_000 })
      .expect(409);
    await generator
      .post(`/api/assignments/${anaAssignment}/amount-change`)
      .send({ effectiveDate: '2026-03-01', amountCents: 35_000 })
      .expect(201);
  });

  it('no permite acortar el proyecto si cambia días causados de asignaciones sin fecha de fin', async () => {
    const project = await createProject('TST-CAU-003');
    const fede = await createPerson('V-40100006', 'Fede Proyecto');
    await createAssignment(fede, project, 20_000, '2026-01-01');
    await generator.post('/api/accruals/generate').send({ periodId: period('2026-01-01').id, projectId: project }).expect(201);

    const res = await generator.patch(`/api/projects/${project}`).send({ endDate: '2026-01-10' }).expect(409);
    expect(res.body.error.code).toBe('ASSIGNMENT_HAS_ACCRUALS');
    await generator.patch(`/api/projects/${project}`).send({ endDate: '2026-06-30' }).expect(200);
  });

  it('no permite eliminar un período con causaciones', async () => {
    await generator.post('/api/accruals/generate').send({ periodId: period('2026-03-16').id, projectId }).expect(201);
    const res = await generator.delete(`/api/payment-groups/${groupId}/periods/last`).expect(409);
    expect(res.body.error.code).toBe('PERIOD_HAS_ACCRUALS');
  });
});

describe('inmutabilidad en la base de datos', () => {
  it('no se puede modificar ni borrar una causación, ni anularla dos veces', async () => {
    const accrual = await prisma.accrual.findFirstOrThrow({ where: { projectId, annulledAt: null } });
    await expect(prisma.accrual.update({ where: { id: accrual.id }, data: { amountCents: 1 } })).rejects.toThrow();
    await expect(prisma.accrual.delete({ where: { id: accrual.id } })).rejects.toThrow();

    const annulled = await prisma.accrual.findFirstOrThrow({ where: { projectId, annulledAt: { not: null } } });
    await expect(
      prisma.accrual.update({ where: { id: annulled.id }, data: { annulmentReason: 'Cambiar el motivo' } }),
    ).rejects.toThrow();
  });

  it('no se puede insertar una segunda causación vigente para la misma asignación y período', async () => {
    const accrual = await prisma.accrual.findFirstOrThrow({ where: { projectId, annulledAt: null } });
    const { id: _id, createdAt: _createdAt, ...copy } = accrual;
    await expect(prisma.accrual.create({ data: copy })).rejects.toThrow();
  });

  it('los lotes no se modifican ni se borran', async () => {
    const batch = await prisma.accrualBatch.findFirstOrThrow({ where: { projectId } });
    await expect(prisma.accrualBatch.delete({ where: { id: batch.id } })).rejects.toThrow();
    await expect(prisma.accrualBatch.update({ where: { id: batch.id }, data: { projectId: batch.projectId } })).rejects.toThrow();
  });
});

describe('montos que prorratean a cero', () => {
  it('no causa una asignación cuyo prorrateo da 0,00', async () => {
    const project = await createProject('TST-CAU-ZERO');
    const tiny = await createPerson('V-40100010', 'Dani Centavo');
    const full = await createPerson('V-40100011', 'Eva Completa');
    // 1 centavo por 1 día de 15 son 0,067 centavos: redondea a 0.
    await createAssignment(tiny, project, 1, '2026-01-15', '2026-01-15');
    await createAssignment(full, project, 10_000, '2026-01-01');

    const res = await generator.post('/api/accruals/generate').send({ periodId: period('2026-01-01').id, projectId: project }).expect(201);
    expect(res.body.batches[0]).toMatchObject({ activeCount: 1, totalCents: 10_000 });

    const accruals = (await generator.get('/api/accruals').query({ projectId: project }).expect(200)).body.accruals;
    expect(accruals).toHaveLength(1);
    expect(accruals[0].person.id).toBe(full);
    expect(accruals.every((a: { amountCents: number }) => a.amountCents > 0)).toBe(true);
  });

  it('si todo prorratea a cero, no hay nada por causar', async () => {
    const project = await createProject('TST-CAU-ZERO2');
    const tiny = await createPerson('V-40100012', 'Fede Centavo');
    await createAssignment(tiny, project, 1, '2026-01-15', '2026-01-15');
    const res = await generator.post('/api/accruals/generate').send({ periodId: period('2026-01-01').id, projectId: project }).expect(409);
    expect(res.body.error.code).toBe('NOTHING_TO_ACCRUE');
  });
});

describe('paginación', () => {
  it('pagina causaciones y lotes, y los totales cubren todo lo filtrado', async () => {
    const all = (await generator.get('/api/accruals').query({ projectId }).expect(200)).body;
    expect(all).toMatchObject({ page: 1, pageSize: 50 });
    expect(all.total).toBeGreaterThanOrEqual(3);

    const first = (await generator.get('/api/accruals').query({ projectId, pageSize: 2, page: 1 }).expect(200)).body;
    const second = (await generator.get('/api/accruals').query({ projectId, pageSize: 2, page: 2 }).expect(200)).body;
    expect(first.accruals).toHaveLength(2);
    expect(first).toMatchObject({ total: all.total, pageSize: 2, pageCount: Math.ceil(all.total / 2) });
    expect(second.accruals.length).toBe(all.total - 2 > 2 ? 2 : all.total - 2);
    // Sin repetidos entre páginas y mismo orden que la lista completa.
    expect([...first.accruals, ...second.accruals].map((a: { id: number }) => a.id)).toEqual(
      all.accruals.slice(0, first.accruals.length + second.accruals.length).map((a: { id: number }) => a.id),
    );
    // Los totales no dependen de la página pedida.
    expect(first.totals).toEqual(all.totals);
    expect(second.totals).toEqual(all.totals);

    const batches = (await generator.get('/api/accruals/batches').query({ projectId, pageSize: 1 }).expect(200)).body;
    expect(batches.batches).toHaveLength(1);
    expect(batches).toMatchObject({ pageSize: 1, pageCount: batches.total });
  });

  it('una página fuera de rango queda vacía y el filtro por estado se aplica antes de paginar', async () => {
    const beyond = (await generator.get('/api/accruals').query({ projectId, page: 999 }).expect(200)).body;
    expect(beyond.accruals).toEqual([]);
    expect(beyond.total).toBeGreaterThan(0);

    const pending = (await generator.get('/api/accruals').query({ projectId, status: 'PENDING', pageSize: 1 }).expect(200)).body;
    expect(pending.total).toBeGreaterThan(1);
    expect(pending.accruals).toHaveLength(1);
    expect(pending.accruals[0].status).toBe('PENDING');
  });

  it('rechaza tamaños de página inválidos', async () => {
    await generator.get('/api/accruals').query({ pageSize: 1000 }).expect(400);
    await generator.get('/api/accruals').query({ page: 0 }).expect(400);
    await generator.get('/api/accruals/batches').query({ pageSize: 1000 }).expect(400);
  });
});
