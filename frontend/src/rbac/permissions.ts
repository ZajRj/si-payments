// Solo decide qué se muestra en la interfaz. La autorización real la aplica el backend.
export const PERMISSIONS = {
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  ROLES_READ: 'roles:read',
} as const;
