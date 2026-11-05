import type { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { sameName } from '../../lib/names.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';

type AreaInput = { name: string; active?: boolean };

export function listAreas() {
  return prisma.area.findMany({ orderBy: { name: 'asc' } });
}

// Las áreas no se borran: los proyectos las referencian. Se desactivan.
export async function createArea(actorId: number, data: AreaInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      await assertNameAvailable(tx, data.name);
      const area = await tx.area.create({ data });
      await audit(tx, { userId: actorId, action: 'CREATE', entity: 'Area', entityId: area.id, after: area });
      return area;
    });
  } catch (error) {
    throw translateError(error);
  }
}

export async function updateArea(actorId: number, id: number, data: Partial<AreaInput>) {
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.area.findUnique({ where: { id } });
      if (!before) {
        throw new HttpError(404, 'AREA_NOT_FOUND', 'Área no encontrada');
      }
      if (data.name !== undefined) {
        await assertNameAvailable(tx, data.name, id);
      }
      if (before.active && data.active === false) {
        const activeProjects = await tx.project.count({ where: { areaId: id, active: true } });
        if (activeProjects > 0) {
          throw new HttpError(409, 'AREA_HAS_ACTIVE_PROJECTS', 'El área tiene proyectos activos. Desactívalos antes');
        }
      }
      const area = await tx.area.update({ where: { id }, data });
      await audit(tx, { userId: actorId, action: 'UPDATE', entity: 'Area', entityId: id, before, after: area });
      return area;
    });
  } catch (error) {
    throw translateError(error);
  }
}

async function assertNameAvailable(tx: Prisma.TransactionClient, name: string, excludeId?: number) {
  const areas = await tx.area.findMany({ select: { id: true, name: true } });
  if (areas.some((area) => area.id !== excludeId && sameName(area.name, name))) {
    throw nameTaken();
  }
}

function nameTaken() {
  return new HttpError(409, 'AREA_NAME_TAKEN', 'Ya existe un área con ese nombre');
}

function translateError(error: unknown) {
  return isUniqueViolation(error) ? nameTaken() : error;
}
