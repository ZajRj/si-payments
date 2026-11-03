<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { listRoles, type Role } from '@/api/roles';

const roles = ref<Role[]>([]);
const loading = ref(true);
const error = ref('');

const permissions = computed(() => {
  const unique = new Map(roles.value.flatMap((role) => role.permissions).map((p) => [p.code, p]));
  return [...unique.values()].sort((a, b) => a.code.localeCompare(b.code));
});

function hasPermission(role: Role, code: string) {
  return role.permissions.some((permission) => permission.code === code);
}

onMounted(async () => {
  try {
    roles.value = await listRoles();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <h1>Roles y permisos</h1>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Permiso</th>
          <th v-for="role in roles" :key="role.id" scope="col" :title="role.description">{{ role.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="permission in permissions" :key="permission.code">
          <th scope="row">
            {{ permission.description }}
            <code class="permission-code">{{ permission.code }}</code>
          </th>
          <td v-for="role in roles" :key="role.id" class="matrix-cell">
            {{ hasPermission(role, permission.code) ? 'Sí' : '—' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
