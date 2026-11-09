import type { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { addDays, businessToday, formatDateOnly } from '../../lib/dates.js';
import { HttpError } from '../../lib/http-error.js';
import { sameName } from '../../lib/names.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { openAssignmentWhere } from '../assignments/open-assignments.js';
import { buildPeriods, normalizeRule, toPeriodDto, type Frequency } from './periods.js';

type CreateGroupInput = { name: string; frequency: Frequency; cutoffDay?: number | null };
type UpdateGroupInput = Partial<CreateGroupInput> & { active?: boolean };
type GenerateInput = { from?: Date; until: Date };

export async function listPaymentGroups() {
  const groups = await prisma.paymentGroup.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { periods: true } } },
  });
  return groups.map(({ _count, ...group }) => ({ ...group, periodCount: _count.periods }));
}

export async function createPaymentGroup(actorId: number, { name, frequency, cutoffDay }: CreateGroupInput) {
  const rule = normalizeRule(frequency, cutoffDay);

  try {
    return await prisma.$transaction(async (tx) => {
      await assertNameAvailable(tx, name);
      const group = await tx.paymentGroup.create({ data: { name, ...rule } });
      await audit(tx, { userId: actorId, action: 'CREATE', entity: 'PaymentGroup', entityId: group.id, after: group });
      return group;
    });
  } catch (error) {
    throw translateError(error);
  }
}

export async function updatePaymentGroup(actorId: number, id: number, data: UpdateGroupInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await findGroupOrThrow(tx, id);
      if (data.name !== undefined) {
        await assertNameAvailable(tx, data.name, id);
      }
      if (before.active && data.active === false) {
        const open = await tx.assignment.count({ where: { paymentGroupId: id, ...openAssignmentWhere(businessToday()) } });
        if (open > 0) {
          throw new HttpError(
            409,
            'PAYMENT_GROUP_HAS_OPEN_ASSIGNMENTS',
            'El grupo de pago tiene asignaciones vigentes. Ciérralas antes de desactivarlo',
          );
        }
      }

      // Al cambiar la periodicidad sin indicar corte, se aplica el corte por defecto de la nueva periodicidad.
      const frequency = data.frequency ?? (before.frequency as Frequency);
      const frequencyChanged = frequency !== before.frequency;
      const cutoffDay = data.cutoffDay !== undefined ? data.cutoffDay : frequencyChanged ? null : before.cutoffDay;
      const rule = normalizeRule(frequency, cutoffDay);

      const group = await tx.paymentGroup.update({
        where: { id },
        data: { name: data.name, active: data.active, ...rule },
      });
      await audit(tx, { userId: actorId, action: 'UPDATE', entity: 'PaymentGroup', entityId: id, before, after: group });
      return group;
    });
  } catch (error) {
    throw translateError(error);
  }
}

export async function listPeriods(groupId: number) {
  await findGroupOrThrow(prisma, groupId);
  const periods = await prisma.period.findMany({ where: { paymentGroupId: groupId }, orderBy: { startDate: 'asc' } });
  return periods.map(toPeriodDto);
}

export async function generatePeriods(actorId: number, groupId: number, { from, until }: GenerateInput) {
  return prisma.$transaction(async (tx) => {
    const group = await findGroupOrThrow(tx, groupId);
    if (!group.active) {
      throw new HttpError(409, 'GROUP_INACTIVE', 'El grupo de pago está inactivo');
    }

    const last = await tx.period.findFirst({ where: { paymentGroupId: groupId }, orderBy: { startDate: 'desc' } });
    if (last && from) {
      throw new HttpError(
        409,
        'PERIODS_ALREADY_STARTED',
        `El grupo ya tiene períodos. La generación continúa desde ${formatDateOnly(addDays(last.endDate, 1))}`,
      );
    }
    if (!last && !from) {
      throw new HttpError(400, 'START_DATE_REQUIRED', 'Indica la fecha de inicio del primer período');
    }

    const start = last ? addDays(last.endDate, 1) : from!;
    if (until.getTime() < start.getTime()) {
      throw new HttpError(400, 'INVALID_RANGE', `La fecha final debe ser igual o posterior a ${formatDateOnly(start)}`);
    }

    const rule = normalizeRule(group.frequency as Frequency, group.cutoffDay);
    const created = await tx.period.createManyAndReturn({
      data: buildPeriods(rule, start, until).map((period) => ({ ...period, paymentGroupId: groupId })),
    });

    const periods = created.map(toPeriodDto);
    await audit(
      tx,
      ...periods.map((period) => ({
        userId: actorId,
        action: 'CREATE' as const,
        entity: 'Period',
        entityId: period.id,
        after: period,
      })),
    );
    return periods;
  });
}

// Solo se puede quitar el último período, para que la secuencia siga sin huecos y se pueda ajustar un corte.
// Un período con causaciones, aunque estén anuladas, ya no se puede quitar.
export async function deleteLastPeriod(actorId: number, groupId: number) {
  return prisma.$transaction(async (tx) => {
    await findGroupOrThrow(tx, groupId);

    const last = await tx.period.findFirst({ where: { paymentGroupId: groupId }, orderBy: { startDate: 'desc' } });
    if (!last) {
      throw new HttpError(404, 'PERIOD_NOT_FOUND', 'El grupo no tiene períodos');
    }
    if ((await tx.accrualBatch.count({ where: { periodId: last.id } })) > 0) {
      throw new HttpError(409, 'PERIOD_HAS_ACCRUALS', 'El período tiene causaciones y ya no se puede eliminar');
    }

    await tx.period.delete({ where: { id: last.id } });
    const period = toPeriodDto(last);
    await audit(tx, { userId: actorId, action: 'DELETE', entity: 'Period', entityId: last.id, before: period });
    return period;
  });
}

async function findGroupOrThrow(client: Pick<typeof prisma, 'paymentGroup'>, id: number) {
  const group = await client.paymentGroup.findUnique({ where: { id } });
  if (!group) {
    throw new HttpError(404, 'PAYMENT_GROUP_NOT_FOUND', 'Grupo de pago no encontrado');
  }
  return group;
}

async function assertNameAvailable(tx: Prisma.TransactionClient, name: string, excludeId?: number) {
  const groups = await tx.paymentGroup.findMany({ select: { id: true, name: true } });
  if (groups.some((group) => group.id !== excludeId && sameName(group.name, name))) {
    throw nameTaken();
  }
}

function nameTaken() {
  return new HttpError(409, 'PAYMENT_GROUP_NAME_TAKEN', 'Ya existe un grupo de pago con ese nombre');
}

function translateError(error: unknown) {
  return isUniqueViolation(error) ? nameTaken() : error;
}
