import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { loginAs } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>;
type Period = { id: number; startDate: string };
type Item = { accrualId: number; person: { id: number }; period: { startDate: string }; paidCents: number; outstandingCents: number };

let generator: Agent;
let receiver: Agent;
let admin: Agent;
let projectId: number;
let pablo: number;
let paula: number;
let periods: Period[];

const periodId = (startDate: string) => periods.find((p) => p.startDate === startDate)!.id;

async function accrue(startDate: string) {
  await generator.post('/api/accruals/generate').send({ periodId: periodId(startDate), projectId }).expect(201);
}

async function createRequest() {
  return (await generator.post('/api/payment-requests').send({ projectId }).expect(201)).body.paymentRequest;
}

async function approved() {
  const request = await createRequest();
  await generator.post(`/api/payment-requests/${request.id}/submit`).expect(200);
  await receiver.post(`/api/payment-requests/${request.id}/approve`).send({}).expect(200);
  return request;
}

beforeAll(async () => {
  generator = await loginAs('generador@example.com');
  receiver = await loginAs('receptor@example.com');
  admin = await loginAs('admin@example.com');

  const areas = (await generator.get('/api/areas').expect(200)).body.areas;
  const chemistryId = areas.find((area: { name: string }) => area.name === 'Química').id;
  const groups = (await generator.get('/api/payment-groups').expect(200)).body.paymentGroups;
  const biweeklyId = groups.find((group: { name: string }) => group.name === 'Quincenal').id;
  periods = (await generator.get(`/api/payment-groups/${biweeklyId}/periods`).expect(200)).body.periods;

  projectId = (
    await generator
      .post('/api/projects')
      .send({ code: 'TST-PAG-001', name: 'Proyecto pagos', areaId: chemistryId, scope: 'EXTERNAL', startDate: '2026-01-01', endDate: '2026-12-31' })
      .expect(201)
  ).body.project.id;

  pablo = (await generator.post('/api/people').send({ idNumber: 'V-40200001', name: 'Pablo Pagos' }).expect(201)).body.person.id;
  paula = (await generator.post('/api/people').send({ idNumber: 'V-40200002', name: 'Paula Pagos' }).expect(201)).body.person.id;

  for (const [personId, amountCents] of [
    [pablo, 20_000],
    [paula, 30_000],
  ]) {
    await generator
      .post('/api/assignments')
      .send({ personId, projectId, paymentGroupId: biweeklyId, amountCents, startDate: '2026-01-01' })
      .expect(201);
  }

  await accrue('2026-01-01');
  await accrue('2026-01-16');
});

