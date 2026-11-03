export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  // Un 401 aquí es una respuesta esperada (login, comprobar sesión), no una sesión expirada.
  ignoreUnauthorized?: boolean;
};

let unauthorizedHandler: (() => void) | undefined;

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

export async function http<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, ignoreUnauthorized = false } = options;

  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && !ignoreUnauthorized) {
      unauthorizedHandler?.();
    }
    const error = data?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? 'No se pudo completar la petición',
      error?.details,
    );
  }

  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const firstDetail = Object.values(error.details ?? {})[0]?.[0];
    return firstDetail ? `${error.message}: ${firstDetail}` : error.message;
  }
  return 'No se pudo conectar con el servidor';
}
