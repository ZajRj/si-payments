<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { listRolesAndPermissions, type PermissionItem, type Role } from '@/api/roles';
import StatusBadge from '@/components/StatusBadge.vue';

const roles = ref<Role[]>([]);
const allPermissions = ref<PermissionItem[]>([]);
const selectedRoleId = ref<number | null>(null);
const searchQuery = ref('');
const loading = ref(true);
const error = ref('');

const selectedRole = computed(() => roles.value.find((r) => r.id === selectedRoleId.value));

const activePermissionCodes = computed(() => {
  return new Set(selectedRole.value?.permissions.map((p) => p.code) ?? []);
});

const activeCount = computed(() => activePermissionCodes.value.size);

const filteredPermissions = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) {
    return allPermissions.value;
  }
  return allPermissions.value.filter(
    (p) => p.description.toLowerCase().includes(query) || p.code.toLowerCase().includes(query),
  );
});

function isPermissionEnabled(code: string): boolean {
  return activePermissionCodes.value.has(code);
}

onMounted(async () => {
  try {
    const data = await listRolesAndPermissions();
    roles.value = data.roles;

    // Si la API devolvió lista de todos los permisos, úsala; si no, recopila los únicos de los roles
    if (data.permissions && data.permissions.length > 0) {
      allPermissions.value = data.permissions;
    } else {
      const unique = new Map(roles.value.flatMap((r) => r.permissions).map((p) => [p.code, p]));
      allPermissions.value = [...unique.values()].sort((a, b) => a.code.localeCompare(b.code));
    }

    if (roles.value.length > 0) {
      selectedRoleId.value = roles.value[0].id;
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-header">
    <h1>Roles y permisos</h1>
  </div>
  <p class="hint">
    Qué puede hacer cada rol. La matriz sigue la segregación de funciones del proyecto: se define en el sistema y no se
    modifica desde aquí, para que ningún rol pueda darse permisos que no le corresponden.
  </p>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <div v-else>
    <!-- Selector de Rol -->
    <div class="role-selector-card">
      <div class="role-selector-group">
        <label for="role-select" class="role-selector-label">Rol:</label>
        <select id="role-select" v-model.number="selectedRoleId" class="role-selector-select">
          <option v-for="role in roles" :key="role.id" :value="role.id">
            {{ role.name }}
          </option>
        </select>
      </div>
    </div>

    <!-- Barra de resumen y filtro de permisos -->
    <div class="permissions-summary-bar">
      <div>
        <span>Permisos para <strong>{{ selectedRole?.name }}</strong>: </span>
        <span class="permissions-badge-count">
          {{ activeCount }} de {{ allPermissions.length }} asignados
        </span>
      </div>

      <div class="permissions-summary-actions">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Buscar permiso…"
          class="permissions-search-input"
          aria-label="Buscar permiso"
        />
      </div>
    </div>

    <!-- Lista de permisos del rol (solo lectura) -->
    <div class="permissions-list-container">
      <div
        v-for="permission in filteredPermissions"
        :key="permission.code"
        class="permission-item-card"
        :class="{ 'is-active': isPermissionEnabled(permission.code) }"
      >
        <div class="permission-info">
          <span class="permission-desc">{{ permission.description }}</span>
          <code class="permission-code-badge">{{ permission.code }}</code>
        </div>

        <StatusBadge
          :label="isPermissionEnabled(permission.code) ? 'Asignado' : 'No asignado'"
          :tone="isPermissionEnabled(permission.code) ? 'success' : 'neutral'"
        />
      </div>

      <p v-if="filteredPermissions.length === 0" class="hint" style="text-align: center; padding: 2rem 0;">
        No se encontraron permisos que coincidan con "{{ searchQuery }}".
      </p>
    </div>
  </div>
</template>
