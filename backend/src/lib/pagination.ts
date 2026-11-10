import { z } from 'zod';

// Paginación común a todo el proyecto. Las rutas que listan muchos registros validan la query con
// `paginationQuerySchema()`, pasan `skip`/`take` a Prisma y responden con `pageResult()`.

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function paginationQuerySchema({ defaultPageSize = DEFAULT_PAGE_SIZE, maxPageSize = MAX_PAGE_SIZE } = {}) {
  return z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(maxPageSize).default(defaultPageSize),
  });
}

export type PaginationQuery = z.infer<ReturnType<typeof paginationQuerySchema>>;

// Argumentos `skip` y `take` de Prisma para la página pedida.
export function pageArgs({ page, pageSize }: PaginationQuery) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number };

export function pageResult<T>(items: T[], total: number, { page, pageSize }: PaginationQuery): Page<T> {
  return { items, total, page, pageSize, pageCount: Math.ceil(total / pageSize) };
}
