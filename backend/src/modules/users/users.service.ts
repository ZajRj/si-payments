import bcrypt from 'bcryptjs';
import { Prisma } from '../../generated/prisma/client.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect;

type CreateUserInput = {
  email: string;
  name: string;
  password: string;
  roleId: number;
};

type UpdateUserInput = Partial<CreateUserInput> & { active?: boolean };

export function listUsers() {
  return prisma.user.findMany({ select: publicUserSelect, orderBy: { name: 'asc' } });
}

export async function createUser(actorId: number, { password, ...data }: CreateUserInput) {
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { ...data, passwordHash }, select: publicUserSelect });
      await audit(tx, { userId: actorId, action: 'CREATE', entity: 'User', entityId: user.id, after: user });
      return user;
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

export async function updateUser(actorId: number, id: number, { password, ...data }: UpdateUserInput) {
  const current = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  if (!current) {
    throw new HttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
  }

  // Como nadie puede quitarse su propio acceso, siempre queda al menos un administrador activo.
  const changesOwnRole = data.roleId !== undefined && data.roleId !== current.role.id;
  if (id === actorId && (data.active === false || changesOwnRole)) {
    throw new HttpError(409, 'SELF_LOCKOUT', 'No puedes cambiar tu propio rol ni desactivar tu propia cuenta');
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data: { ...data, passwordHash }, select: publicUserSelect });
      // El hash nunca se guarda en la auditoría; solo se deja constancia del cambio de contraseña.
      const after = passwordHash ? { ...user, passwordChanged: true } : user;
      await audit(tx, { userId: actorId, action: 'UPDATE', entity: 'User', entityId: id, before: current, after });
      return user;
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

function translatePrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new HttpError(409, 'EMAIL_TAKEN', 'Ya existe un usuario con ese email');
    }
    if (error.code === 'P2003') {
      return new HttpError(400, 'INVALID_ROLE', 'El rol indicado no existe');
    }
  }
  return error;
}
