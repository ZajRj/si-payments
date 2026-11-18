<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { listAreas, type Area } from '@/api/areas';
import { errorMessage } from '@/api/http';
import {
  createProject,
  listProjects,
  SCOPE_LABELS,
  updateProject,
  type Project,
  type Scope,
} from '@/api/projects';
import AppModal from '@/components/AppModal.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { activeTone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { formatDate, formatRange } from '@/lib/dates';

const auth = useAuthStore();
const canManage = computed(() => auth.can(PERMISSIONS.PROJECTS_MANAGE));

// Fecha local en formato AAAA-MM-DD, para comparar con las fechas de la API.
const today = new Date().toLocaleDateString('sv-SE');

const projects = ref<Project[]>([]);
const areas = ref<Area[]>([]);
const loading = ref(true);
const error = ref('');

// Filtros de la lista. Se aplican en el navegador: la lista de proyectos es corta.
const filters = reactive({
  search: '',
  areaId: 0,
  scope: '' as '' | Scope,
  status: 'all' as 'all' | 'active' | 'inactive',
  from: '',
  to: '',
});

const hasFilters = computed(
  () => Boolean(filters.search.trim() || filters.areaId || filters.scope || filters.from || filters.to) || filters.status !== 'all',
);

function clearFilters() {
  Object.assign(filters, { search: '', areaId: 0, scope: '', status: 'all', from: '', to: '' });
}

// Ignora mayúsculas y acentos: "optica" encuentra "Óptica".
function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const filteredProjects = computed(() => {
  const search = normalize(filters.search.trim());
  return projects.value.filter((project) => {
    if (search && !normalize(`${project.code} ${project.name}`).includes(search)) return false;
    if (filters.areaId && project.area.id !== filters.areaId) return false;
    if (filters.scope && project.scope !== filters.scope) return false;
    if (filters.status === 'active' && !project.active) return false;
    if (filters.status === 'inactive' && project.active) return false;
    // Vigencia: el proyecto tiene al menos un día dentro del rango indicado.
    if (filters.from && project.endDate < filters.from) return false;
    if (filters.to && project.startDate > filters.to) return false;
    return true;
  });
});

const rangeError = computed(() =>
  filters.from && filters.to && filters.from > filters.to ? 'La fecha "desde" no puede ser posterior a "hasta"' : '',
);

// Formulario de creación y edición.
const formOpen = ref(false);
const editingId = ref<number | null>(null);
const editingCode = ref('');
const saving = ref(false);
const formError = ref('');
const form = reactive({
  name: '',
  areaId: 0,
  scope: 'INTERNAL' as Scope,
  startDate: '',
  endDate: '',
  active: true,
});

// Al editar, el área actual se muestra aunque esté inactiva.
const areaOptions = computed(() => areas.value.filter((area) => area.active || area.id === form.areaId));
const selectedArea = computed(() => areas.value.find((area) => area.id === form.areaId));

// Prefijo que usará el código (lo genera el servidor): tres letras del área sin acentos.
function areaPrefix(name: string) {
  return name.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().padEnd(3, 'X').slice(0, 3);
}

// Un proyecto nuevo no puede tener la vigencia terminada: el fin es hoy o después.
const minEndDate = computed(() => {
  if (editingId.value !== null) return form.startDate || undefined;
  return form.startDate && form.startDate > today ? form.startDate : today;
});
const isRetroactive = computed(() => editingId.value === null && Boolean(form.startDate) && form.startDate < today);

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
  editingCode.value = '';
  Object.assign(form, {
    name: '',
    areaId: 0,
    scope: 'INTERNAL',
    startDate: today,
    endDate: '',
    active: true,
  });
  formError.value = '';
  formOpen.value = true;
}

