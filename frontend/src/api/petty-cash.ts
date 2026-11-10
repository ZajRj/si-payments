import { http } from './http';

export type VoucherStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'DISBURSED' | 'SETTLED';

export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  REQUESTED: 'Solicitado',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Cancelado',
  DISBURSED: 'Desembolsado',
  SETTLED: 'Rendido',
};

type UserRef = { id: number; name: string } | null;

export type PettyCashPeriod = {
  id: number;
  fundId: number;
  year: number;
  month: number;
  status: 'OPEN' | 'CLOSED';
  openingBalanceCents: number;
  replenishmentCents: number;
  closingBalanceCents: number | null;
  openedBy: UserRef;
  openedAt: string;
  closedBy: UserRef;
  closedAt: string | null;
  fundsCents: number;
  spentCents: number;
  disbursedCents: number;
  reservedCents: number;
  cashCents: number;
  availableCents: number;
  voucherCount: number;
  pendingVoucherCount: number;
};

export type PettyCashFund = {
  id: number;
  name: string;
  project: { id: number; code: string; name: string; active: boolean };
  active: boolean;
  openPeriod: PettyCashPeriod | null;
};

export type Voucher = {
  id: number;
  fund: { id: number; name: string };
  period: { id: number; year: number; month: number; status: string };
  status: VoucherStatus;
  concept: string;
  beneficiary: string;
  amountCents: number;
  requestedBy: UserRef;
  requestedAt: string;
  decidedBy: UserRef;
  decidedAt: string | null;
  rejectionReason: string | null;
  disbursedBy: UserRef;
  disbursedAt: string | null;
  settledBy: UserRef;
  settledAt: string | null;
  spentCents: number | null;
  returnedCents: number | null;
  receiptReference: string | null;
  receiptDate: string | null;
};

export function monthLabel({ year, month }: { year: number; month: number }) {
  return `${String(month).padStart(2, '0')}/${year}`;
}

export async function listFunds() {
  return (await http<{ funds: PettyCashFund[] }>('/petty-cash/funds')).funds;
}

export async function createFund(payload: { name: string; projectId: number }) {
  return (await http<{ fund: PettyCashFund }>('/petty-cash/funds', { method: 'POST', body: payload })).fund;
}

export async function updateFund(id: number, payload: { name?: string; projectId?: number; active?: boolean }) {
  return (await http<{ fund: PettyCashFund }>(`/petty-cash/funds/${id}`, { method: 'PATCH', body: payload })).fund;
}

export async function listFundPeriods(fundId: number) {
  return (await http<{ periods: PettyCashPeriod[] }>(`/petty-cash/funds/${fundId}/periods`)).periods;
}

export async function openPeriod(fundId: number, payload: { year?: number; month?: number; replenishmentCents: number }) {
  return (await http<{ period: PettyCashPeriod }>(`/petty-cash/funds/${fundId}/periods`, { method: 'POST', body: payload }))
    .period;
}

export async function closePeriod(periodId: number) {
  return (await http<{ period: PettyCashPeriod }>(`/petty-cash/periods/${periodId}/close`, { method: 'POST' })).period;
}

export async function listVouchers(filters: { fundId?: number; periodId?: number; status?: VoucherStatus } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return (await http<{ vouchers: Voucher[] }>(`/petty-cash/vouchers?${params}`)).vouchers;
}

export async function requestVoucher(fundId: number, payload: { concept: string; beneficiary: string; amountCents: number }) {
  return (await http<{ voucher: Voucher }>(`/petty-cash/funds/${fundId}/vouchers`, { method: 'POST', body: payload }))
    .voucher;
}

async function voucherAction(id: number, name: string, body: unknown = {}) {
  return (await http<{ voucher: Voucher }>(`/petty-cash/vouchers/${id}/${name}`, { method: 'POST', body })).voucher;
}

export const approveVoucher = (id: number) => voucherAction(id, 'approve');
export const rejectVoucher = (id: number, reason: string) => voucherAction(id, 'reject', { reason });
export const disburseVoucher = (id: number) => voucherAction(id, 'disburse');
export const cancelVoucher = (id: number) => voucherAction(id, 'cancel');
export const settleVoucher = (
  id: number,
  payload: { spentCents: number; receiptReference: string; receiptDate: string },
) => voucherAction(id, 'settle', payload);
