import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { loginAs } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>;

let generator: Agent;
let receiver: Agent;
let admin: Agent;
let projectId: number;
let otherProjectId: number;
let fundId: number;

// Meses relativos a hoy para que las pruebas no dependan de la fecha en que corren.
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Caracas' });
const currentIndex = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
const month = (offset: number) => {
  const index = currentIndex + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

function requestVoucher(amountCents: number, concept = 'Materiales de laboratorio') {
  return generator.post(`/api/petty-cash/funds/${fundId}/vouchers`).send({ concept, beneficiary: 'Ferretería El Tornillo', amountCents });
}

beforeAll(async () => {
  generator = await loginAs('generador@example.com');
  receiver = await loginAs('receptor@example.com');
  admin = await loginAs('admin@example.com');

  const areas = (await generator.get('/api/areas').expect(200)).body.areas;
  const biologyId = areas.find((area: { name: string }) => area.name === 'Biología').id;
  const createProject = async (code: string) =>
    (
      await generator
        .post('/api/projects')
        .send({ code, name: `Proyecto ${code}`, areaId: biologyId, scope: 'INTERNAL', startDate: '2026-01-01', endDate: '2030-12-31' })
        .expect(201)
    ).body.project.id as number;

  projectId = await createProject('TST-CCH-001');
  otherProjectId = await createProject('TST-CCH-002');
});

describe('cajas', () => {
  it('solo el receptor las crea; el generador las consulta; el administrador no participa', async () => {
    await generator.post('/api/petty-cash/funds').send({ name: 'Caja Biología', projectId }).expect(403);
    await admin.get('/api/petty-cash/funds').expect(403);

    const res = await receiver.post('/api/petty-cash/funds').send({ name: 'Caja Biología', projectId }).expect(201);
    fundId = res.body.fund.id;
    expect(res.body.fund).toMatchObject({ project: { code: 'TST-CCH-001' }, active: true, openPeriod: null });

    const funds = (await generator.get('/api/petty-cash/funds').expect(200)).body.funds;
    expect(funds.some((fund: { id: number }) => fund.id === fundId)).toBe(true);
  });

  it('no repite nombres aunque cambien mayúsculas o acentos', async () => {
    await receiver.post('/api/petty-cash/funds').send({ name: 'caja biologia', projectId }).expect(409);
  });

  it('se reasigna a otro proyecto desde la interfaz', async () => {
    const res = await receiver.patch(`/api/petty-cash/funds/${fundId}`).send({ projectId: otherProjectId }).expect(200);
    expect(res.body.fund.project.code).toBe('TST-CCH-002');
    await receiver.patch(`/api/petty-cash/funds/${fundId}`).send({ projectId }).expect(200);
    await receiver.patch(`/api/petty-cash/funds/${fundId}`).send({ projectId: 999_999 }).expect(400);
  });
});

describe('ciclo mensual', () => {
  let periodId: number;
  let first: number;
  let second: number;

  it('no hay vales sin un mes abierto', async () => {
    const res = await requestVoucher(1_000).expect(409);
    expect(res.body.error.code).toBe('NO_OPEN_PERIOD');
  });

  it('la primera apertura necesita mes y monto inicial, y no puede ser futura', async () => {
    await generator.post(`/api/petty-cash/funds/${fundId}/periods`).send({ ...month(-2), replenishmentCents: 50_000 }).expect(403);
    await receiver.post(`/api/petty-cash/funds/${fundId}/periods`).send({ replenishmentCents: 50_000 }).expect(400);
    await receiver.post(`/api/petty-cash/funds/${fundId}/periods`).send({ ...month(-2), replenishmentCents: 0 }).expect(400);
    const future = await receiver.post(`/api/petty-cash/funds/${fundId}/periods`).send({ ...month(1), replenishmentCents: 50_000 }).expect(409);
    expect(future.body.error.code).toBe('FUTURE_MONTH');
  });

  it('abre el mes con el monto inicial', async () => {
    const res = await receiver.post(`/api/petty-cash/funds/${fundId}/periods`).send({ ...month(-2), replenishmentCents: 50_000 }).expect(201);
    periodId = res.body.period.id;
    expect(res.body.period).toMatchObject({ status: 'OPEN', openingBalanceCents: 0, fundsCents: 50_000, availableCents: 50_000 });

    const again = await receiver.post(`/api/petty-cash/funds/${fundId}/periods`).send({ replenishmentCents: 1_000 }).expect(409);
    expect(again.body.error.code).toBe('PERIOD_ALREADY_OPEN');
  });

  it('solicita y aprueba vales dentro del saldo disponible', async () => {
    const res = await requestVoucher(20_000).expect(201);
    first = res.body.voucher.id;
    expect(res.body.voucher).toMatchObject({ status: 'REQUESTED', requestedBy: { name: 'Gabriel Coordinador' } });

    const tooMuch = await requestVoucher(60_000).expect(409);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_FUNDS');

    await generator.post(`/api/petty-cash/vouchers/${first}/approve`).expect(403);
    const approvedRes = await receiver.post(`/api/petty-cash/vouchers/${first}/approve`).expect(200);
    expect(approvedRes.body.voucher).toMatchObject({ status: 'APPROVED', decidedBy: { name: 'Rosa Gerente' } });

    // Lo aprobado queda reservado: quedan 300,00.
    await requestVoucher(40_000).expect(409);
    second = (await requestVoucher(30_000).expect(201)).body.voucher.id;
  });

  it('no aprueba un vale si el saldo ya no alcanza', async () => {
    // Se pide cuando hay saldo, pero otro vale se aprueba primero y consume lo disponible.
    const third = (await requestVoucher(10_000).expect(201)).body.voucher.id;
    await receiver.post(`/api/petty-cash/vouchers/${second}/approve`).expect(200);
    const res = await receiver.post(`/api/petty-cash/vouchers/${third}/approve`).expect(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    await requestVoucher(100).expect(409);
    await generator.post(`/api/petty-cash/vouchers/${third}/cancel`).expect(200);
  });

  it('desembolsa y rinde con comprobante; lo no gastado vuelve a la caja', async () => {
    await receiver.post(`/api/petty-cash/vouchers/${first}/settle`).send({ spentCents: 1, receiptReference: 'F-1', receiptDate: today }).expect(403);
    await generator.post(`/api/petty-cash/vouchers/${first}/settle`).send({ spentCents: 1, receiptReference: 'F-1', receiptDate: today }).expect(409);

    await generator.post(`/api/petty-cash/vouchers/${first}/disburse`).expect(403);
    const disbursed = await receiver.post(`/api/petty-cash/vouchers/${first}/disburse`).expect(200);
    expect(disbursed.body.voucher.status).toBe('DISBURSED');

    await generator
      .post(`/api/petty-cash/vouchers/${first}/settle`)
      .send({ spentCents: 20_001, receiptReference: 'F-0001', receiptDate: today })
      .expect(400);
    await generator
      .post(`/api/petty-cash/vouchers/${first}/settle`)
      .send({ spentCents: 15_000, receiptReference: '', receiptDate: today })
      .expect(400);
    await generator
      .post(`/api/petty-cash/vouchers/${first}/settle`)
      .send({ spentCents: 15_000, receiptReference: 'F-0001', receiptDate: '2099-01-01' })
      .expect(400);

    const settled = await generator
      .post(`/api/petty-cash/vouchers/${first}/settle`)
      .send({ spentCents: 15_000, receiptReference: 'F-0001', receiptDate: today })
      .expect(200);
    expect(settled.body.voucher).toMatchObject({ status: 'SETTLED', spentCents: 15_000, returnedCents: 5_000, receiptReference: 'F-0001' });
  });

  it('no cierra el mes con vales pendientes', async () => {
    const res = await receiver.post(`/api/petty-cash/periods/${periodId}/close`).expect(409);
    expect(res.body.error.code).toBe('PENDING_VOUCHERS');

    await receiver.post(`/api/petty-cash/vouchers/${second}/disburse`).expect(200);
    await generator
      .post(`/api/petty-cash/vouchers/${second}/settle`)
      .send({ spentCents: 30_000, receiptReference: 'F-0002', receiptDate: today })
      .expect(200);
  });

  it('cancela y rechaza vales solicitados', async () => {
    const toCancel = (await requestVoucher(1_000).expect(201)).body.voucher.id;
    await receiver.post(`/api/petty-cash/vouchers/${toCancel}/cancel`).expect(403);
    await generator.post(`/api/petty-cash/vouchers/${toCancel}/cancel`).expect(200);
    await receiver.post(`/api/petty-cash/vouchers/${toCancel}/approve`).expect(409);

    const toReject = (await requestVoucher(2_000).expect(201)).body.voucher.id;
    await receiver.post(`/api/petty-cash/vouchers/${toReject}/reject`).send({}).expect(400);
    const rejected = await receiver.post(`/api/petty-cash/vouchers/${toReject}/reject`).send({ reason: 'No es un gasto del proyecto' }).expect(200);
    expect(rejected.body.voucher).toMatchObject({ status: 'REJECTED', rejectionReason: 'No es un gasto del proyecto' });
  });

  it('cierra el mes con el saldo final y lo arrastra al siguiente', async () => {
    await generator.post(`/api/petty-cash/periods/${periodId}/close`).expect(403);
    const closed = await receiver.post(`/api/petty-cash/periods/${periodId}/close`).expect(200);
    // 500,00 − 150,00 − 300,00 = 50,00
    expect(closed.body.period).toMatchObject({ status: 'CLOSED', closingBalanceCents: 5_000, spentCents: 45_000 });
    await receiver.post(`/api/petty-cash/periods/${periodId}/close`).expect(409);

    const skip = await receiver.post(`/api/petty-cash/funds/${fundId}/periods`).send({ ...month(0), replenishmentCents: 10_000 }).expect(409);
    expect(skip.body.error.code).toBe('NON_CONSECUTIVE_MONTH');

    const next = await receiver.post(`/api/petty-cash/funds/${fundId}/periods`).send({ replenishmentCents: 10_000 }).expect(201);
    expect(next.body.period).toMatchObject({ ...month(-1), openingBalanceCents: 5_000, fundsCents: 15_000, availableCents: 15_000 });

    const periods = (await generator.get(`/api/petty-cash/funds/${fundId}/periods`).expect(200)).body.periods;
    expect(periods).toHaveLength(2);
  });

  it('lista vales por caja, mes y estado', async () => {
    const settled = (await generator.get('/api/petty-cash/vouchers').query({ fundId, status: 'SETTLED' }).expect(200)).body.vouchers;
    expect(settled).toHaveLength(2);
    const ofPeriod = (await generator.get('/api/petty-cash/vouchers').query({ periodId }).expect(200)).body.vouchers;
    expect(ofPeriod).toHaveLength(5);
  });

  it('no desactiva una caja con un mes abierto', async () => {
    const res = await receiver.patch(`/api/petty-cash/funds/${fundId}`).send({ active: false }).expect(409);
    expect(res.body.error.code).toBe('PETTY_CASH_FUND_HAS_OPEN_PERIOD');
  });

  it('deja rastro en la auditoría', async () => {
    const entries = (await admin.get('/api/audit-log').query({ entity: 'PettyCashPeriod', entityId: String(periodId) }).expect(200)).body
      .entries;
    expect(entries).toHaveLength(2); // apertura y cierre
  });
});

describe('inmutabilidad de cajas chicas', () => {
  it('no se borran vales ni meses, y los finalizados no cambian', async () => {
    const settled = await prisma.pettyCashVoucher.findFirstOrThrow({ where: { fundId, status: 'SETTLED' } });
    await expect(prisma.pettyCashVoucher.update({ where: { id: settled.id }, data: { spentCents: 1 } })).rejects.toThrow();
    await expect(prisma.pettyCashVoucher.delete({ where: { id: settled.id } })).rejects.toThrow();

    const closed = await prisma.pettyCashPeriod.findFirstOrThrow({ where: { fundId, status: 'CLOSED' } });
    await expect(prisma.pettyCashPeriod.update({ where: { id: closed.id }, data: { closingBalanceCents: 1 } })).rejects.toThrow();
    await expect(prisma.pettyCashPeriod.delete({ where: { id: closed.id } })).rejects.toThrow();
    await expect(prisma.pettyCashFund.delete({ where: { id: fundId } })).rejects.toThrow();
  });
});
