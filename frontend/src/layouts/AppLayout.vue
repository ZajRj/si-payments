<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const GROUP_ORDER = ['', 'Operación', 'Nómina', 'Catálogos', 'Administración'];

// Enlaces visibles para el usuario, agrupados por sección.
const navGroups = computed(() => {
  const items = router
    .getRoutes()
    .filter(({ meta }) => meta.navLabel && (!meta.permission || auth.can(meta.permission)));
  return GROUP_ORDER.map((name) => ({ name, items: items.filter((item) => (item.meta.navGroup ?? '') === name) })).filter(
    (group) => group.items.length > 0,
  );
});

const initials = computed(() =>
  (auth.user?.name ?? '')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase(),
);

// En pantallas angostas la barra lateral es un panel que se abre con el botón de menú.
const menuOpen = ref(false);
watch(() => route.fullPath, () => (menuOpen.value = false));

async function logout() {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <div class="shell" :class="{ 'menu-open': menuOpen }">
    <header class="mobile-bar">
      <button type="button" class="icon-button" aria-label="Abrir menú" :aria-expanded="menuOpen" @click="menuOpen = true">
        <AppIcon name="menu" :size="22" />
      </button>
      <span class="brand-name">Control de Pagos</span>
    </header>
    <div class="scrim" aria-hidden="true" @click="menuOpen = false" />

    <aside class="sidebar" aria-label="Menú principal">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><AppIcon name="coins" :size="18" /></span>
        <span>
          <span class="brand-name">Control de Pagos</span>
          <span class="brand-sub">y Asignaciones</span>
        </span>
        <button type="button" class="icon-button sidebar-close" aria-label="Cerrar menú" @click="menuOpen = false">
          <AppIcon name="close" :size="20" />
        </button>
      </div>

      <nav class="side-nav" aria-label="Principal">
        <div v-for="group in navGroups" :key="group.name" class="side-group">
          <p v-if="group.name" class="side-group-title">{{ group.name }}</p>
          <RouterLink v-for="item in group.items" :key="item.path" :to="item.path" class="side-link">
            <AppIcon v-if="item.meta.navIcon" :name="item.meta.navIcon" />
            <span>{{ item.meta.navLabel }}</span>
          </RouterLink>
        </div>
      </nav>

      <div class="side-user">
        <span class="avatar" aria-hidden="true">{{ initials }}</span>
        <span class="side-user-text">
          <strong>{{ auth.user?.name }}</strong>
          <span>{{ auth.user?.role.name }}</span>
        </span>
        <button type="button" class="icon-button" aria-label="Cerrar sesión" title="Cerrar sesión" @click="logout">
          <AppIcon name="logout" />
        </button>
      </div>
    </aside>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
