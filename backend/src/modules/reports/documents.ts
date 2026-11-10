import { formatDateOnly } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { getRequest } from '../payment-requests/payment-requests.service.js';
import { amountInWords } from './amount-in-words.js';
import {
  companySettings,
  dateOnly,
  dateTime,
  documentNumber,
  fields,
  header,
  paragraph,
  renderPdf,
  rule,
  sectionTitle,
  signatures,
  table,
  usd,
  watermark,
} from './pdf.js';

const REQUEST_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviada',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  CLOSED: 'Cerrada',
  CANCELLED: 'Cancelada',
};

const period = (p: { startDate: string; endDate: string }) => `${dateOnly(p.startDate)} al ${dateOnly(p.endDate)}`;

// Recibo individual: un pago entregado a una persona, con cómo se aplicó a su deuda (FIFO).
export async function receiptPdf(paymentId: number) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      person: { select: { idNumber: true, name: true } },
      createdBy: { select: { name: true } },
      annulledBy: { select: { name: true } },
      request: { select: { id: true, project: { select: { code: true, name: true } } } },
      allocations: {
        orderBy: { id: 'asc' },
        include: {
          accrual: {
            select: {
              id: true,
              amountCents: true,
              activeDays: true,
              periodDays: true,
              period: { select: { startDate: true, endDate: true, paymentGroup: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  if (!payment) {
    throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Pago no encontrado');
  }

  const company = await companySettings();
  const number = documentNumber(payment.id);
  const paidOn = formatDateOnly(payment.paidOn);

  const pdf = await renderPdf(`Recibo de pago N° ${number}`, (doc) => {
    header(doc, company, 'RECIBO DE PAGO', [`N° ${number}`, `Fecha de pago: ${dateOnly(paidOn)}`]);

    if (payment.annulledAt) {
      paragraph(doc, 'RECIBO ANULADO', { bold: true, size: 11, color: '#cc0000' });
      paragraph(
        doc,
        `Anulado el ${dateTime(payment.annulledAt)} por ${payment.annulledBy?.name ?? '—'}. Motivo: ${payment.annulmentReason ?? '—'}`,
        { color: '#cc0000' },
      );
      doc.moveDown(0.5);
    }

    fields(doc, [
      ['Beneficiario', payment.person.name],
      ['Cédula', payment.person.idNumber],
      ['Proyecto', `${payment.request.project.code} · ${payment.request.project.name}`],
      ['Solicitud de pago', `N° ${documentNumber(payment.request.id)}`],
      ['Referencia', payment.reference ?? ''],
    ]);

    doc.moveDown(0.5);
    rule(doc);
    paragraph(doc, `Monto recibido: ${usd(payment.amountCents)}`, { bold: true, size: 12 });
    doc.moveDown(0.2);
    paragraph(doc, `Son: ${amountInWords(payment.amountCents)}`);

    sectionTitle(doc, 'Aplicación del pago (primero la deuda más antigua)');
    table(
      doc,
      [
        { header: 'Causación', width: 1 },
        { header: 'Período', width: 2.2 },
        { header: 'Grupo de pago', width: 1.6 },
        { header: 'Días', width: 0.8, align: 'right' },
        { header: 'Causado', width: 1.3, align: 'right' },
        { header: 'Aplicado', width: 1.3, align: 'right' },
      ],
      [
        ...payment.allocations.map(({ accrual, amountCents }) => ({
          cells: [
            `#${accrual.id}`,
            period({ startDate: formatDateOnly(accrual.period.startDate), endDate: formatDateOnly(accrual.period.endDate) }),
            accrual.period.paymentGroup.name,
            `${accrual.activeDays}/${accrual.periodDays}`,
            usd(accrual.amountCents),
            usd(amountCents),
          ],
        })),
        { cells: ['Total', '', '', '', '', usd(payment.amountCents)], bold: true },
      ],
    );

    doc.moveDown(0.5);
    paragraph(doc, company.receiptsFooter);

    signatures(doc, [
      { label: 'Entregado por', name: payment.createdBy.name },
      { label: 'Recibí conforme', name: payment.person.name, detail: `C.I. ${payment.person.idNumber}` },
    ]);
    paragraph(doc, `Registrado el ${dateTime(payment.createdAt)}. Generado el ${dateTime(new Date())}.`, { size: 7.5, color: '#555555' });

    if (payment.annulledAt) watermark(doc, 'ANULADO');
  });

  return { pdf, filename: `recibo-${number}.pdf` };
}

// Solicitud consolidada: el resumen por persona, el detalle por causación y los pagos registrados.
export async function paymentRequestPdf(requestId: number) {
  const request = await getRequest(requestId);
  const company = await companySettings();
  const number = documentNumber(request.id);
  const status = REQUEST_STATUS_LABELS[request.status] ?? request.status;

  const pdf = await renderPdf(`Solicitud de pago N° ${number}`, (doc) => {
    header(doc, company, 'SOLICITUD DE PAGO CONSOLIDADA', [`N° ${number}`, `Estado: ${status}`]);

    const timeline: [string, string][] = [
      ['Proyecto', `${request.project.code} · ${request.project.name}`],
      ['Elaborada por', `${request.createdBy.name}, ${dateTime(request.createdAt)}`],
    ];
    if (request.submittedAt) timeline.push(['Enviada', dateTime(request.submittedAt)]);
    if (request.decidedAt) {
      timeline.push([
        request.status === 'REJECTED' ? 'Rechazada por' : 'Aprobada por',
        `${request.decidedBy?.name ?? '—'}, ${dateTime(request.decidedAt)}`,
      ]);
    }
    if (request.decisionNote) timeline.push(['Nota de la decisión', request.decisionNote]);
    if (request.closedAt) timeline.push(['Cerrada por', `${request.closedBy?.name ?? '—'}, ${dateTime(request.closedAt)}`]);
    if (request.closingNote) timeline.push(['Nota de cierre', request.closingNote]);
    if (request.cancelledAt) timeline.push(['Cancelada', dateTime(request.cancelledAt)]);
    if (request.notes) timeline.push(['Notas', request.notes]);
    fields(doc, timeline);

    sectionTitle(doc, 'Resumen por persona');
    table(
      doc,
      [
        { header: 'Cédula', width: 1.3 },
        { header: 'Nombre', width: 2.7 },
        { header: 'Solicitado', width: 1.3, align: 'right' },
        { header: 'Pagado', width: 1.3, align: 'right' },
        { header: 'Pendiente', width: 1.3, align: 'right' },
      ],
      [
        ...request.people.map((entry) => ({
          cells: [entry.person.idNumber, entry.person.name, usd(entry.requestedCents), usd(entry.paidCents), usd(entry.outstandingCents)],
        })),
        {
          cells: [`${request.personCount} personas`, 'Total', usd(request.requestedCents), usd(request.paidCents), usd(request.outstandingCents)],
          bold: true,
        },
      ],
    );

    sectionTitle(doc, 'Detalle por causación');
    table(
      doc,
      [
        { header: 'Persona', width: 2.2 },
        { header: 'Período', width: 2 },
        { header: 'Días', width: 0.7, align: 'right' },
        { header: 'Causado', width: 1.2, align: 'right' },
        { header: 'Solicitado', width: 1.2, align: 'right' },
        { header: 'Pagado', width: 1.2, align: 'right' },
        { header: 'Pendiente', width: 1.2, align: 'right' },
      ],
      request.items.map((item) => ({
        cells: [
          item.person.name,
          `${period(item.period)}\n${item.period.paymentGroup.name} · #${item.accrualId}`,
          `${item.activeDays}/${item.periodDays}`,
          usd(item.accrualAmountCents),
          usd(item.requestedCents),
          usd(item.paidCents),
          usd(item.outstandingCents),
        ],
      })),
    );

    sectionTitle(doc, 'Pagos registrados');
    if (request.payments.length === 0) {
      paragraph(doc, 'Todavía no hay pagos registrados.', { color: '#555555' });
    } else {
      table(
        doc,
        [
          { header: 'Recibo', width: 0.9 },
          { header: 'Persona', width: 2.3 },
          { header: 'Fecha', width: 1 },
          { header: 'Monto', width: 1.2, align: 'right' },
          { header: 'Referencia', width: 1.5 },
          { header: 'Estado', width: 1.5 },
        ],
        request.payments.map((payment) => ({
          cells: [
            `#${documentNumber(payment.id)}`,
            payment.person.name,
            dateOnly(payment.paidOn),
            usd(payment.amountCents),
            payment.reference ?? '',
            payment.annulledAt ? `Anulado: ${payment.annulmentReason ?? ''}` : 'Vigente',
          ],
          muted: Boolean(payment.annulledAt),
        })),
      );
    }

    signatures(doc, [
      { label: 'Elaborado por', name: request.createdBy.name, detail: 'Generador de Nómina' },
      {
        label: request.status === 'REJECTED' ? 'Rechazado por' : 'Aprobado por',
        name: request.decidedBy?.name ?? 'Pendiente de decisión',
        detail: 'Receptor de Nómina',
      },
    ]);
    paragraph(doc, `Generado el ${dateTime(new Date())}.`, { size: 7.5, color: '#555555' });

    if (request.status === 'DRAFT' || request.status === 'SUBMITTED') watermark(doc, 'NO APROBADA');
    if (request.status === 'REJECTED' || request.status === 'CANCELLED') watermark(doc, status.toUpperCase());
  });

  return { pdf, filename: `solicitud-${number}.pdf` };
}
