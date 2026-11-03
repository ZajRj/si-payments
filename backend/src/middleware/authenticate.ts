import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/http-error.js';
import { findActiveAuthUser, verifySessionToken, type AuthUser } from '../modules/auth/auth.service.js';

export const SESSION_COOKIE = 'session';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const userId = typeof token === 'string' ? verifySessionToken(token) : null;
  const user = userId === null ? null : await findActiveAuthUser(userId);

  if (!user) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Sesión inválida o expirada');
  }

  req.user = user;
  next();
}
