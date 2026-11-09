import { businessToday, parseDateOnly } from '../lib/dates.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { annulAccrual, generateAccruals } from '../modules/accruals/accruals.service.js';
import {
  annulPayment,
  approveRequest,
  cancelRequest,
  closeRequest,
  createRequest,
  getRequest,
  registerPayments,
  rejectRequest,
  submitRequest,
} from '../modules/payment-requests/payment-requests.service.js';
import {
  approveVoucher,
  cancelVoucher,
  closePeriod,
  createFund,
  disburseVoucher,
  openPeriod,
  rejectVoucher,
  requestVoucher,
  settleVoucher,
} from '../modules/petty-cash/petty-cash.service.js';

// Movimientos financieros de demostración: causaciones, solicitudes en todos sus estados, pagos
// (parciales y anulados) y cajas chicas con varios meses. Se hacen con los servicios de la aplicación,
// así que pasan por las mismas validaciones y quedan en audit_log a nombre de los usuarios de prueba.
// Ninguna fecha queda en el futuro: lo que todavía no ocurrió según la fecha de hoy se omite.

type Request = Awaited<ReturnType<typeof createRequest>>;

const today = () => businessToday();
const date = (value: string) => parseDateOnly(value)!;
const notFuture = (value: string) => {
  const d = date(value);
  return d.getTime() > today().getTime() ? today() : d;
};

async function userId(email: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
}

async function projectId(code: string) {
  return (await prisma.project.findUniqueOrThrow({ where: { code } })).id;
}

// Causa todos los períodos que cierran hasta `until` (y no después de hoy) que falten.
async function accrueUntil(actorId: number, until: string) {
  const limit = notFuture(until);
  const periods = await prisma.period.findMany({ where: { endDate: { lte: limit } }, orderBy: [{ endDate: 'asc' }, { id: 'asc' }] });
  for (const period of periods) {
    try {
      await generateAccruals(actorId, { periodId: period.id });
    } catch (error) {
      if (!(error instanceof HttpError && error.code === 'NOTHING_TO_ACCRUE')) throw error;
    }
  }
}

// Solicitud con toda la deuda pendiente del proyecto, o null si no hay nada que pedir.
async function newRequest(generator: number, code: string, notes: string): Promise<Request | null> {
  try {
    return await createRequest(generator, { projectId: await projectId(code), notes });
  } catch (error) {
    if (error instanceof HttpError && error.code === 'NOTHING_TO_REQUEST') return null;
    throw error;
  }
}

async function approved(generator: number, receiver: number, code: string, notes: string) {
  const request = await newRequest(generator, code, notes);
  if (!request) return null;
  await submitRequest(generator, request.id);
  return approveRequest(receiver, request.id, 'Conforme con el presupuesto del proyecto');
}

// Paga a cada persona la fracción indicada de lo que tiene pendiente en la solicitud.
async function pay(receiver: number, request: Request, paidOn: string, share = 1, reference = 'Transferencia') {
  const payments = request.people
    .map(({ person, outstandingCents }) => ({ personId: person.id, amountCents: Math.round(outstandingCents * share) }))
    .filter((payment) => payment.amountCents > 0);
  if (payments.length === 0) return request;
  return registerPayments(receiver, request.id, { paidOn: notFuture(paidOn), reference, payments });
}

