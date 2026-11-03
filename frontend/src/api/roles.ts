import { http } from './http';

export type Role = {
  id: number;
  code: string;
  name: string;
  description: string;
  permissions: { code: string; description: string }[];
};

export async function listRoles() {
  const { roles } = await http<{ roles: Role[] }>('/roles');
  return roles;
}
