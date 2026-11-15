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
  deleteDate: true,
  deletedById: true,
  deletedBy: { select: { id: true, name: true, email: true } },
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect;

type RawPublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export type UserDto = {
  id: number;
  email: string;
  name: string;
  active: boolean;
  deleteDate: Date | null;
  delete_date: Date | null;
  deletedById: number | null;
  deleted_by_id: number | null;
  deletedBy: { id: number; name: string; email: string } | null;
  deleted_by: { id: number; name: string; email: string } | null;
  createdAt: Date;
  updatedAt: Date;
  role: { id: number; code: string; name: string };
};

function toUserDto(user: RawPublicUser): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    active: user.active,
    deleteDate: user.deleteDate,
    delete_date: user.deleteDate,
    deletedById: user.deletedById,
    deleted_by_id: user.deletedById,
    deletedBy: user.deletedBy,
    deleted_by: user.deletedBy,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    role: user.role,
  };
}

type CreateUserInput = {
  email: string;
  name: string;
  password: string;
  roleId: number;
};

type UpdateUserInput = Partial<CreateUserInput> & { active?: boolean };

export async function listUsers(filter?: { includeDeleted?: boolean }): Promise<UserDto[]> {
  const where = filter?.includeDeleted === false ? { deleteDate: null } : undefined;
  const users = await prisma.user.findMany({ where, select: publicUserSelect, orderBy: { name: 'asc' } });
  return users.map(toUserDto);
}

export async function createUser(actorId: number, { password, ...data }: CreateUserInput): Promise<UserDto> {
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { ...data, passwordHash }, select: publicUserSelect });
      const userDto = toUserDto(user);
      await audit(tx, { userId: actorId, action: 'CREATE', entity: 'User', entityId: user.id, after: userDto });
      return userDto;
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

export async function updateUser(actorId: number, id: number, { password, ...data }: UpdateUserInput): Promise<UserDto> {
  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: publicUserSelect });
      if (!current) {
        throw new HttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
      }

      if (current.deleteDate) {
        throw new HttpError(400, 'USER_DELETED', 'No se puede modificar un usuario eliminado');
      }

      // Como nadie puede quitarse su propio acceso, siempre queda al menos un administrador activo.
      const changesRole = data.roleId !== undefined && data.roleId !== current.role.id;
      if (id === actorId && (data.active === false || changesRole)) {
        throw new HttpError(409, 'SELF_LOCKOUT', 'No puedes cambiar tu propio rol ni desactivar tu propia cuenta');
      }

      // Guardar sin cambios no toca la base de datos ni deja un registro vacío en la auditoría.
      const unchanged =
        !passwordHash &&
        !changesRole &&
        (data.name === undefined || data.name === current.name) &&
        (data.email === undefined || data.email === current.email) &&
        (data.active === undefined || data.active === current.active);
      if (unchanged) return toUserDto(current);

      const updated = await tx.user.update({ where: { id }, data: { ...data, passwordHash }, select: publicUserSelect });
      const user = toUserDto(updated);
      // El hash nunca se guarda en la auditoría; solo se deja constancia del cambio de contraseña.
      const after = passwordHash ? { ...user, passwordChanged: true } : user;
      await audit(tx, { userId: actorId, action: 'UPDATE', entity: 'User', entityId: id, before: toUserDto(current), after });
      return user;
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

export async function deleteUser(actorId: number, id: number): Promise<UserDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: publicUserSelect });
      if (!current) {
        throw new HttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
      }

      if (id === actorId) {
        throw new HttpError(409, 'SELF_LOCKOUT', 'No puedes eliminar tu propia cuenta');
      }

      if (current.deleteDate) {
        throw new HttpError(400, 'USER_ALREADY_DELETED', 'El usuario ya ha sido eliminado');
      }

      const deleted = await tx.user.update({
        where: { id },
        data: {
          deleteDate: new Date(),
          deletedById: actorId,
          active: false,
        },
        select: publicUserSelect,
      });

      const user = toUserDto(deleted);
      await audit(tx, {
        userId: actorId,
        action: 'DELETE',
        entity: 'User',
        entityId: id,
        before: toUserDto(current),
        after: user,
      });
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
