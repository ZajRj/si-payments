import type { Prisma } from '../generated/prisma/client.js';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

export type AuditEntry = {
  userId: number;
  action: AuditAction;
  entity: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
};

// Se llama con el cliente de la transacción para que el cambio y su registro se guarden juntos o ninguno.
export async function audit(tx: Prisma.TransactionClient, ...entries: AuditEntry[]) {
  if (entries.length === 0) return;

  await tx.auditLog.createMany({
    data: entries.map(({ userId, action, entity, entityId, before, after }) => ({
      userId,
      action,
      entity,
      entityId: String(entityId),
      before: before === undefined ? null : JSON.stringify(before),
      after: after === undefined ? null : JSON.stringify(after),
    })),
  });
}
