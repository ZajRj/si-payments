import type { AccrualStatus } from '@/api/accruals';
import type { RequestStatus } from '@/api/payment-requests';
import type { VoucherStatus } from '@/api/petty-cash';

// Color de cada estado: neutral (inicial o terminado sin efecto), info (en curso),
// warning (espera una acción), success (resuelto) y danger (rechazado o anulado).
export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const REQUEST_STATUS_TONES: Record<RequestStatus, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  CLOSED: 'success',
  CANCELLED: 'neutral',
};

export const ACCRUAL_STATUS_TONES: Record<AccrualStatus, Tone> = {
  PENDING: 'warning',
  PARTIAL: 'info',
  PAID: 'success',
  ANNULLED: 'danger',
};

export const VOUCHER_STATUS_TONES: Record<VoucherStatus, Tone> = {
  REQUESTED: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  DISBURSED: 'info',
  SETTLED: 'success',
};

export const activeTone = (active: boolean): Tone => (active ? 'success' : 'neutral');
