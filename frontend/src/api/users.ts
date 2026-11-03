import { http } from './http';

export type User = {
  id: number;
  email: string;
  name: string;
  active: boolean;
  role: { id: number; code: string; name: string };
};

export type CreateUserPayload = {
  email: string;
  name: string;
  password: string;
  roleId: number;
};

export type UpdateUserPayload = Partial<CreateUserPayload> & { active?: boolean };

export async function listUsers() {
  const { users } = await http<{ users: User[] }>('/users');
  return users;
}

export async function createUser(payload: CreateUserPayload) {
  const { user } = await http<{ user: User }>('/users', { method: 'POST', body: payload });
  return user;
}

export async function updateUser(id: number, payload: UpdateUserPayload) {
  const { user } = await http<{ user: User }>(`/users/${id}`, { method: 'PATCH', body: payload });
  return user;
}
