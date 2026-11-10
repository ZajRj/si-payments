import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/http-error.js';

type ErrorBody = { error: { code: string; message: string; details?: unknown } };
type Mapped = { status: number; body: ErrorBody };

const mapped = (status: number, code: string, message: string, details?: unknown): Mapped => ({
  status,
  body: { error: { code, message, ...(details === undefined ? {} : { details }) } },
});

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado'));
}

function mapError(error: unknown): Mapped | null {
  if (error instanceof HttpError) {
    return mapped(error.status, error.code, error.message);
  }

  if (error instanceof ZodError) {
    return mapped(400, 'VALIDATION_ERROR', 'Datos inválidos', z.flattenError(error).fieldErrors);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return mapped(409, 'CONFLICT', 'Ya existe un registro con esos datos');
      case 'P2003':
        return mapped(409, 'CONFLICT', 'La operación referencia o depende de otros registros');
      case 'P2025':
        return mapped(404, 'NOT_FOUND', 'Recurso no encontrado');
    }
    return null;
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return mapped(400, 'BAD_REQUEST', 'Petición inválida');
  }

  // Errores de body-parser, como un JSON malformado o un cuerpo demasiado grande.
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return mapped(status, 'BAD_REQUEST', 'Petición inválida');
  }

  return null;
}

// Manejador global de errores de Express. Nada de lo que falle en una ruta (síncrono o asíncrono,
// Express 5 reenvía las promesas rechazadas) llega al cliente con detalles internos: lo desconocido
// se registra en el servidor y responde 500 genérico.
export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(error);
    return;
  }

  const known = mapError(error);
  if (known) {
    res.status(known.status).json(known.body);
    return;
  }

  console.error(`Error no controlado en ${req.method} ${req.originalUrl}:`, error);
  const internal = mapped(500, 'INTERNAL_ERROR', 'Error interno del servidor');
  res.status(internal.status).json(internal.body);
}

// Última red para errores fuera del ciclo petición/respuesta. Tras una excepción no capturada el proceso
// puede quedar en un estado inconsistente, así que se registra y se cierra para que el orquestador lo reinicie.
export function registerProcessErrorHandlers(shutdown: (exitCode: number) => void) {
  process.on('unhandledRejection', (reason) => {
    console.error('Promesa rechazada sin manejar:', reason);
    shutdown(1);
  });
  process.on('uncaughtException', (error) => {
    console.error('Excepción no capturada:', error);
    shutdown(1);
  });
}
