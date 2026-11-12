<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { listRoles, type Role } from '@/api/roles';
import { createUser, deleteUser, listUsers, updateUser, type User } from '@/api/users';
import AppModal from '@/components/AppModal.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatDateTime } from '@/lib/dates';
import { activeTone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const canManage = computed(() => auth.can(PERMISSIONS.USERS_MANAGE));

const users = ref<User[]>([]);
const roles = ref<Role[]>([]);
const loading = ref(true);
const error = ref('');
const showDeleted = ref(false);

const formOpen = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const formError = ref('');
const form = reactive({ name: '', email: '', password: '', roleId: 0, active: true });

const deleteModalOpen = ref(false);
const deletingUser = ref<User | null>(null);
const deleting = ref(false);
const deleteError = ref('');

const isSelf = computed(() => editingId.value === auth.user?.id);

const deletedCount = computed(() => users.value.filter((u) => Boolean(u.deleteDate)).length);
const visibleUsers = computed(() => {
  if (showDeleted.value) return users.value;
  return users.value.filter((u) => !u.deleteDate);
});

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

function openDelete(user: User) {
  deletingUser.value = user;
  deleteError.value = '';
  deleteModalOpen.value = true;
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

async function confirmDelete() {
  if (!deletingUser.value) return;
  deleting.value = true;
  deleteError.value = '';
  try {
    await deleteUser(deletingUser.value.id);
    deleteModalOpen.value = false;
    deletingUser.value = null;
    await load();
  } catch (e) {
    deleteError.value = errorMessage(e);
  } finally {
    deleting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Usuarios</h1>
    <div class="actions">
      <label v-if="deletedCount > 0" class="checkbox">
        <input v-model="showDeleted" type="checkbox" />
        Mostrar eliminados ({{ deletedCount }})
      </label>
      <button v-if="canManage" type="button" class="button button-primary" @click="openCreate">
        Nuevo usuario
      </button>
    </div>
  </div>

  <AppModal
    :open="formOpen"
    :title="editingId === null ? 'Nuevo usuario' : 'Editar usuario'"
    @close="formOpen = false"
  >
    <form class="form-grid" @submit.prevent="save">
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
        <button type="button" class="button" @click="formOpen = false">Cancelar</button>
        <button type="submit" class="button button-primary" :disabled="saving">Guardar</button>
      </div>
    </form>
  </AppModal>

  <AppModal
    :open="deleteModalOpen"
    title="Eliminar usuario"
    @close="deleteModalOpen = false"
  >
    <form class="form-grid" @submit.prevent="confirmDelete">
      <p class="hint">
        ¿Estás seguro de que deseas eliminar al usuario
        <strong>{{ deletingUser?.name }}</strong> ({{ deletingUser?.email }})?
      </p>
      <p class="hint">
        Esta acción realizará un <strong>borrado lógico (soft delete)</strong>: se registrará la fecha de eliminación y tu usuario como operador responsable. El usuario ya no podrá iniciar sesión.
      </p>
      <p v-if="deleteError" class="error" role="alert">{{ deleteError }}</p>
      <div class="actions">
        <button type="button" class="button" @click="deleteModalOpen = false">Cancelar</button>
        <button type="submit" class="button button-danger" :disabled="deleting">
          {{ deleting ? 'Eliminando…' : 'Sí, eliminar' }}
        </button>
      </div>
    </form>
  </AppModal>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <p v-else-if="visibleUsers.length === 0" class="hint">No hay usuarios para mostrar.</p>
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
        <tr v-for="user in visibleUsers" :key="user.id">
          <td>{{ user.name }}</td>
          <td>{{ user.email }}</td>
          <td>{{ user.role.name }}</td>
          <td>
            <template v-if="user.deleteDate">
              <StatusBadge label="Eliminado" tone="danger" />
              <div v-if="user.deletedBy" class="hint text-xs">
                Por {{ user.deletedBy.name }}
              </div>
              <div v-if="user.deleteDate" class="hint text-xs">
                {{ formatDateTime(user.deleteDate) }}
              </div>
            </template>
            <template v-else>
              <StatusBadge :label="user.active ? 'Activo' : 'Inactivo'" :tone="activeTone(user.active)" />
            </template>
          </td>
          <td v-if="canManage">
            <div v-if="user.deleteDate" class="hint text-xs">
              Eliminado
            </div>
            <div v-else class="actions">
              <button type="button" class="button" @click="openEdit(user)">Editar</button>
              <button
                v-if="user.id !== auth.user?.id"
                type="button"
                class="button button-danger"
                @click="openDelete(user)"
              >
                Eliminar
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
