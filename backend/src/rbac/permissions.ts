export const PERMISSIONS = {
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  ROLES_READ: 'roles:read',
  SETTINGS_MANAGE: 'settings:manage',
  CATALOGS_READ: 'catalogs:read',
  CATALOGS_MANAGE: 'catalogs:manage',
  AUDIT_READ: 'audit:read',
  PEOPLE_READ: 'people:read',
  PEOPLE_MANAGE: 'people:manage',
  PROJECTS_READ: 'projects:read',
  PROJECTS_MANAGE: 'projects:manage',
  ASSIGNMENTS_MANAGE: 'assignments:manage',
  ACCRUALS_GENERATE: 'accruals:generate',
  PAYMENT_REQUESTS_CREATE: 'payment-requests:create',
  PAYMENT_REQUESTS_DECIDE: 'payment-requests:decide',
  PAYMENTS_REGISTER: 'payments:register',
  PETTY_CASH_REQUEST: 'petty-cash:request',
  PETTY_CASH_MANAGE: 'petty-cash:manage',
  REPORTS_READ: 'reports:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'users:read': 'Consultar usuarios',
  'users:manage': 'Crear y modificar usuarios',
  'roles:read': 'Consultar roles y permisos',
  'settings:manage': 'Gestionar parámetros del sistema',
  'catalogs:read': 'Consultar catálogos, grupos de pago y períodos',
  'catalogs:manage': 'Gestionar catálogos, grupos de pago y períodos',
  'audit:read': 'Consultar el log de auditoría',
  'people:read': 'Consultar personas (beneficiarios)',
  'people:manage': 'Gestionar personas (beneficiarios)',
  'projects:read': 'Consultar proyectos y asignaciones',
  'projects:manage': 'Gestionar proyectos',
  'assignments:manage': 'Gestionar asignaciones',
  'accruals:generate': 'Generar causación y nómina por lote',
  'payment-requests:create': 'Crear y enviar solicitudes de pago',
  'payment-requests:decide': 'Aprobar o rechazar solicitudes de pago',
  'payments:register': 'Registrar la entrega de fondos',
  'petty-cash:request': 'Solicitar y rendir vales de caja chica',
  'petty-cash:manage': 'Abrir cajas chicas, aprobar y desembolsar vales',
  'reports:read': 'Consultar reportes y generar PDFs',
};

export const ROLE_CODES = {
  ADMIN: 'ADMIN',
  PAYROLL_GENERATOR: 'PAYROLL_GENERATOR',
  PAYROLL_RECEIVER: 'PAYROLL_RECEIVER',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

const P = PERMISSIONS;

// Matriz de segregación de funciones (proyecto.md, sección 2.1).
export const ROLES: Record<RoleCode, { name: string; description: string; permissions: Permission[] }> = {
  ADMIN: {
    name: 'Administrador del Sistema',
    description: 'Gestiona usuarios, parámetros y catálogos. No participa en operaciones de dinero.',
    permissions: [
      P.USERS_READ,
      P.USERS_MANAGE,
      P.ROLES_READ,
      P.SETTINGS_MANAGE,
      P.CATALOGS_READ,
      P.CATALOGS_MANAGE,
      P.AUDIT_READ,
    ],
  },
  PAYROLL_GENERATOR: {
    name: 'Generador de Nómina',
    description: 'Gestiona proyectos, asignaciones y personas. Genera la causación y crea las solicitudes de pago.',
    permissions: [
      P.CATALOGS_READ,
      P.PEOPLE_READ,
      P.PEOPLE_MANAGE,
      P.PROJECTS_READ,
      P.PROJECTS_MANAGE,
      P.ASSIGNMENTS_MANAGE,
      P.ACCRUALS_GENERATE,
      P.PAYMENT_REQUESTS_CREATE,
      P.PETTY_CASH_REQUEST,
      P.REPORTS_READ,
    ],
  },
  PAYROLL_RECEIVER: {
    name: 'Receptor de Nómina',
    description: 'Recibe, aprueba o rechaza las solicitudes de pago y registra la entrega de fondos.',
    permissions: [
      P.CATALOGS_READ,
      P.PEOPLE_READ,
      P.PROJECTS_READ,
      P.PAYMENT_REQUESTS_DECIDE,
      P.PAYMENTS_REGISTER,
      P.PETTY_CASH_MANAGE,
      P.REPORTS_READ,
    ],
  },
};