function openEdit(project: Project) {
  editingId.value = project.id;
  editingCode.value = project.code;
  Object.assign(form, {
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
  formError.value = '';
  if (!form.areaId) {
    formError.value = 'Selecciona el área';
    return;
  }
  saving.value = true;
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

  <AppModal
    :open="formOpen"
    :title="editingId === null ? 'Nuevo proyecto' : `Editar proyecto ${editingCode}`"
    @close="formOpen = false"
  >
    <form class="form-grid" @submit.prevent="save">
      <label class="field field-wide">
        Nombre
        <input v-model="form.name" required maxlength="120" />
      </label>
      <label class="field">
        Área
        <select v-model.number="form.areaId" required>
          <option :value="0" disabled>Selecciona un área</option>
          <option v-for="area in areaOptions" :key="area.id" :value="area.id">{{ area.name }}</option>
        </select>
      </label>
      <label class="field">
        Ámbito
        <select v-model="form.scope">
          <option v-for="(label, value) in SCOPE_LABELS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <p v-if="selectedArea" class="hint">
        {{ selectedArea.description }}
        <template v-if="editingId === null">
          El código se asigna al guardar: {{ areaPrefix(selectedArea.name) }}- y cuatro caracteres al azar.
        </template>
      </p>
      <label class="field">
        Inicio de la vigencia
        <input v-model="form.startDate" type="date" required />
      </label>
      <label class="field">
        Fin de la vigencia
        <input v-model="form.endDate" type="date" required :min="minEndDate" />
        <span v-if="editingId === null" class="hint">Hoy o después: no se registran proyectos ya terminados.</span>
      </label>
      <p v-if="isRetroactive" class="notice notice-warning" role="status">
        El inicio es anterior a hoy: el proyecto se registra de forma retroactiva y sus períodos ya cerrados se podrán causar.
      </p>
      <label v-if="editingId !== null" class="checkbox">
        <input v-model="form.active" type="checkbox" />
        Proyecto activo
      </label>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="actions">
        <button type="button" class="button" @click="formOpen = false">Cancelar</button>
        <button type="submit" class="button button-primary" :disabled="saving">Guardar</button>
      </div>
    </form>
  </AppModal>

  <form class="card form-grid section-gap" role="search" @submit.prevent>
    <label class="field field-wide">
      Buscar
      <input v-model="filters.search" type="search" placeholder="Código o nombre del proyecto" />
    </label>
    <label class="field">
      Área
      <select v-model.number="filters.areaId">
        <option :value="0">Todas</option>
        <option v-for="area in areas" :key="area.id" :value="area.id">{{ area.name }}</option>
      </select>
    </label>
    <label class="field">
      Ámbito
      <select v-model="filters.scope">
        <option value="">Todos</option>
        <option v-for="(label, value) in SCOPE_LABELS" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
    <label class="field">
      Estado
      <select v-model="filters.status">
        <option value="all">Todos</option>
        <option value="active">Activos</option>
        <option value="inactive">Inactivos</option>
      </select>
    </label>
    <label class="field">
      Vigentes desde
      <input v-model="filters.from" type="date" />
    </label>
    <label class="field">
      Vigentes hasta
      <input v-model="filters.to" type="date" />
    </label>
    <p class="hint">Con fechas, se muestran los proyectos que tienen al menos un día de vigencia en ese rango.</p>
    <p v-if="rangeError" class="error" role="alert">{{ rangeError }}</p>
    <div class="actions">
      <span class="hint">{{ filteredProjects.length }} de {{ projects.length }} proyectos</span>
      <button v-if="hasFilters" type="button" class="button" @click="clearFilters">Limpiar filtros</button>
      <button type="button" class="button" @click="filters.from = today; filters.to = today">Vigentes hoy ({{ formatDate(today) }})</button>
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
        <tr v-for="project in filteredProjects" :key="project.id">
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
        <tr v-if="filteredProjects.length === 0">
          <td :colspan="canManage ? 8 : 7">
            {{ projects.length === 0 ? 'Todavía no hay proyectos.' : 'No hay proyectos con esos filtros.' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
