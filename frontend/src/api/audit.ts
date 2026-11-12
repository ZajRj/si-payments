import { http } from './http';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

export type AuditEntry = {
  id: number;
  action: AuditAction;
  entity: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  user: { id: number; name: string; email: string } | null;
};

export type AuditFilters = {
  action?: AuditAction;
  entity?: string;
  entityId?: string;
  userId?: number;
  from?: string;
  to?: string;
  page?: number;
};

export type AuditPage = {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export function listAuditEntries(filters: AuditFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== 0) params.set(key, String(value));
  }
  return http<AuditPage>(`/audit-log?${params}`);
}
