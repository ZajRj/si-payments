import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: { id: number; code: string; name: string };
  permissions: string[];
};

const authUserInclude = {
  role: { include: { permissions: { include: { permission: true } } } },
} satisfies Prisma.UserInclude;

type UserWithRole = Prisma.UserGetPayload<{ include: typeof authUserInclude }>;

// Hace que un email inexistente tarde lo mismo que una contraseña incorrecta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password', 10);

function toAuthUser(user: UserWithRole): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: { id: user.role.id, code: user.role.code, name: user.role.name },
    permissions: user.role.permissions.map(({ permission }) => permission.code),
  };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { email }, include: authUserInclude });
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  // Cuenta inexistente, eliminada o contraseña incorrecta: el mismo mensaje, para no revelar qué correos existen.
  if (!user || user.deleteDate || !passwordMatches) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
  }
  // Solo quien conoce la contraseña se entera de que la cuenta está desactivada, y así sabe a quién acudir.
  if (!user.active) {
    throw new HttpError(
      403,
      'ACCOUNT_INACTIVE',
      'Tu cuenta está desactivada. Pide al administrador del sistema que la reactive',
    );
  }

  return toAuthUser(user);
}

// Se consulta en cada petición para que los cambios de rol o la desactivación apliquen de inmediato.
export async function findActiveAuthUser(id: number): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id }, include: authUserInclude });
  return user?.active && !user.deleteDate ? toAuthUser(user) : null;
}

export function signSessionToken(userId: number): string {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(userId),
    expiresIn: `${env.JWT_EXPIRES_IN_HOURS}h`,
  });
}

export function verifySessionToken(token: string): number | null {
  try {
    const { sub } = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const userId = Number(sub);
    return Number.isInteger(userId) ? userId : null;
  } catch {
    return null;
  }
}
