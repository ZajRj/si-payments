import type { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { businessToday } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { openAssignmentWhere } from '../assignments/open-assignments.js';

type PersonInput = {
  idNumber: string;
  name: string;
  phone?: string | null;
  email?: string | null;
};

type ListFilters = { search?: string; active?: boolean };

export function listPeople({ search, active }: ListFilters) {
  const where: Prisma.PersonWhereInput = {
    active,
    OR: search ? [{ name: { contains: search } }, { idNumber: { contains: search } }] : undefined,
  };
  return prisma.person.findMany({ where, orderBy: { name: 'asc' } });
}

export async function createPerson(actorId: number, data: PersonInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({ data });
      await audit(tx, { userId: actorId, action: 'CREATE', entity: 'Person', entityId: person.id, after: person });
      return person;
    });
  } catch (error) {
    throw translateError(error);
  }
}

export async function updatePerson(actorId: number, id: number, data: Partial<PersonInput> & { active?: boolean }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.person.findUnique({ where: { id } });
      if (!before) {
        throw new HttpError(404, 'PERSON_NOT_FOUND', 'Persona no encontrada');
      }

      if (before.active && data.active === false) {
        const open = await tx.assignment.count({ where: { personId: id, ...openAssignmentWhere(businessToday()) } });
        if (open > 0) {
          throw new HttpError(
            409,
            'PERSON_HAS_OPEN_ASSIGNMENTS',
            'La persona tiene asignaciones vigentes. Ciérralas antes de desactivarla',
          );
        }
      }

      const person = await tx.person.update({ where: { id }, data });
      await audit(tx, { userId: actorId, action: 'UPDATE', entity: 'Person', entityId: id, before, after: person });
      return person;
    });
  } catch (error) {
    throw translateError(error);
  }
}

function translateError(error: unknown) {
  return isUniqueViolation(error)
    ? new HttpError(409, 'ID_NUMBER_TAKEN', 'Ya existe una persona con esa cédula')
    : error;
}
