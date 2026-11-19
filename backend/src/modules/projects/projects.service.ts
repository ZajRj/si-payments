import { randomInt } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { businessToday, displayDate, formatDateOnly } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { assertAccrualsUnaffected } from '../accruals/accruals.service.js';
import { openAssignmentWhere } from '../assignments/open-assignments.js';

export const SCOPES = ['INTERNAL', 'EXTERNAL'] as const;
export type Scope = (typeof SCOPES)[number];

type ProjectInput = {
  // Sin código, se genera al azar con el prefijo del área (BIO-7KQ3). La interfaz nunca lo envía.
  code?: string;
  name: string;
  areaId: number;
  scope: Scope;
  startDate: Date;
  endDate: Date;
};

// El código no cambia después de creado: identifica al proyecto en solicitudes, recibos y reportes.
type UpdateProjectInput = Partial<Omit<ProjectInput, 'code'>> & { active?: boolean };
type ListFilters = { areaId?: number; active?: boolean };

type ProjectRecord = Prisma.ProjectGetPayload<{ include: { area: { select: { id: true; name: true } } } }>;

export function toProjectDto({ startDate, endDate, ...project }: ProjectRecord) {
  return { ...project, startDate: formatDateOnly(startDate), endDate: formatDateOnly(endDate) };
}

const projectInclude = { area: { select: { id: true, name: true } } } satisfies Prisma.ProjectInclude;

export async function listProjects({ areaId, active }: ListFilters) {
  const projects = await prisma.project.findMany({
    where: { areaId, active },
    orderBy: { code: 'asc' },
    // Las asignaciones anuladas no cuentan.
    include: { ...projectInclude, _count: { select: { assignments: { where: { annulledAt: null } } } } },
  });
  return projects.map(({ _count, ...project }) => ({
    ...toProjectDto(project),
    assignmentCount: _count.assignments,
  }));
}

export async function getProject(id: number) {
  const project = await prisma.project.findUnique({
    where: { id },
    include: { ...projectInclude, _count: { select: { assignments: true } } },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Proyecto no encontrado');
  }
  const { _count, ...rest } = project;
  return { ...toProjectDto(rest), assignmentCount: _count.assignments };
}

export async function createProject(actorId: number, data: ProjectInput) {
  assertValidRange(data.startDate, data.endDate);
  // Un proyecto nuevo puede empezar en el pasado (registro retroactivo o migración desde Excel),
  // pero no puede tener la vigencia ya terminada.
  if (data.endDate.getTime() < businessToday().getTime()) {
    throw new HttpError(
      400,
      'PROJECT_ALREADY_ENDED',
      `La vigencia ya terminó: la fecha de fin debe ser ${displayDate(businessToday())} o posterior`,
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const area = await assertAreaUsable(tx, data.areaId);
      const code = data.code ?? (await randomCode(tx, area.name));
      const project = toProjectDto(await tx.project.create({ data: { ...data, code }, include: projectInclude }));
      await audit(tx, { userId: actorId, action: 'CREATE', entity: 'Project', entityId: project.id, after: project });
      return project;
    });
  } catch (error) {
    throw translateError(error);
  }
}

export async function updateProject(actorId: number, id: number, data: UpdateProjectInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.project.findUnique({ where: { id }, include: projectInclude });
      if (!current) {
        throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Proyecto no encontrado');
      }

      if (data.areaId !== undefined && data.areaId !== current.areaId) {
        await assertAreaUsable(tx, data.areaId);
      }

      const startDate = data.startDate ?? current.startDate;
      const endDate = data.endDate ?? current.endDate;
      assertValidRange(startDate, endDate);
      await assertAssignmentsFit(tx, id, startDate, endDate);

      // Las asignaciones sin fecha de fin terminan con el proyecto: mover su fin no puede alterar períodos causados.
      if (endDate.getTime() !== current.endDate.getTime()) {
        const followProject = await tx.assignment.findMany({ where: { projectId: id, endDate: null, annulledAt: null } });
        for (const assignment of followProject) {
          await assertAccrualsUnaffected(tx, assignment, endDate);
        }
      }

      if (current.active && data.active === false) {
        const open = await tx.assignment.count({ where: { projectId: id, ...openAssignmentWhere(businessToday()) } });
        if (open > 0) {
          throw new HttpError(
            409,
            'PROJECT_HAS_OPEN_ASSIGNMENTS',
            'El proyecto tiene asignaciones vigentes. Ciérralas antes de desactivarlo',
          );
        }
      }

      const project = toProjectDto(await tx.project.update({ where: { id }, data, include: projectInclude }));
      await audit(tx, {
        userId: actorId,
        action: 'UPDATE',
        entity: 'Project',
        entityId: id,
        before: toProjectDto(current),
        after: project,
      });
      return project;
    });
  } catch (error) {
    throw translateError(error);
  }
}

function assertValidRange(startDate: Date, endDate: Date) {
  if (endDate.getTime() < startDate.getTime()) {
    throw new HttpError(400, 'INVALID_RANGE', 'La fecha de fin de la vigencia no puede ser anterior a la de inicio');
  }
}

async function assertAreaUsable(tx: Prisma.TransactionClient, areaId: number) {
  const area = await tx.area.findUnique({ where: { id: areaId } });
  if (!area) {
    throw new HttpError(400, 'INVALID_AREA', 'El área indicada no existe');
  }
  if (!area.active) {
    throw new HttpError(409, 'AREA_INACTIVE', 'El área indicada está inactiva');
  }
  return area;
}

// Prefijo del código: las tres primeras letras del área, sin acentos (Física → FIS, Química → QUI).
export function areaPrefix(areaName: string) {
  const letters = areaName
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  return letters.padEnd(3, 'X').slice(0, 3);
}

// Sin 0/O, 1/I/L: el código se lee y se dicta sin confusiones.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const CODE_ATTEMPTS = 10;

// Código aleatorio con el prefijo del área: BIO-7KQ3. Con 31^4 (unas 920 mil) combinaciones por prefijo,
// chocar es improbable; si pasa, se prueba otro.
async function randomCode(tx: Prisma.TransactionClient, areaName: string) {
  const prefix = areaPrefix(areaName);
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const suffix = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    const code = `${prefix}-${suffix}`;
    if (!(await tx.project.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new HttpError(503, 'CODE_GENERATION_FAILED', 'No se pudo generar un código libre. Intenta de nuevo');
}

// Cambiar la vigencia no puede dejar asignaciones fuera de ella.
async function assertAssignmentsFit(tx: Prisma.TransactionClient, projectId: number, startDate: Date, endDate: Date) {
  const outside = await tx.assignment.count({
    where: {
      projectId,
      annulledAt: null,
      OR: [{ startDate: { lt: startDate } }, { startDate: { gt: endDate } }, { endDate: { gt: endDate } }],
    },
  });
  if (outside > 0) {
    throw new HttpError(
      409,
      'ASSIGNMENTS_OUTSIDE_PROJECT',
      'La nueva vigencia deja asignaciones fuera de ella. Ajusta esas asignaciones primero',
    );
  }
}

function translateError(error: unknown) {
  return isUniqueViolation(error)
    ? new HttpError(409, 'PROJECT_CODE_TAKEN', 'Ya existe un proyecto con ese código')
    : error;
}
