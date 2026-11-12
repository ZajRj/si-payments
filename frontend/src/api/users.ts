import { http } from './http';

export type User = {
  id: number;
  email: string;
  name: string;
  active: boolean;
  deleteDate: string | null;
  delete_date?: string | null;
  deletedById?: number | null;
  deleted_by_id?: number | null;
  deletedBy?: { id: number; name: string; email: string } | null;
  deleted_by?: { id: number; name: string; email: string } | null;
  createdAt?: string;
  updatedAt?: string;
  role: { id: number; code: string; name: string };
};

export type CreateUserPayload = {
  email: string;
  name: string;
  password: string;
  roleId: number;
};

export type UpdateUserPayload = Partial<CreateUserPayload> & { active?: boolean };

export async function listUsers(params?: { includeDeleted?: boolean }) {
  const query = params?.includeDeleted !== undefined ? `?includeDeleted=${params.includeDeleted}` : '';
  const { users } = await http<{ users: User[] }>(`/users${query}`);
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

export async function deleteUser(id: number) {
  const { user } = await http<{ user: User }>(`/users/${id}`, { method: 'DELETE' });
  return user;
}