describe('ciclo completo con pagos parciales FIFO', () => {
  let requestId: number;

  it('solo el generador crea solicitudes', async () => {
    await receiver.post('/api/payment-requests').send({ projectId }).expect(403);
    await admin.get('/api/payment-requests').expect(403);
  });

  it('crea la solicitud con toda la deuda pendiente del proyecto', async () => {
    const request = await createRequest();
    requestId = request.id;
    expect(request).toMatchObject({ status: 'DRAFT', requestedCents: 100_000, paidCents: 0, outstandingCents: 100_000, personCount: 2 });
    expect(request.items).toHaveLength(4);
  });

  it('una causación en una solicitud abierta no entra en otra ni se anula', async () => {
    const again = await generator.post('/api/payment-requests').send({ projectId }).expect(409);
    expect(again.body.error.code).toBe('NOTHING_TO_REQUEST');

    const request = (await generator.get(`/api/payment-requests/${requestId}`).expect(200)).body.paymentRequest;
    const annul = await generator.post(`/api/accruals/${request.items[0].accrualId}/annul`).send({ reason: 'Intento de anular' }).expect(409);
    expect(annul.body.error.code).toBe('ACCRUAL_IN_REQUEST');

    const explicit = await generator
      .post('/api/payment-requests')
      .send({ projectId, accrualIds: [request.items[0].accrualId] })
      .expect(409);
    expect(explicit.body.error.code).toBe('ACCRUAL_IN_REQUEST');
  });

  it('respeta el orden de estados y la segregación de funciones', async () => {
    await receiver.post(`/api/payment-requests/${requestId}/approve`).send({}).expect(409);
    await receiver.post(`/api/payment-requests/${requestId}/payments`).send({ payments: [{ personId: pablo, amountCents: 100 }] }).expect(409);
    await receiver.post(`/api/payment-requests/${requestId}/submit`).expect(403);

    const submitted = await generator.post(`/api/payment-requests/${requestId}/submit`).expect(200);
    expect(submitted.body.paymentRequest.status).toBe('SUBMITTED');
    expect(submitted.body.paymentRequest.submittedAt).toBeTruthy();
    await generator.post(`/api/payment-requests/${requestId}/submit`).expect(409);

    await generator.post(`/api/payment-requests/${requestId}/approve`).send({}).expect(403);
    const approvedRes = await receiver.post(`/api/payment-requests/${requestId}/approve`).send({ note: 'Conforme' }).expect(200);
    expect(approvedRes.body.paymentRequest).toMatchObject({ status: 'APPROVED', decisionNote: 'Conforme', decidedBy: { name: 'Rosa Gerente' } });
  });

  it('aplica un pago parcial a la deuda más antigua primero', async () => {
    await generator.post(`/api/payment-requests/${requestId}/payments`).send({ payments: [{ personId: pablo, amountCents: 100 }] }).expect(403);

    const res = await receiver
      .post(`/api/payment-requests/${requestId}/payments`)
      .send({ paidOn: '2026-02-05', reference: 'Efectivo', payments: [{ personId: pablo, amountCents: 25_000 }] })
      .expect(201);

    const items: Item[] = res.body.paymentRequest.items.filter((item: Item) => item.person.id === pablo);
    const first = items.find((item) => item.period.startDate === '2026-01-01')!;
    const second = items.find((item) => item.period.startDate === '2026-01-16')!;
    expect(first).toMatchObject({ paidCents: 20_000, outstandingCents: 0 });
    expect(second).toMatchObject({ paidCents: 5_000, outstandingCents: 15_000 });
    expect(res.body.paymentRequest).toMatchObject({ paidCents: 25_000, outstandingCents: 75_000 });

    const accruals = (await generator.get('/api/accruals').query({ projectId, personId: pablo }).expect(200)).body.accruals;
    expect(accruals.map((a: { status: string }) => a.status).sort()).toEqual(['PAID', 'PARTIAL']);
  });

  it('rechaza pagos inválidos', async () => {
    const exceeds = await receiver
      .post(`/api/payment-requests/${requestId}/payments`)
      .send({ payments: [{ personId: paula, amountCents: 60_001 }] })
      .expect(409);
    expect(exceeds.body.error.code).toBe('AMOUNT_EXCEEDS_DEBT');

    await receiver
      .post(`/api/payment-requests/${requestId}/payments`)
      .send({ paidOn: '2099-01-01', payments: [{ personId: paula, amountCents: 100 }] })
      .expect(400);
    await receiver
      .post(`/api/payment-requests/${requestId}/payments`)
      .send({ payments: [{ personId: 999_999, amountCents: 100 }] })
      .expect(400);
    await receiver
      .post(`/api/payment-requests/${requestId}/payments`)
      .send({ payments: [{ personId: paula, amountCents: 100 }, { personId: paula, amountCents: 100 }] })
      .expect(400);
    await receiver.post(`/api/payment-requests/${requestId}/payments`).send({ payments: [{ personId: paula, amountCents: 0 }] }).expect(400);
  });

  it('una causación con pagos no se anula', async () => {
    const paid = (await generator.get('/api/accruals').query({ projectId, personId: pablo, status: 'PAID' }).expect(200)).body.accruals[0];
    const res = await generator.post(`/api/accruals/${paid.id}/annul`).send({ reason: 'Intento de anular' }).expect(409);
    expect(res.body.error.code).toBe('ACCRUAL_HAS_PAYMENTS');
  });

  it('anular un pago devuelve su monto a la deuda', async () => {
    const [payment] = (await receiver.get('/api/payments').query({ requestId, personId: pablo }).expect(200)).body.payments;
    expect(payment).toMatchObject({ amountCents: 25_000, paidOn: '2026-02-05', reference: 'Efectivo' });
    expect(payment.allocations).toHaveLength(2);

    await generator.post(`/api/payments/${payment.id}/annul`).send({ reason: 'Recibo duplicado' }).expect(403);
    await receiver.post(`/api/payments/${payment.id}/annul`).send({ reason: 'x' }).expect(400);
    const res = await receiver.post(`/api/payments/${payment.id}/annul`).send({ reason: 'Recibo duplicado' }).expect(200);
    expect(res.body.payment).toMatchObject({ annulmentReason: 'Recibo duplicado', annulledBy: { name: 'Rosa Gerente' } });
    await receiver.post(`/api/payments/${payment.id}/annul`).send({ reason: 'Recibo duplicado' }).expect(409);

    const request = (await receiver.get(`/api/payment-requests/${requestId}`).expect(200)).body.paymentRequest;
    expect(request).toMatchObject({ paidCents: 0, outstandingCents: 100_000 });
  });

  it('registra varios pagos a la vez y cierra la solicitud', async () => {
    const res = await receiver
      .post(`/api/payment-requests/${requestId}/payments`)
      .send({ payments: [{ personId: pablo, amountCents: 40_000 }, { personId: paula, amountCents: 60_000 }] })
      .expect(201);
    expect(res.body.paymentRequest).toMatchObject({ paidCents: 100_000, outstandingCents: 0 });
    expect(res.body.paymentRequest.people).toHaveLength(2);

    await generator.post(`/api/payment-requests/${requestId}/close`).send({}).expect(403);
    const closed = await receiver.post(`/api/payment-requests/${requestId}/close`).send({}).expect(200);
    expect(closed.body.paymentRequest).toMatchObject({ status: 'CLOSED', closedBy: { name: 'Rosa Gerente' } });
    await receiver.post(`/api/payment-requests/${requestId}/close`).send({}).expect(409);
    await receiver.post(`/api/payment-requests/${requestId}/payments`).send({ payments: [{ personId: pablo, amountCents: 1 }] }).expect(409);
  });

  it('deja rastro en la auditoría', async () => {
    const entries = (await admin.get('/api/audit-log').query({ entity: 'PaymentRequest', entityId: String(requestId) }).expect(200)).body
      .entries;
    expect(entries.length).toBeGreaterThanOrEqual(4); // creación, envío, aprobación y cierre
  });
});

