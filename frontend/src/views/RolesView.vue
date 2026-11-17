<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { listRolesAndPermissions, updateRolePermissions, type PermissionItem, type Role } from '@/api/roles';

const roles = ref<Role[]>([]);
const allPermissions = ref<PermissionItem[]>([]);
const selectedRoleId = ref<number | null>(null);
const searchQuery = ref('');
const loading = ref(true);
const error = ref('');

const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const saveErrorMessage = ref('');
const savingPermissionCode = ref<string | null>(null);
let saveFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;

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

async function onTogglePermission(code: string, event: Event) {
  const target = event.target as HTMLInputElement;
  const isChecked = target.checked;
  const role = selectedRole.value;
  if (!role) return;

  const previousCodes = new Set(activePermissionCodes.value);
  const nextCodes = new Set(previousCodes);

  if (isChecked) {
    nextCodes.add(code);
  } else {
    nextCodes.delete(code);
  }

  // Actualización optimista local
  const permissionItem = allPermissions.value.find((p) => p.code === code) ?? {
    code,
    description: code,
  };

  const oldPermissionsList = [...role.permissions];
  if (isChecked) {
    role.permissions = [...role.permissions, permissionItem];
  } else {
    role.permissions = role.permissions.filter((p) => p.code !== code);
  }

  savingPermissionCode.value = code;
  saveStatus.value = 'saving';
  saveErrorMessage.value = '';

  if (saveFeedbackTimeout) {
    clearTimeout(saveFeedbackTimeout);
  }

  try {
    const updated = await updateRolePermissions(role.id, Array.from(nextCodes));
    role.permissions = updated.permissions;
    saveStatus.value = 'saved';
    saveFeedbackTimeout = setTimeout(() => {
      if (saveStatus.value === 'saved') {
        saveStatus.value = 'idle';
      }
    }, 3000);
  } catch (e) {
    // Revertir cambio local
    role.permissions = oldPermissionsList;
    target.checked = !isChecked;
    saveStatus.value = 'error';
    saveErrorMessage.value = errorMessage(e);
  } finally {
    savingPermissionCode.value = null;
  }
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
  <p class="hint">Selecciona un rol para visualizar y configurar sus permisos asignados en el sistema.</p>

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
          {{ activeCount }} de {{ allPermissions.length }} activos
        </span>
      </div>

      <div class="permissions-summary-actions">
        <span v-if="saveStatus === 'saving'" class="permissions-save-feedback saving">
          Guardando cambios…
        </span>
        <span v-else-if="saveStatus === 'saved'" class="permissions-save-feedback success">
          ✓ Cambios guardados
        </span>
        <span v-else-if="saveStatus === 'error'" class="error" role="alert">
          {{ saveErrorMessage || 'Error al guardar cambios' }}
        </span>

        <input
          v-model="searchQuery"
          type="search"
          placeholder="Buscar permiso…"
          class="permissions-search-input"
          aria-label="Buscar permiso"
        />
      </div>
    </div>

    <!-- Lista de permisos con switch -->
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

        <div class="permission-switch-col">
          <span
            class="permission-status-text"
            :class="isPermissionEnabled(permission.code) ? 'is-active' : 'is-inactive'"
          >
            {{ isPermissionEnabled(permission.code) ? 'Activo' : 'Inactivo' }}
          </span>

          <label
            class="switch"
            :class="{ 'is-disabled': savingPermissionCode === permission.code }"
            :title="`Cambiar permiso ${permission.code}`"
          >
            <input
              type="checkbox"
              role="switch"
              :aria-label="`Permiso ${permission.description}`"
              :checked="isPermissionEnabled(permission.code)"
              :disabled="savingPermissionCode === permission.code"
              @change="onTogglePermission(permission.code, $event)"
            />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>

      <p v-if="filteredPermissions.length === 0" class="hint empty-hint">
        No se encontraron permisos que coincidan con "{{ searchQuery }}".
      </p>
    </div>
  </div>
</template>
