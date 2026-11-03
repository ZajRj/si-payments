<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const navItems = computed(() =>
  router
    .getRoutes()
    .filter(({ meta }) => meta.navLabel && (!meta.permission || auth.can(meta.permission))),
);

async function logout() {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <strong class="brand">Control de Pagos</strong>
      <nav class="nav" aria-label="Principal">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path">
          {{ item.meta.navLabel }}
        </RouterLink>
      </nav>
      <div class="session">
        <span class="session-user">{{ auth.user?.name }} · {{ auth.user?.role.name }}</span>
        <button type="button" class="button" @click="logout">Salir</button>
      </div>
    </header>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
