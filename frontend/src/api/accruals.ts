import { http } from './http';

export type AccrualStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'ANNULLED';
export type AccrualStatusFilter = AccrualStatus | 'UNPAID';

export const ACCRUAL_STATUS_LABELS: Record<AccrualStatus, string> = {
  PENDING: 'Pendiente',
  PARTIAL: 'Pago parcial',
  PAID: 'Pagada',
  ANNULLED: 'Anulada',
};

export type PeriodRef = {
  id: number;
  startDate: string;
  endDate: string;
  paymentGroup: { id: number; name: string };
};

export type Accrual = {
  id: number;
  batchId: number;
  assignmentId: number;
  person: { id: number; idNumber: string; name: string };
  project: { id: number; code: string; name: string };
  period: PeriodRef;
  assignmentAmountCents: number;
  activeDays: number;
  periodDays: number;
  amountCents: number;
  paidCents: number;
  pendingCents: number;
  status: AccrualStatus;
  openRequestId: number | null;
  createdAt: string;
  annulledAt: string | null;
  annulmentReason: string | null;
};

export type AccrualBatch = {
  id: number;
  project: { id: number; code: string; name: string };
  period: PeriodRef;
  createdBy: { id: number; name: string };
  createdAt: string;
  accrualCount: number;
  activeCount: number;
  totalCents: number;
};

export type AccrualFilters = {
  projectId?: number;
  personId?: number;
  periodId?: number;
  paymentGroupId?: number;
  batchId?: number;
  status?: AccrualStatusFilter;
};

export type PageMeta = { total: number; page: number; pageSize: number; pageCount: number };
export type AccrualTotals = { amountCents: number; paidCents: number; pendingCents: number };
export type AccrualPage = PageMeta & { accruals: Accrual[]; totals: AccrualTotals };
export type BatchPage = PageMeta & { batches: AccrualBatch[] };

function query(filters: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}

export function listAccruals(filters: AccrualFilters & { page?: number; pageSize?: number } = {}) {
  return http<AccrualPage>(`/accruals?${query(filters)}`);
}

export function listBatches(filters: { projectId?: number; periodId?: number; page?: number } = {}) {
  return http<BatchPage>(`/accruals/batches?${query(filters)}`);
}

export async function generateAccruals(payload: { periodId: number; projectId?: number }) {
  const { batches } = await http<{ batches: AccrualBatch[] }>('/accruals/generate', { method: 'POST', body: payload });
  return batches;
}

export async function annulAccrual(id: number, reason: string) {
  const { accrual } = await http<{ accrual: Accrual }>(`/accruals/${id}/annul`, { method: 'POST', body: { reason } });
  return accrual;
}

export async function annulBatch(id: number, reason: string) {
  const { batch } = await http<{ batch: AccrualBatch }>(`/accruals/batches/${id}/annul`, {
    method: 'POST',
    body: { reason },
  });
  return batch;
}
