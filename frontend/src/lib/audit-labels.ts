import type { AuditAction } from '@/api/audit';
import type { Tone } from '@/lib/status';

// Nombres en singular de las entidades del log de auditoría.
export const ENTITY_SINGULAR: Record<string, string> = {
  User: 'Usuario',
  Setting: 'Parámetro',
  Area: 'Área',
  PaymentGroup: 'Grupo de pago',
  Period: 'Período',
  Person: 'Persona',
  Project: 'Proyecto',
  Assignment: 'Asignación',
  Accrual: 'Causación',
  AccrualBatch: 'Lote de causación',
  PaymentRequest: 'Solicitud de pago',
  Payment: 'Pago',
  PettyCashFund: 'Caja chica',
  PettyCashPeriod: 'Mes de caja chica',
  PettyCashVoucher: 'Vale de caja chica',
};

export const ACTIONS: Record<AuditAction, string> = {
  CREATE: 'Creación',
  UPDATE: 'Modificación',
  DELETE: 'Eliminación',
};

export const ACTION_TONES: Record<AuditAction, Tone> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
};
