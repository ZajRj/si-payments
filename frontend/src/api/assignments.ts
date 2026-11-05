import { http } from './http';
import type { Frequency } from './payment-groups';

export type Assignment = {
  id: number;
  person: { id: number; idNumber: string; name: string };
  project: { id: number; code: string; name: string; endDate: string };
  paymentGroup: { id: number; name: string; frequency: Frequency };
  amountCents: number;
  startDate: string;
  endDate: string | null;
  effectiveEndDate: string;
};

export type AssignmentFilters = {
  personId?: number;
  projectId?: number;
  openOnly?: boolean;
};

export type CreateAssignmentPayload = {
  personId: number;
  projectId: number;
  paymentGroupId: number;
  amountCents: number;
  startDate: string;
  endDate: string | null;
};

export async function listAssignments(filters: AssignmentFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const { assignments } = await http<{ assignments: Assignment[] }>(`/assignments?${params}`);
  return assignments;
}

export async function createAssignment(payload: CreateAssignmentPayload) {
  const { assignment } = await http<{ assignment: Assignment }>('/assignments', { method: 'POST', body: payload });
  return assignment;
}

export async function updateAssignmentEndDate(id: number, endDate: string | null) {
  const { assignment } = await http<{ assignment: Assignment }>(`/assignments/${id}`, {
    method: 'PATCH',
    body: { endDate },
  });
  return assignment;
}

export function changeAssignmentAmount(id: number, payload: { effectiveDate: string; amountCents: number }) {
  return http<{ closed: Assignment; created: Assignment }>(`/assignments/${id}/amount-change`, {
    method: 'POST',
    body: payload,
  });
}
