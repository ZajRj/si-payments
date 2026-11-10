import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HttpError } from '../src/lib/http-error.js';
import { pageArgs, pageResult, paginationQuerySchema } from '../src/lib/pagination.js';
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { app, loginAs } from './helpers.js';

describe('paginación', () => {
  it('valores por defecto, límites y cálculo de skip/take', () => {
    const schema = paginationQuerySchema({ defaultPageSize: 20, maxPageSize: 100 });
    expect(schema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(schema.parse({ page: '3', pageSize: '10' })).toEqual({ page: 3, pageSize: 10 });
    expect(() => schema.parse({ pageSize: '101' })).toThrow();
    expect(() => schema.parse({ page: '0' })).toThrow();
    expect(pageArgs({ page: 3, pageSize: 10 })).toEqual({ skip: 20, take: 10 });
  });

  it('forma común de la respuesta', () => {
    expect(pageResult(['a'], 21, { page: 3, pageSize: 10 })).toEqual({ items: ['a'], total: 21, page: 3, pageSize: 10, pageCount: 3 });
    expect(pageResult([], 0, { page: 1, pageSize: 10 }).pageCount).toBe(0);
  });

  it('el registro de auditoría sigue paginando', async () => {
    const admin = await loginAs('admin@example.com');
    const res = await admin.get('/api/audit-log?pageSize=1').expect(200);
    expect(res.body.entries.length).toBeLessThanOrEqual(1);
    expect(res.body).toMatchObject({ page: 1, pageSize: 1 });
    expect(typeof res.body.total).toBe('number');
    await admin.get('/api/audit-log?pageSize=1000').expect(400);
  });
});

function errorApp(fail: () => unknown) {
  const instance = express();
  instance.get('/boom', async () => {
    throw fail();
  });
  instance.use(notFoundHandler);
  instance.use(errorHandler);
  return instance;
}

const knownError = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

describe('manejador global de errores', () => {
  it.each([
    ['HttpError', () => new HttpError(409, 'DUP', 'Duplicado'), 409, 'DUP'],
    ['Zod', () => z.object({ a: z.string() }).parse({}), 400, 'VALIDATION_ERROR'],
    ['Prisma P2002', () => knownError('P2002'), 409, 'CONFLICT'],
    ['Prisma P2003', () => knownError('P2003'), 409, 'CONFLICT'],
    ['Prisma P2025', () => knownError('P2025'), 404, 'NOT_FOUND'],
  ])('%s', async (_name, fail, status, code) => {
    const res = await request(errorApp(fail)).get('/boom').expect(status);
    expect(res.body.error.code).toBe(code);
  });

  it('error inesperado: 500 genérico, sin filtrar el mensaje, y queda registrado', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(errorApp(() => new Error('secreto interno'))).get('/boom').expect(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } });
    expect(JSON.stringify(res.body)).not.toContain('secreto');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('ruta inexistente y JSON malformado', async () => {
    await request(app).get('/api/no-existe').expect(404);
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{malo').expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