async function seedPayroll(generator: number, receiver: number) {
  // Primer semestre: todo pagado y cerrado. En QUI-001 se anula un pago mal registrado y se repite.
  await accrueUntil(generator, '2026-06-30');
  for (const code of ['FIS-001', 'FIS-002', 'BIO-001']) {
    const request = await approved(generator, receiver, code, 'Nómina del primer semestre');
    if (!request) continue;
    await closeRequest(receiver, (await pay(receiver, request, '2026-07-03')).id);
  }
  const chemistry = await approved(generator, receiver, 'QUI-001', 'Nómina del primer semestre');
  if (chemistry) {
    const first = chemistry.people[0]!;
    const wrong = await registerPayments(receiver, chemistry.id, {
      paidOn: notFuture('2026-07-03'),
      reference: 'Transferencia',
      payments: [{ personId: first.person.id, amountCents: Math.min(first.outstandingCents, 10_000) }],
    });
    await annulPayment(receiver, wrong.payments.at(-1)!.id, 'Se registró en la persona equivocada');
    // Tras la anulación, ese monto vuelve a estar pendiente.
    await closeRequest(receiver, (await pay(receiver, await getRequest(chemistry.id), '2026-07-06')).id);
  }

  // Tercer trimestre: un pago parcial que sigue abierto, uno completo, un cierre con saldo y un rechazo.
  await accrueUntil(generator, '2026-09-30');
  const physics = await approved(generator, receiver, 'FIS-001', 'Nómina del tercer trimestre');
  if (physics) await pay(receiver, physics, '2026-10-05', 0.5, 'Efectivo, primer abono');

  const chemistryQ3 = await approved(generator, receiver, 'QUI-001', 'Nómina del tercer trimestre');
  if (chemistryQ3) await closeRequest(receiver, (await pay(receiver, chemistryQ3, '2026-10-05')).id);

  const biology = await approved(generator, receiver, 'BIO-001', 'Nómina del tercer trimestre');
  if (biology) {
    const paid = await pay(receiver, biology, '2026-10-06', 0.7);
    await closeRequest(receiver, paid.id, 'Fondos insuficientes este mes; el saldo pasa a la próxima solicitud');
  }

  const sensors = await newRequest(generator, 'FIS-002', 'Nómina del tercer trimestre');
  if (sensors) {
    await submitRequest(generator, sensors.id);
    await rejectRequest(receiver, sensors.id, 'Falta el informe de avance del proyecto');
  }

  // Lo más reciente: una causación anulada, una solicitud enviada y un borrador.
  await accrueUntil(generator, '2026-10-31');
  const latest = await prisma.accrual.findFirst({
    where: { project: { code: 'FIS-002' }, annulledAt: null, allocations: { none: {} } },
    orderBy: { id: 'desc' },
  });
  if (latest) await annulAccrual(generator, latest.id, 'Semana no laborada por el beneficiario');

  // Una solicitud retirada antes de que la decidan: su deuda queda libre para otra.
  const withdrawn = await newRequest(generator, 'FIS-002', 'Creada por error, sin el informe de avance');
  if (withdrawn) await cancelRequest(generator, withdrawn.id);

  const biologyQ4 = await newRequest(generator, 'BIO-001', 'Saldo pendiente y nómina de octubre');
  if (biologyQ4) await submitRequest(generator, biologyQ4.id);
  await newRequest(generator, 'QUI-001', 'Nómina de octubre');
}

// Meses de agosto hasta el mes actual: los anteriores cerrados con arrastre y el actual abierto.
async function seedPettyCash(generator: number, receiver: number) {
  const fund = await createFund(receiver, { name: 'Caja chica Física', projectId: await projectId('FIS-001') });
  const now = today();
  const months: { year: number; month: number }[] = [];
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (let index = 2026 * 12 + 7; index <= current; index++) {
    months.push({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  }

  const voucher = async (concept: string, beneficiary: string, amountCents: number) =>
    (await requestVoucher(generator, fund.id, { concept, beneficiary, amountCents })).id;

  for (const [index, { year, month }] of months.entries()) {
    const first = index === 0;
    const period = await openPeriod(receiver, fund.id, { year, month, replenishmentCents: first ? 50_000 : 25_000 });
    const day = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    if (index < months.length - 1) {
      const reagents = await voucher('Reactivos y material de laboratorio', 'Distribuidora Científica', 18_000);
      await approveVoucher(receiver, reagents);
      await disburseVoucher(receiver, reagents);
      await settleVoucher(generator, reagents, { spentCents: 16_550, receiptReference: `F-${month}0231`, receiptDate: date(day(12)) });

      const transport = await voucher('Traslado de equipos al laboratorio', 'Transporte Rápido', 6_000);
      await approveVoucher(receiver, transport);
      await disburseVoucher(receiver, transport);
      await settleVoucher(generator, transport, { spentCents: 6_000, receiptReference: `T-${month}118`, receiptDate: date(day(20)) });

      const refused = await voucher('Almuerzo del equipo', 'Restaurante El Sabor', 4_500);
      await rejectVoucher(receiver, refused, 'No es un gasto del proyecto');

      if (first) await cancelVoucher(generator, await voucher('Papelería', 'Librería Central', 1_500));
      await closePeriod(receiver, period.id);
    } else {
      // Mes en curso: un vale en cada estado abierto.
      const settled = await voucher('Guantes y mascarillas', 'Suministros Médicos', 3_500);
      await approveVoucher(receiver, settled);
      await disburseVoucher(receiver, settled);
      await settleVoucher(generator, settled, { spentCents: 3_200, receiptReference: 'F-77120', receiptDate: notFuture(day(3)) });

      const disbursed = await voucher('Mantenimiento del espectrómetro', 'Servitec', 12_000);
      await approveVoucher(receiver, disbursed);
      await disburseVoucher(receiver, disbursed);

      await approveVoucher(receiver, await voucher('Envío de muestras', 'Courier Nacional', 4_000));
      await voucher('Cables y conectores', 'Electrónica Valencia', 2_500);
    }
  }
}

export async function seedDemoActivity() {
  // Solo en una base sin movimientos, para no duplicarlos en cada arranque.
  if ((await prisma.accrualBatch.count()) > 0 || (await prisma.pettyCashFund.count()) > 0) return;

  const generator = await userId('generador@example.com');
  const receiver = await userId('receptor@example.com');
  await seedPayroll(generator, receiver);
  await seedPettyCash(generator, receiver);
}
