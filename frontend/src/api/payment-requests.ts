import type { PeriodRef } from './accruals';
import { http } from './http';

export type RequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CLOSED' | 'CANCELLED';

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviada',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  CLOSED: 'Cerrada',
  CANCELLED: 'Cancelada',
};

type UserRef = { id: number; name: string } | null;
type PersonRef = { id: number; idNumber: string; name: string };

export type PaymentRequestSummary = {
  id: number;
  project: { id: number; code: string; name: string };
  status: RequestStatus;
  notes: string | null;
  createdBy: UserRef;
  createdAt: string;
  submittedAt: string | null;
  decidedBy: UserRef;
  decidedAt: string | null;
  decisionNote: string | null;
  closedBy: UserRef;
  closedAt: string | null;
  closingNote: string | null;
  cancelledAt: string | null;
  requestedCents: number;
  paidCents: number;
  outstandingCents: number;
  personCount: number;
};

export type PaymentRequestItem = {
  id: number;
  accrualId: number;
  person: PersonRef;
  period: PeriodRef;
  activeDays: number;
  periodDays: number;
  accrualAmountCents: number;
  requestedCents: number;
  paidCents: number;
  outstandingCents: number;
};

export type Payment = {
  id: number;
  requestId: number;
  person: PersonRef;
  amountCents: number;
  paidOn: string;
  reference: string | null;
  createdBy: UserRef;
  createdAt: string;
  annulledAt: string | null;
  annulledBy: UserRef;
  annulmentReason: string | null;
  allocations: { accrualId: number; amountCents: number }[];
};

export type PaymentRequestDetail = PaymentRequestSummary & {
  items: PaymentRequestItem[];
  people: { person: PersonRef; requestedCents: number; paidCents: number; outstandingCents: number }[];
  payments: Payment[];
};

type RequestResponse = { paymentRequest: PaymentRequestDetail };

export async function listPaymentRequests(filters: { projectId?: number; status?: RequestStatus } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const { paymentRequests } = await http<{ paymentRequests: PaymentRequestSummary[] }>(`/payment-requests?${params}`);
  return paymentRequests;
}

export async function getPaymentRequest(id: number) {
  return (await http<RequestResponse>(`/payment-requests/${id}`)).paymentRequest;
}

export async function createPaymentRequest(payload: { projectId: number; notes?: string | null }) {
  return (await http<RequestResponse>('/payment-requests', { method: 'POST', body: payload })).paymentRequest;
}

async function action(id: number, name: string, body: unknown = {}) {
  return (await http<RequestResponse>(`/payment-requests/${id}/${name}`, { method: 'POST', body })).paymentRequest;
}

export const submitPaymentRequest = (id: number) => action(id, 'submit');
export const cancelPaymentRequest = (id: number) => action(id, 'cancel');
export const approvePaymentRequest = (id: number, note: string | null) => action(id, 'approve', { note });
export const rejectPaymentRequest = (id: number, reason: string) => action(id, 'reject', { reason });
export const closePaymentRequest = (id: number, note: string | null) => action(id, 'close', { note });

export function registerPayments(
  id: number,
  payload: { paidOn: string; reference: string | null; payments: { personId: number; amountCents: number }[] },
) {
  return action(id, 'payments', payload);
}

export async function annulPayment(id: number, reason: string) {
  const { payment } = await http<{ payment: Payment }>(`/payments/${id}/annul`, { method: 'POST', body: { reason } });
  return payment;
}