describe('cierre con saldo, rechazo y cancelación', () => {
  it('cerrar con saldo exige motivo y el saldo vuelve a la deuda', async () => {
    await accrue('2026-02-01');
    const request = await approved();
    expect(request.requestedCents).toBe(50_000);

    await receiver.post(`/api/payment-requests/${request.id}/payments`).send({ payments: [{ personId: pablo, amountCents: 5_000 }] }).expect(201);

    const noNote = await receiver.post(`/api/payment-requests/${request.id}/close`).send({}).expect(400);
    expect(noNote.body.error.code).toBe('CLOSING_NOTE_REQUIRED');
    await receiver.post(`/api/payment-requests/${request.id}/close`).send({ note: 'Fondos insuficientes este mes' }).expect(200);

    const next = await createRequest();
    const byPerson = Object.fromEntries(next.people.map((p: { person: { id: number } }) => [p.person.id, p]));
    expect(byPerson[pablo].requestedCents).toBe(15_000);
    expect(byPerson[paula].requestedCents).toBe(30_000);
    await generator.post(`/api/payment-requests/${next.id}/cancel`).expect(200);
  });

  it('rechazar exige motivo y libera las causaciones', async () => {
    const request = await createRequest();
    await generator.post(`/api/payment-requests/${request.id}/submit`).expect(200);
    await receiver.post(`/api/payment-requests/${request.id}/reject`).send({}).expect(400);
    const rejected = await receiver.post(`/api/payment-requests/${request.id}/reject`).send({ reason: 'Falta soporte' }).expect(200);
    expect(rejected.body.paymentRequest).toMatchObject({ status: 'REJECTED', decisionNote: 'Falta soporte' });
    await generator.post(`/api/payment-requests/${request.id}/cancel`).expect(409);

    const again = await createRequest();
    expect(again.requestedCents).toBe(45_000);
    await generator.post(`/api/payment-requests/${again.id}/cancel`).expect(200);
  });

  it('el generador puede cancelar una solicitud enviada mientras no se decida', async () => {
    const request = await createRequest();
    await generator.post(`/api/payment-requests/${request.id}/submit`).expect(200);
    const cancelled = await generator.post(`/api/payment-requests/${request.id}/cancel`).expect(200);
    expect(cancelled.body.paymentRequest.status).toBe('CANCELLED');
    await receiver.post(`/api/payment-requests/${request.id}/approve`).send({}).expect(409);
  });

  it('solo acepta causaciones del proyecto', async () => {
    // Causa un proyecto del seed; si otra prueba ya lo causó, responde 409 y sirve igual.
    const fis = (await generator.get('/api/projects').expect(200)).body.projects.find((p: { code: string }) => p.code === 'FIS-001');
    const res0 = await generator.post('/api/accruals/generate').send({ periodId: periodId('2026-01-01'), projectId: fis.id });
    expect([201, 409]).toContain(res0.status);

    const foreign = await prisma.accrual.findFirstOrThrow({ where: { projectId: { not: projectId }, annulledAt: null } });
    const res = await generator.post('/api/payment-requests').send({ projectId, accrualIds: [foreign.id] }).expect(400);
    expect(res.body.error.code).toBe('INVALID_ACCRUALS');
  });

  it('filtra por estado', async () => {
    const closed = (await receiver.get('/api/payment-requests').query({ projectId, status: 'CLOSED' }).expect(200)).body.paymentRequests;
    expect(closed).toHaveLength(2);
    await receiver.get('/api/payment-requests').query({ status: 'OTRO' }).expect(400);
    await receiver.get('/api/payment-requests/999999').expect(404);
  });
});

