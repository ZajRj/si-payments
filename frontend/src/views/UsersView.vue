<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { listRoles, type Role } from '@/api/roles';
import { createUser, listUsers, updateUser, type User } from '@/api/users';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const canManage = computed(() => auth.can(PERMISSIONS.USERS_MANAGE));

const users = ref<User[]>([]);
const roles = ref<Role[]>([]);
const loading = ref(true);
const error = ref('');

const formOpen = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const formError = ref('');
const form = reactive({ name: '', email: '', password: '', roleId: 0, active: true });

const isSelf = computed(() => editingId.value === auth.user?.id);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [loadedUsers, loadedRoles] = await Promise.all([listUsers(), listRoles()]);
    users.value = loadedUsers;
    roles.value = loadedRoles;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { name: '', email: '', password: '', roleId: roles.value[0]?.id ?? 0, active: true });
  formError.value = '';
  formOpen.value = true;
}

function openEdit(user: User) {
  editingId.value = user.id;
  Object.assign(form, {
    name: user.name,
    email: user.email,
    password: '',
    roleId: user.role.id,
    active: user.active,
  });
  formError.value = '';
  formOpen.value = true;
}

async function save() {
  saving.value = true;
  formError.value = '';
  try {
    if (editingId.value === null) {
      const { name, email, password, roleId } = form;
      await createUser({ name, email, password, roleId });
    } else {
      const { password, ...fields } = form;
      await updateUser(editingId.value, { ...fields, password: password || undefined });
    }
    formOpen.value = false;
    await load();
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Usuarios</h1>
    <button v-if="canManage" type="button" class="button button-primary" @click="openCreate">
      Nuevo usuario
    </button>
  </div>

  <form v-if="formOpen" class="card form-grid" @submit.prevent="save">
    <h2>{{ editingId === null ? 'Nuevo usuario' : 'Editar usuario' }}</h2>
    <label class="field">
      Nombre
      <input v-model="form.name" required maxlength="120" />
    </label>
    <label class="field">
      Email
      <input v-model="form.email" type="email" required />
    </label>
    <label class="field">
      {{ editingId === null ? 'Contraseña' : 'Nueva contraseña (opcional)' }}
      <input
        v-model="form.password"
        type="password"
        autocomplete="new-password"
        minlength="8"
        maxlength="72"
        :required="editingId === null"
      />
    </label>
    <label class="field">
      Rol
      <select v-model.number="form.roleId" :disabled="isSelf">
        <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
      </select>
    </label>
    <label v-if="editingId !== null" class="checkbox">
      <input v-model="form.active" type="checkbox" :disabled="isSelf" />
      Usuario activo
    </label>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
    <div class="actions">
      <button type="submit" class="button button-primary" :disabled="saving">Guardar</button>
      <button type="button" class="button" @click="formOpen = false">Cancelar</button>
    </div>
  </form>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Nombre</th>
          <th scope="col">Email</th>
          <th scope="col">Rol</th>
          <th scope="col">Estado</th>
          <th v-if="canManage" scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in users" :key="user.id">
          <td>{{ user.name }}</td>
          <td>{{ user.email }}</td>
          <td>{{ user.role.name }}</td>
          <td>{{ user.active ? 'Activo' : 'Inactivo' }}</td>
          <td v-if="canManage">
            <button type="button" class="button" @click="openEdit(user)">Editar</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
