import { createRouter, createWebHistory } from 'vue-router';
import AppLayout from '@/layouts/AppLayout.vue';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    permission?: string;
    navLabel?: string;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: AppLayout,
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
          meta: { navLabel: 'Inicio' },
        },
        {
          path: 'usuarios',
          name: 'users',
          component: () => import('@/views/UsersView.vue'),
          meta: { navLabel: 'Usuarios', permission: PERMISSIONS.USERS_READ },
        },
        {
          path: 'roles',
          name: 'roles',
          component: () => import('@/views/RolesView.vue'),
          meta: { navLabel: 'Roles y permisos', permission: PERMISSIONS.ROLES_READ },
        },
        {
          path: 'personas',
          name: 'people',
          component: () => import('@/views/PeopleView.vue'),
          meta: { navLabel: 'Personas', permission: PERMISSIONS.PEOPLE_READ },
        },
        {
          path: 'proyectos',
          name: 'projects',
          component: () => import('@/views/ProjectsView.vue'),
          meta: { navLabel: 'Proyectos', permission: PERMISSIONS.PROJECTS_READ },
        },
        {
          path: 'asignaciones',
          name: 'assignments',
          component: () => import('@/views/AssignmentsView.vue'),
          meta: { navLabel: 'Asignaciones', permission: PERMISSIONS.PROJECTS_READ },
        },
        {
          path: 'causacion',
          name: 'accruals',
          component: () => import('@/views/AccrualsView.vue'),
          meta: { navLabel: 'Causación', permission: PERMISSIONS.PAYROLL_READ },
        },
        {
          path: 'solicitudes-de-pago',
          name: 'payment-requests',
          component: () => import('@/views/PaymentRequestsView.vue'),
          meta: { navLabel: 'Solicitudes de pago', permission: PERMISSIONS.PAYROLL_READ },
        },
        {
          path: 'cajas-chicas',
          name: 'petty-cash',
          component: () => import('@/views/PettyCashView.vue'),
          meta: { navLabel: 'Cajas chicas', permission: PERMISSIONS.PETTY_CASH_READ },
        },
        {
          path: 'areas',
          name: 'areas',
          component: () => import('@/views/AreasView.vue'),
          meta: { navLabel: 'Áreas', permission: PERMISSIONS.CATALOGS_READ },
        },
        {
          path: 'grupos-de-pago',
          name: 'payment-groups',
          component: () => import('@/views/PaymentGroupsView.vue'),
          meta: { navLabel: 'Grupos de pago', permission: PERMISSIONS.CATALOGS_READ },
        },
        {
          path: 'parametros',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue'),
          meta: { navLabel: 'Parámetros', permission: PERMISSIONS.SETTINGS_MANAGE },
        },
        {
          path: 'auditoria',
          name: 'audit-log',
          component: () => import('@/views/AuditLogView.vue'),
          meta: { navLabel: 'Auditoría', permission: PERMISSIONS.AUDIT_READ },
        },
        {
          path: 'sin-acceso',
          name: 'forbidden',
          component: () => import('@/views/ForbiddenView.vue'),
        },
        {
          path: ':pathMatch(.*)*',
          name: 'not-found',
          component: () => import('@/views/NotFoundView.vue'),
        },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.ensureLoaded();

  if (to.meta.public) {
    return auth.isAuthenticated ? { name: 'dashboard' } : true;
  }
  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.permission && !auth.can(to.meta.permission)) {
    return { name: 'forbidden' };
  }
  return true;
});
