import type { Prisma } from '../../generated/prisma/client.js';

// Asignaciones que siguen vigentes en `today` o empiezan después. Una asignación sin fecha
// de fin dura lo que dure el proyecto. Las anuladas no cuentan.
export function openAssignmentWhere(today: Date): Prisma.AssignmentWhereInput {
  return {
    annulledAt: null,
    OR: [{ endDate: { gte: today } }, { endDate: null, project: { endDate: { gte: today } } }],
  };
}
