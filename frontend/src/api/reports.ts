import type { AccrualStatus, PeriodRef } from './accruals';
import { http } from './http';

type PersonRef = { id: number; idNumber: string; name: string };
type ProjectRef = { id: number; code: string; name: string };
type UserRef = { id: number; name: string } | null;

export type GroupBy = 'person' | 'project';

export type ReportFilters = {
  projectId?: number;
  personId?: number;
  areaId?: number;
  from?: string;
  to?: string;
};

export type BalanceTotals = { accruedCents: number; paidCents: number; owedCents: number; accrualCount: number };

export type BalanceRow = BalanceTotals & {
  person?: PersonRef;
  project?: ProjectRef & { area: { id: number; name: string } };
};

export type BalancesReport = { groupBy: GroupBy; rows: BalanceRow[]; totals: BalanceTotals };

export type ReportPayment = {
  id: number;
  requestId: number;
  person: PersonRef;
  project: ProjectRef;
  amountCents: number;
  paidOn: string;
  reference: string | null;
  createdBy: UserRef;
  createdAt: string;
  annulledAt: string | null;
  annulledBy: UserRef;
  annulmentReason: string | null;
};

export type PaymentsReport = {
  payments: ReportPayment[];
  totals: { paymentCount: number; amountCents: number; annulledCount: number };
};

export type PersonStatement = {
  person: PersonRef & { active: boolean };
  accruals: {
    id: number;
    project: ProjectRef;
    period: PeriodRef;
    activeDays: number;
    periodDays: number;
    amountCents: number;
    paidCents: number;
    owedCents: number;
    status: AccrualStatus;
  }[];
  payments: ReportPayment[];
  totals: BalanceTotals;
};

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export function getBalances(groupBy: GroupBy, filters: ReportFilters) {
  return http<BalancesReport>(`/reports/balances?${query({ groupBy, ...filters })}`);
}

export function getPaymentsReport(filters: ReportFilters) {
  return http<PaymentsReport>(`/reports/payments?${query({ ...filters })}`);
}

export function getPersonStatement(personId: number, filters: Omit<ReportFilters, 'personId'>) {
  return http<PersonStatement>(`/reports/people/${personId}/statement?${query({ ...filters })}`);
}

// Los PDFs se abren en una pestaña nueva: la cookie de sesión viaja sola porque es el mismo origen.
export const receiptPdfUrl = (paymentId: number) => `/api/reports/payments/${paymentId}/receipt`;
export const paymentRequestPdfUrl = (requestId: number) => `/api/reports/payment-requests/${requestId}/consolidated`;