describe('inmutabilidad de pagos', () => {
  it('no se modifican ni se borran pagos, aplicaciones ni renglones', async () => {
    const payment = await prisma.payment.findFirstOrThrow({ where: { request: { projectId } } });
    await expect(prisma.payment.update({ where: { id: payment.id }, data: { amountCents: 1 } })).rejects.toThrow();
    await expect(prisma.payment.delete({ where: { id: payment.id } })).rejects.toThrow();

    const allocation = await prisma.paymentAllocation.findFirstOrThrow({ where: { paymentId: payment.id } });
    await expect(prisma.paymentAllocation.update({ where: { id: allocation.id }, data: { amountCents: 1 } })).rejects.toThrow();
    await expect(prisma.paymentAllocation.delete({ where: { id: allocation.id } })).rejects.toThrow();

    const item = await prisma.paymentRequestItem.findFirstOrThrow({ where: { request: { projectId } } });
    await expect(prisma.paymentRequestItem.delete({ where: { id: item.id } })).rejects.toThrow();
  });

  it('una solicitud cerrada no cambia de estado', async () => {
    const closed = await prisma.paymentRequest.findFirstOrThrow({ where: { projectId, status: 'CLOSED' } });
    await expect(prisma.paymentRequest.update({ where: { id: closed.id }, data: { status: 'APPROVED' } })).rejects.toThrow();
    await expect(prisma.paymentRequest.delete({ where: { id: closed.id } })).rejects.toThrow();
  });
});
