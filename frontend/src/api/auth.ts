import { http } from './http';

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: { id: number; code: string; name: string };
  permissions: string[];
};

export async function login(email: string, password: string) {
  const { user } = await http<{ user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: { email, password },
    ignoreUnauthorized: true,
  });
  return user;
}

export async function fetchCurrentUser() {
  const { user } = await http<{ user: AuthUser }>('/auth/me', { ignoreUnauthorized: true });
  return user;
}

export function logout() {
  return http<void>('/auth/logout', { method: 'POST', ignoreUnauthorized: true });
}
