import { http } from './http';

export type AuditEntry = {
  id: number;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  user: { id: number; name: string; email: string } | null;
};

export type AuditFilters = {
  entity?: string;
  from?: string;
  to?: string;
  page?: number;
};

export type AuditPage = {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
};

export function listAuditEntries(filters: AuditFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return http<AuditPage>(`/audit-log?${params}`);
}
