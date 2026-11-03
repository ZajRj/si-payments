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

  return { user, isAuthenticated, can, ensureLoaded, login, logout, clear };
});
