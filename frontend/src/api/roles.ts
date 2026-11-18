import { http } from './http';

export type PermissionItem = {
  code: string;
  description: string;
};

export type Role = {
  id: number;
  code: string;
  name: string;
  description: string;
  permissions: PermissionItem[];
};

export async function listRoles() {
  const { roles } = await http<{ roles: Role[] }>('/roles');
  return roles;
}

export async function listRolesAndPermissions() {
  const data = await http<{ roles: Role[]; permissions?: PermissionItem[] }>('/roles');
  return {
    roles: data.roles,
    permissions: data.permissions ?? [],
  };
}
