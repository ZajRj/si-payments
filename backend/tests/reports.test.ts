import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { amountInWords } from '../src/modules/reports/amount-in-words.js';
import { app, loginAs } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>;
type Period = { id: number; startDate: string };

let generator: Agent;
let receiver: Agent;
let admin: Agent;
let projectId: number;
let rita: number;
let ramon: number;
let requestId: number;
let ritaPayment: number;
let annulledPayment: number;

// Lee el cuerpo binario de un PDF como Buffer.
function binary(res: request.Response, callback: (error: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function getPdf(agent: Agent, path: string) {
  const res = await agent.get(path).buffer(true).parse(binary).expect(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  return res;
}

beforeAll(async () => {
  generator = await loginAs('generador@example.com');
  receiver = await loginAs('receptor@example.com');
  admin = await loginAs('admin@example.com');

  const areas = (await generator.get('/api/areas').expect(200)).body.areas;
  const biologyId = areas.find((area: { name: string }) => area.name === 'Biología').id;
  const groups = (await generator.get('/api/payment-groups').expect(200)).body.paymentGroups;
  const biweeklyId = groups.find((group: { name: string }) => group.name === 'Quincenal').id;
  const periods: Period[] = (await generator.get(`/api/payment-groups/${biweeklyId}/periods`).expect(200)).body.periods;

  projectId = (
    await generator
      .post('/api/projects')
      .send({ code: 'TST-REP-001', name: 'Proyecto reportes', areaId: biologyId, scope: 'INTERNAL', startDate: '2026-01-01', endDate: '2026-12-31' })
      .expect(201)
  ).body.project.id;

  rita = (await generator.post('/api/people').send({ idNumber: 'V-40300001', name: 'Rita Reportes' }).expect(201)).body.person.id;
  ramon = (await generator.post('/api/people').send({ idNumber: 'V-40300002', name: 'Ramón Reportes' }).expect(201)).body.person.id;

  for (const [personId, amountCents] of [
    [rita, 20_000],
    [ramon, 30_000],
  ]) {
    await generator
      .post('/api/assignments')
      .send({ personId, projectId, paymentGroupId: biweeklyId, amountCents, startDate: '2026-01-01' })
      .expect(201);
  }

  for (const startDate of ['2026-01-01', '2026-01-16']) {
    const periodId = periods.find((p) => p.startDate === startDate)!.id;
    await generator.post('/api/accruals/generate').send({ periodId, projectId }).expect(201);
  }

  requestId = (await generator.post('/api/payment-requests').send({ projectId }).expect(201)).body.paymentRequest.id;
  await generator.post(`/api/payment-requests/${requestId}/submit`).expect(200);
  await receiver.post(`/api/payment-requests/${requestId}/approve`).send({}).expect(200);

  const pay = async (paidOn: string, personId: number, amountCents: number) => {
    const res = await receiver
      .post(`/api/payment-requests/${requestId}/payments`)
      .send({ paidOn, reference: 'Efectivo', payments: [{ personId, amountCents }] })
      .expect(201);
    return res.body.paymentRequest.payments.at(-1).id as number;
  };

  // Rita: 25.000 de 40.000. Ramón: un pago anulado y luego todo lo suyo.
  ritaPayment = await pay('2026-02-05', rita, 25_000);
  annulledPayment = await pay('2026-02-06', ramon, 10_000);
  await receiver.post(`/api/payments/${annulledPayment}/annul`).send({ reason: 'Monto equivocado' }).expect(200);
  await pay('2026-02-10', ramon, 60_000);
});

describe('monto en letras', () => {
  it.each([
    [0, 'CERO DÓLARES CON 00/100'],
    [100, 'UN DÓLAR CON 00/100'],
    [15_050, 'CIENTO CINCUENTA DÓLARES CON 50/100'],
    [10_000, 'CIEN DÓLARES CON 00/100'],
    [2_100, 'VEINTIÚN DÓLARES CON 00/100'],
    [3_101, 'TREINTA Y UN DÓLARES CON 01/100'],
    [2_100_000, 'VEINTIÚN MIL DÓLARES CON 00/100'],
    [123_456_789, 'UN MILLÓN DOSCIENTOS TREINTA Y CUATRO MIL QUINIENTOS SESENTA Y SIETE DÓLARES CON 89/100'],
    [100_000_000, 'UN MILLÓN DE DÓLARES CON 00/100'],
    [71_500_000, 'SETECIENTOS QUINCE MIL DÓLARES CON 00/100'],
  ])('%i centavos', (cents, words) => {
    expect(amountInWords(cents)).toBe(words);
  });
});

describe('permisos', () => {
  it('el administrador no ve reportes de dinero ni PDFs', async () => {
    await admin.get('/api/reports/balances').expect(403);
    await admin.get(`/api/reports/payments/${ritaPayment}/receipt`).expect(403);
    await admin.get(`/api/reports/payment-requests/${requestId}/consolidated`).expect(403);
  });

  it('exige sesión', async () => {
    await request(app).get('/api/reports/balances').expect(401);
  });
});

describe('saldos', () => {
  it('causado, pagado y adeudado por persona', async () => {
    const { body } = await receiver.get(`/api/reports/balances?groupBy=person&projectId=${projectId}`).expect(200);
    expect(body.rows.map((row: { person: { name: string } }) => row.person.name)).toEqual(['Ramón Reportes', 'Rita Reportes']);
    expect(body.rows[0]).toMatchObject({ accruedCents: 60_000, paidCents: 60_000, owedCents: 0, accrualCount: 2 });
    expect(body.rows[1]).toMatchObject({ accruedCents: 40_000, paidCents: 25_000, owedCents: 15_000, accrualCount: 2 });
    expect(body.totals).toEqual({ accruedCents: 100_000, paidCents: 85_000, owedCents: 15_000, accrualCount: 4 });
  });

  it('por proyecto', async () => {
    const { body } = await generator.get(`/api/reports/balances?groupBy=project&projectId=${projectId}`).expect(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ project: { code: 'TST-REP-001', area: { name: 'Biología' } }, owedCents: 15_000 });
  });

  it('filtra por la fecha de fin del período', async () => {
    const { body } = await generator
      .get(`/api/reports/balances?projectId=${projectId}&from=2026-01-16&to=2026-01-31`)
      .expect(200);
    // FIFO: de los 25.000 de Rita, 20.000 cubrieron la primera quincena y 5.000 la segunda.
    expect(body.totals).toEqual({ accruedCents: 50_000, paidCents: 35_000, owedCents: 15_000, accrualCount: 2 });
  });

  it('valida el rango y los parámetros', async () => {
    const range = await generator.get('/api/reports/balances?from=2026-02-01&to=2026-01-01').expect(400);
    expect(range.body.error.code).toBe('INVALID_RANGE');
    await generator.get('/api/reports/balances?groupBy=area').expect(400);
    await generator.get('/api/reports/balances?from=2026-02-30').expect(400);
  });
});

describe('pagos', () => {
  it('lista los pagos del proyecto; los anulados no suman', async () => {
    const { body } = await receiver.get(`/api/reports/payments?projectId=${projectId}`).expect(200);
    expect(body.payments.map((p: { paidOn: string }) => p.paidOn)).toEqual(['2026-02-05', '2026-02-06', '2026-02-10']);
    expect(body.payments[0]).toMatchObject({ person: { name: 'Rita Reportes' }, project: { code: 'TST-REP-001' }, requestId });
    expect(body.totals).toEqual({ paymentCount: 2, amountCents: 85_000, annulledCount: 1 });
  });

  it('filtra por la fecha de entrega y la persona', async () => {
    const day = await receiver.get(`/api/reports/payments?projectId=${projectId}&from=2026-02-06&to=2026-02-06`).expect(200);
    expect(day.body.totals).toEqual({ paymentCount: 0, amountCents: 0, annulledCount: 1 });

    const person = await receiver.get(`/api/reports/payments?personId=${rita}`).expect(200);
    expect(person.body.totals).toMatchObject({ paymentCount: 1, amountCents: 25_000 });
  });
});

describe('estado de cuenta', () => {
  it('detalla causaciones y pagos de la persona', async () => {
    const { body } = await generator.get(`/api/reports/people/${rita}/statement`).expect(200);
    expect(body.person).toMatchObject({ idNumber: 'V-40300001', name: 'Rita Reportes' });
    expect(body.accruals.map((a: { status: string; owedCents: number }) => [a.status, a.owedCents])).toEqual([
      ['PAID', 0],
      ['PARTIAL', 15_000],
    ]);
    expect(body.payments).toHaveLength(1);
    expect(body.totals).toEqual({ accruedCents: 40_000, paidCents: 25_000, owedCents: 15_000, accrualCount: 2 });
  });

  it('404 si la persona no existe', async () => {
    const res = await generator.get('/api/reports/people/999999/statement').expect(404);
    expect(res.body.error.code).toBe('PERSON_NOT_FOUND');
  });
});

describe('PDFs', () => {
  it('recibo individual, vigente o anulado', async () => {
    const res = await getPdf(receiver, `/api/reports/payments/${ritaPayment}/receipt`);
    expect(res.headers['content-disposition']).toBe(`inline; filename="recibo-${String(ritaPayment).padStart(6, '0')}.pdf"`);
    await getPdf(generator, `/api/reports/payments/${annulledPayment}/receipt`);
  });

  it('solicitud consolidada', async () => {
    const res = await getPdf(generator, `/api/reports/payment-requests/${requestId}/consolidated`);
    expect(res.headers['content-disposition']).toContain('solicitud-');
  });

  it('404 si el documento no existe', async () => {
    const payment = await receiver.get('/api/reports/payments/999999/receipt').expect(404);
    expect(payment.body.error.code).toBe('PAYMENT_NOT_FOUND');
    const paymentRequest = await receiver.get('/api/reports/payment-requests/999999/consolidated').expect(404);
    expect(paymentRequest.body.error.code).toBe('PAYMENT_REQUEST_NOT_FOUND');
  });
});
