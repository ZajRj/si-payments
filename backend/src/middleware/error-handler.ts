import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { HttpError } from '../lib/http-error.js';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado'));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: z.flattenError(error).fieldErrors },
    });
    return;
  }

  // Errores de body-parser, como un JSON malformado o un cuerpo demasiado grande.
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Petición inválida' } });
    return;
  }

  console.error(error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } });
}
