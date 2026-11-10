<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { listAreas, type Area } from '@/api/areas';
import { errorMessage } from '@/api/http';
import { createProject, listProjects, SCOPE_LABELS, updateProject, type Project, type Scope } from '@/api/projects';
import StatusBadge from '@/components/StatusBadge.vue';
import { activeTone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { formatRange } from '@/lib/dates';

const auth = useAuthStore();
const canManage = computed(() => auth.can(PERMISSIONS.PROJECTS_MANAGE));

const projects = ref<Project[]>([]);
const areas = ref<Area[]>([]);
const loading = ref(true);
const error = ref('');

const formOpen = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const formError = ref('');
const form = reactive({
  code: '',
  name: '',
  areaId: 0,
  scope: 'INTERNAL' as Scope,
  startDate: '',
  endDate: '',
  active: true,
});

// Al editar, el área actual se muestra aunque esté inactiva.
const areaOptions = computed(() => areas.value.filter((area) => area.active || area.id === form.areaId));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [loadedProjects, loadedAreas] = await Promise.all([listProjects(), listAreas()]);
    projects.value = loadedProjects;
    areas.value = loadedAreas;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, {
    code: '',
    name: '',
    areaId: areas.value.find((area) => area.active)?.id ?? 0,
    scope: 'INTERNAL',
    startDate: '',
    endDate: '',
    active: true,
  });
  formError.value = '';
  formOpen.value = true;
}

function openEdit(project: Project) {
  editingId.value = project.id;
  Object.assign(form, {
    code: project.code,
    name: project.name,
    areaId: project.area.id,
    scope: project.scope,
    startDate: project.startDate,
    endDate: project.endDate,
    active: project.active,
  });
  formError.value = '';
  formOpen.value = true;
}

async function save() {
  saving.value = true;
  formError.value = '';
  try {
    if (editingId.value === null) {
      const { active: _, ...payload } = form;
      await createProject(payload);
    } else {
      await updateProject(editingId.value, { ...form });
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
    <h1>Proyectos</h1>
    <button v-if="canManage" type="button" class="button button-primary" @click="openCreate">Nuevo proyecto</button>
  </div>

  <form v-if="formOpen" class="card form-grid" @submit.prevent="save">
    <h2>{{ editingId === null ? 'Nuevo proyecto' : 'Editar proyecto' }}</h2>
    <label class="field">
      Código
      <input v-model="form.code" required maxlength="20" placeholder="FIS-001" />
    </label>
    <label class="field">
      Nombre
      <input v-model="form.name" required maxlength="120" />
    </label>
    <label class="field">
      Área
      <select v-model.number="form.areaId" required>
        <option v-for="area in areaOptions" :key="area.id" :value="area.id">{{ area.name }}</option>
      </select>
    </label>
    <label class="field">
      Ámbito
      <select v-model="form.scope">
        <option v-for="(label, value) in SCOPE_LABELS" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
    <label class="field">
      Inicio de la vigencia
      <input v-model="form.startDate" type="date" required />
    </label>
    <label class="field">
      Fin de la vigencia
      <input v-model="form.endDate" type="date" required :min="form.startDate" />
    </label>
    <label v-if="editingId !== null" class="checkbox">
      <input v-model="form.active" type="checkbox" />
      Proyecto activo
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
          <th scope="col">Código</th>
          <th scope="col">Nombre</th>
          <th scope="col">Área</th>
          <th scope="col">Ámbito</th>
          <th scope="col">Vigencia</th>
          <th scope="col">Asignaciones</th>
          <th scope="col">Estado</th>
          <th v-if="canManage" scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="project in projects" :key="project.id">
          <td class="nowrap">{{ project.code }}</td>
          <td>{{ project.name }}</td>
          <td>{{ project.area.name }}</td>
          <td>{{ SCOPE_LABELS[project.scope] }}</td>
          <td class="nowrap">{{ formatRange(project.startDate, project.endDate) }}</td>
          <td>
            <RouterLink :to="{ name: 'assignments', query: { projectId: project.id } }">
              {{ project.assignmentCount }}
            </RouterLink>
          </td>
          <td><StatusBadge :label="project.active ? 'Activo' : 'Inactivo'" :tone="activeTone(project.active)" /></td>
          <td v-if="canManage">
            <button type="button" class="button" @click="openEdit(project)">Editar</button>
          </td>
        </tr>
        <tr v-if="projects.length === 0">
          <td :colspan="canManage ? 8 : 7">Todavía no hay proyectos.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
