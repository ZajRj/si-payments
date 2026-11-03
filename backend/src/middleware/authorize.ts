import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/http-error.js';
import type { Permission } from '../rbac/permissions.js';

// Debe usarse después de `authenticate`. Exige todos los permisos indicados.
export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const granted = req.user?.permissions ?? [];

    if (!required.every((permission) => granted.includes(permission))) {
      throw new HttpError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción');
    }

    next();
  };
}
