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
