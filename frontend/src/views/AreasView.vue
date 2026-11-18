<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { createArea, listAreas, updateArea, type Area } from '@/api/areas';
import { errorMessage } from '@/api/http';
import AppModal from '@/components/AppModal.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { activeTone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const canManage = computed(() => auth.can(PERMISSIONS.CATALOGS_MANAGE));

const areas = ref<Area[]>([]);
const loading = ref(true);
const error = ref('');

const formOpen = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const formError = ref('');
const form = reactive({ name: '', description: '', active: true });

async function load() {
  loading.value = true;
  error.value = '';
  try {
    areas.value = await listAreas();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { name: '', description: '', active: true });
  formError.value = '';
  formOpen.value = true;
}

function openEdit(area: Area) {
  editingId.value = area.id;
  Object.assign(form, { name: area.name, description: area.description, active: area.active });
  formError.value = '';
  formOpen.value = true;
}

async function save() {
  saving.value = true;
  formError.value = '';
  try {
    if (editingId.value === null) {
      await createArea({ name: form.name, description: form.description });
    } else {
      await updateArea(editingId.value, { ...form });
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
    <h1>Áreas</h1>
    <button v-if="canManage" type="button" class="button button-primary" @click="openCreate">Nueva área</button>
  </div>

  <AppModal
    :open="formOpen"
    :title="editingId === null ? 'Nueva área' : 'Editar área'"
    @close="formOpen = false"
  >
    <form class="form-grid" @submit.prevent="save">
      <label class="field field-wide">
        Nombre
        <input v-model="form.name" required maxlength="80" />
      </label>
      <label class="field field-wide">
        Descripción
        <textarea v-model="form.description" required minlength="10" maxlength="500" rows="3" />
        <span class="hint">Qué proyectos van en esta área. Sirve para clasificar un proyecto nuevo sin dudas.</span>
      </label>
      <label v-if="editingId !== null" class="checkbox">
        <input v-model="form.active" type="checkbox" />
        Área activa
      </label>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="actions">
        <button type="button" class="button" @click="formOpen = false">Cancelar</button>
        <button type="submit" class="button button-primary" :disabled="saving">Guardar</button>
      </div>
    </form>
  </AppModal>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Nombre</th>
          <th scope="col">Descripción</th>
          <th scope="col">Estado</th>
          <th v-if="canManage" scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="area in areas" :key="area.id">
          <td class="nowrap">{{ area.name }}</td>
          <td>{{ area.description || '—' }}</td>
          <td><StatusBadge :label="area.active ? 'Activa' : 'Inactiva'" :tone="activeTone(area.active)" /></td>
          <td v-if="canManage">
            <button type="button" class="button" @click="openEdit(area)">Editar</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
