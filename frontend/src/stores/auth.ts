import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as authApi from '@/api/auth';
import type { AuthUser } from '@/api/auth';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  let loaded = false;

  const isAuthenticated = computed(() => user.value !== null);

  function can(permission: string) {
    return user.value?.permissions.includes(permission) ?? false;
  }

  async function ensureLoaded() {
    if (loaded) return;
    try {
      user.value = await authApi.fetchCurrentUser();
    } catch {
      user.value = null;
    }
    loaded = true;
  }

  // Vuelve a preguntar al servidor: la sesión pudo cerrarse o cambiar de usuario en otra pestaña.
  async function revalidate() {
    const previousId = user.value?.id ?? null;
    try {
      user.value = await authApi.fetchCurrentUser();
    } catch {
      user.value = null;
    }
    loaded = true;
    return user.value?.id === previousId;
  }

  async function login(email: string, password: string) {
    user.value = await authApi.login(email, password);
    loaded = true;
  }

  async function logout() {
    await authApi.logout();
    clear();
  }

  function clear() {
    user.value = null;
    loaded = true;
  }

  return { user, isAuthenticated, can, ensureLoaded, revalidate, login, logout, clear };
});
