import type { Prisma } from '../../generated/prisma/client.js';

// Estados en los que una solicitud de pago retiene sus causaciones: mientras tanto,
// no pueden incluirse en otra solicitud ni anularse.
export const OPEN_REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED'];

type Client = Prisma.TransactionClient;

// Lo pagado de cada causación, sin contar los pagos anulados.
export async function paidByAccrual(client: Client, accrualIds: number[]): Promise<Map<number, number>> {
  if (accrualIds.length === 0) return new Map();
  const rows = await client.paymentAllocation.groupBy({
    by: ['accrualId'],
    where: { accrualId: { in: accrualIds }, payment: { annulledAt: null } },
    _sum: { amountCents: true },
  });
  return new Map(rows.map((row) => [row.accrualId, row._sum.amountCents ?? 0]));
}

// La solicitud abierta que retiene cada causación, si la hay.
export async function openRequestByAccrual(client: Client, accrualIds: number[]): Promise<Map<number, number>> {
  if (accrualIds.length === 0) return new Map();
  const items = await client.paymentRequestItem.findMany({
    where: { accrualId: { in: accrualIds }, request: { status: { in: OPEN_REQUEST_STATUSES } } },
    select: { accrualId: true, requestId: true },
  });
  return new Map(items.map((item) => [item.accrualId, item.requestId]));
}
