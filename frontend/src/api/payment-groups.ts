import { http } from './http';

export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export type PaymentGroup = {
  id: number;
  name: string;
  frequency: Frequency;
  cutoffDay: number | null;
  active: boolean;
  periodCount: number;
};

export type Period = {
  id: number;
  paymentGroupId: number;
  startDate: string;
  endDate: string;
  days: number;
};

export type PaymentGroupPayload = {
  name: string;
  frequency: Frequency;
  cutoffDay: number | null;
  active?: boolean;
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quincenal',
  MONTHLY: 'Mensual',
};

export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function describeCutoff({ frequency, cutoffDay }: Pick<PaymentGroup, 'frequency' | 'cutoffDay'>) {
  if (frequency === 'WEEKLY') return `Cierra cada ${WEEKDAYS[cutoffDay ?? 0]?.toLowerCase()}`;
  if (frequency === 'BIWEEKLY') return `Del 1 al ${cutoffDay} y del ${(cutoffDay ?? 15) + 1} a fin de mes`;
  return cutoffDay === null ? 'Cierra a fin de mes' : `Cierra el día ${cutoffDay}`;
}

export async function listPaymentGroups() {
  const { paymentGroups } = await http<{ paymentGroups: PaymentGroup[] }>('/payment-groups');
  return paymentGroups;
}

export async function createPaymentGroup(payload: PaymentGroupPayload) {
  const { paymentGroup } = await http<{ paymentGroup: PaymentGroup }>('/payment-groups', {
    method: 'POST',
    body: payload,
  });
  return paymentGroup;
}

export async function updatePaymentGroup(id: number, payload: Partial<PaymentGroupPayload>) {
  const { paymentGroup } = await http<{ paymentGroup: PaymentGroup }>(`/payment-groups/${id}`, {
    method: 'PATCH',
    body: payload,
  });
  return paymentGroup;
}

export async function listPeriods(groupId: number) {
  const { periods } = await http<{ periods: Period[] }>(`/payment-groups/${groupId}/periods`);
  return periods;
}

export async function generatePeriods(groupId: number, payload: { from?: string; until: string }) {
  const { periods } = await http<{ periods: Period[] }>(`/payment-groups/${groupId}/periods`, {
    method: 'POST',
    body: payload,
  });
  return periods;
}

export async function deleteLastPeriod(groupId: number) {
  const { period } = await http<{ period: Period }>(`/payment-groups/${groupId}/periods/last`, {
    method: 'DELETE',
  });
  return period;
}
