import type { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { addDays, formatDateOnly, todayUtc } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { openAssignmentWhere } from './open-assignments.js';

type CreateAssignmentInput = {
  personId: number;
  projectId: number;
  paymentGroupId: number;
  amountCents: number;
  startDate: Date;
  endDate?: Date | null;
};

type ListFilters = {
  personId?: number;
  projectId?: number;
  paymentGroupId?: number;
  openOnly?: boolean;
};

const assignmentInclude = {
  person: { select: { id: true, idNumber: true, name: true } },
  project: { select: { id: true, code: true, name: true, endDate: true } },
  paymentGroup: { select: { id: true, name: true, frequency: true } },
} satisfies Prisma.AssignmentInclude;

type AssignmentRecord = Prisma.AssignmentGetPayload<{ include: typeof assignmentInclude }>;

function toAssignmentDto({ startDate, endDate, project, ...assignment }: AssignmentRecord) {
  return {
    ...assignment,
    project: { id: project.id, code: project.code, name: project.name },
    startDate: formatDateOnly(startDate),
    endDate: endDate ? formatDateOnly(endDate) : null,
    // Sin fecha de fin, la asignación dura hasta el fin de la vigencia del proyecto.
    effectiveEndDate: formatDateOnly(endDate ?? project.endDate),
  };
}

export async function listAssignments({ personId, projectId, paymentGroupId, openOnly }: ListFilters) {
  const where: Prisma.AssignmentWhereInput = {
    personId,
    projectId,
    paymentGroupId,
    ...(openOnly ? openAssignmentWhere(todayUtc()) : {}),
  };
  const assignments = await prisma.assignment.findMany({
    where,
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
    include: assignmentInclude,
  });
  return assignments.map(toAssignmentDto);
}

export async function createAssignment(actorId: number, data: CreateAssignmentInput) {
  return prisma.$transaction(async (tx) => {
    const project = await loadParticipants(tx, data);
    assertWithinProject(project, data.startDate, data.endDate ?? null);
    await assertNoOverlap(tx, { ...data, endDate: data.endDate ?? null }, project.endDate);

    const assignment = toAssignmentDto(await tx.assignment.create({ data, include: assignmentInclude }));
    await audit(tx, {
      userId: actorId,
      action: 'CREATE',
      entity: 'Assignment',
      entityId: assignment.id,
      after: assignment,
    });
    return assignment;
  });
}

// Solo se puede cambiar la fecha de fin: el monto y las partes de la asignación no se modifican.
// TODO(causación): impedir que la nueva fecha deje fuera días ya causados.
export async function updateAssignmentEndDate(actorId: number, id: number, endDate: Date | null) {
  return prisma.$transaction(async (tx) => {
    const current = await findAssignmentOrThrow(tx, id);
    const project = await tx.project.findUniqueOrThrow({ where: { id: current.projectId } });

    assertWithinProject(project, current.startDate, endDate);
    await assertNoOverlap(tx, { ...current, endDate }, project.endDate, id);

    const assignment = toAssignmentDto(
      await tx.assignment.update({ where: { id }, data: { endDate }, include: assignmentInclude }),
    );
    await audit(tx, {
      userId: actorId,
      action: 'UPDATE',
      entity: 'Assignment',
      entityId: id,
      before: toAssignmentDto(current),
      after: assignment,
    });
    return assignment;
  });
}

// Cambio de monto: cierra la asignación el día anterior a `effectiveDate` y abre otra desde esa fecha,
// con el mismo fin que tenía la original. Ambas operaciones se guardan juntas.
export async function changeAssignmentAmount(
  actorId: number,
  id: number,
  { effectiveDate, amountCents }: { effectiveDate: Date; amountCents: number },
) {
  return prisma.$transaction(async (tx) => {
    const current = await findAssignmentOrThrow(tx, id);
    if (amountCents === current.amountCents) {
      throw new HttpError(400, 'SAME_AMOUNT', 'El nuevo monto es igual al actual');
    }

    const project = await loadParticipants(tx, current);
    const currentEnd = current.endDate ?? project.endDate;
    if (effectiveDate.getTime() <= current.startDate.getTime() || effectiveDate.getTime() > currentEnd.getTime()) {
      throw new HttpError(
        400,
        'INVALID_EFFECTIVE_DATE',
        `La fecha del cambio debe estar entre ${formatDateOnly(addDays(current.startDate, 1))} y ${formatDateOnly(currentEnd)}`,
      );
    }

    const closed = toAssignmentDto(
      await tx.assignment.update({
        where: { id },
        data: { endDate: addDays(effectiveDate, -1) },
        include: assignmentInclude,
      }),
    );
    const created = toAssignmentDto(
      await tx.assignment.create({
        data: {
          personId: current.personId,
          projectId: current.projectId,
          paymentGroupId: current.paymentGroupId,
          amountCents,
          startDate: effectiveDate,
          endDate: current.endDate,
        },
        include: assignmentInclude,
      }),
    );

    await audit(
      tx,
      { userId: actorId, action: 'UPDATE', entity: 'Assignment', entityId: id, before: toAssignmentDto(current), after: closed },
      { userId: actorId, action: 'CREATE', entity: 'Assignment', entityId: created.id, after: created },
    );
    return { closed, created };
  });
}

async function findAssignmentOrThrow(tx: Prisma.TransactionClient, id: number) {
  const assignment = await tx.assignment.findUnique({ where: { id }, include: assignmentInclude });
  if (!assignment) {
    throw new HttpError(404, 'ASSIGNMENT_NOT_FOUND', 'Asignación no encontrada');
  }
  return assignment;
}

// Verifica que persona, proyecto y grupo existan y estén activos. Devuelve el proyecto.
async function loadParticipants(
  tx: Prisma.TransactionClient,
  { personId, projectId, paymentGroupId }: { personId: number; projectId: number; paymentGroupId: number },
) {
  const person = await tx.person.findUnique({ where: { id: personId } });
  const project = await tx.project.findUnique({ where: { id: projectId } });
  const group = await tx.paymentGroup.findUnique({ where: { id: paymentGroupId } });

  if (!person) throw new HttpError(400, 'INVALID_PERSON', 'La persona indicada no existe');
  if (!project) throw new HttpError(400, 'INVALID_PROJECT', 'El proyecto indicado no existe');
  if (!group) throw new HttpError(400, 'INVALID_PAYMENT_GROUP', 'El grupo de pago indicado no existe');
  if (!person.active) throw new HttpError(409, 'PERSON_INACTIVE', 'La persona está inactiva');
  if (!project.active) throw new HttpError(409, 'PROJECT_INACTIVE', 'El proyecto está inactivo');
  if (!group.active) throw new HttpError(409, 'PAYMENT_GROUP_INACTIVE', 'El grupo de pago está inactivo');

  return project;
}

function assertWithinProject(project: { startDate: Date; endDate: Date }, startDate: Date, endDate: Date | null) {
  const range = `${formatDateOnly(project.startDate)} al ${formatDateOnly(project.endDate)}`;

  if (startDate.getTime() < project.startDate.getTime() || startDate.getTime() > project.endDate.getTime()) {
    throw new HttpError(400, 'OUTSIDE_PROJECT', `La fecha de inicio debe estar dentro de la vigencia del proyecto (${range})`);
  }
  if (endDate && endDate.getTime() < startDate.getTime()) {
    throw new HttpError(400, 'INVALID_RANGE', 'La fecha de fin no puede ser anterior a la de inicio');
  }
  if (endDate && endDate.getTime() > project.endDate.getTime()) {
    throw new HttpError(400, 'OUTSIDE_PROJECT', `La fecha de fin debe estar dentro de la vigencia del proyecto (${range})`);
  }
}

// Una persona no puede tener dos asignaciones del mismo proyecto y grupo de pago con días en común,
// porque se le causaría dos veces el mismo período.
async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  assignment: { personId: number; projectId: number; paymentGroupId: number; startDate: Date; endDate: Date | null },
  projectEnd: Date,
  excludeId?: number,
) {
  const { personId, projectId, paymentGroupId, startDate } = assignment;
  const endDate = assignment.endDate ?? projectEnd;

  const overlapping = await tx.assignment.findFirst({
    where: {
      personId,
      projectId,
      paymentGroupId,
      id: excludeId === undefined ? undefined : { not: excludeId },
      startDate: { lte: endDate },
      OR: [{ endDate: null }, { endDate: { gte: startDate } }],
    },
  });

  if (overlapping) {
    const until = overlapping.endDate ? formatDateOnly(overlapping.endDate) : 'el fin del proyecto';
    throw new HttpError(
      409,
      'ASSIGNMENT_OVERLAP',
      `Ya existe una asignación de esta persona en el mismo proyecto y grupo de pago del ${formatDateOnly(overlapping.startDate)} al ${until}`,
    );
  }
}
