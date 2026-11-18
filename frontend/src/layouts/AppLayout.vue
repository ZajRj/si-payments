<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import CommandPalette from '@/components/CommandPalette.vue';
import { useAuthStore } from '@/stores/auth';
import { usePendingStore } from '@/stores/pending';

const auth = useAuthStore();
const pending = usePendingStore();
const route = useRoute();
const router = useRouter();

const GROUP_ORDER = ['', 'Operación', 'Pagos', 'Control', 'Catálogos', 'Administración'];

// Enlaces visibles para el usuario, agrupados por sección.
const navItems = computed(() =>
  router.getRoutes().filter(({ meta }) => {
    const permission = meta.navPermission ?? meta.permission;
    return meta.navLabel && (!permission || auth.can(permission));
  }),
);
const navGroups = computed(() =>
  GROUP_ORDER.map((name) => ({ name, items: navItems.value.filter((item) => (item.meta.navGroup ?? '') === name) })).filter(
    (group) => group.items.length > 0,
  ),
);
const paletteItems = computed(() =>
  navItems.value.map((item) => ({ path: item.path, label: item.meta.navLabel!, icon: item.meta.navIcon })),
);

// La sección también queda marcada en sus páginas de detalle (/proyectos/5, /reportes/personas/12).
function isNavActive(path: string) {
  return path !== '/' && route.path.startsWith(`${path}/`);
}

// Cuántos registros esperan una acción del usuario en cada sección.
function pendingCount(name: unknown) {
  return pending.counts[String(name) as keyof typeof pending.counts] ?? 0;
}

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

// Los contadores se recalculan al navegar; las vistas que cambian estados también los recargan.
watch(
  () => route.path,
  () => void pending.refresh().catch(() => undefined),
  { immediate: true },
);

// Búsqueda rápida: Ctrl K (Cmd K en Mac) desde cualquier pantalla.
const paletteOpen = ref(false);

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    paletteOpen.value = !paletteOpen.value;
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

async function logout() {
  await auth.logout();
  pending.clear();
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
      <button type="button" class="icon-button mobile-search" aria-label="Buscar" @click="paletteOpen = true">
        <AppIcon name="search" :size="20" />
      </button>
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

      <button type="button" class="search-trigger" aria-keyshortcuts="Control+K" @click="paletteOpen = true">
        <AppIcon name="search" :size="16" />
        <span>Buscar…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <nav class="side-nav" aria-label="Principal">
        <div v-for="group in navGroups" :key="group.name" class="side-group">
          <p v-if="group.name" class="side-group-title">{{ group.name }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="side-link"
            :class="{ 'is-active': isNavActive(item.path) }"
          >
            <AppIcon v-if="item.meta.navIcon" :name="item.meta.navIcon" />
            <span class="side-link-label">{{ item.meta.navLabel }}</span>
            <span v-if="pendingCount(item.name)" class="side-count">
              {{ pendingCount(item.name) }}<span class="sr-only"> pendientes</span>
            </span>
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

    <CommandPalette :open="paletteOpen" :nav-items="paletteItems" @close="paletteOpen = false" />
  </div>
</template>
