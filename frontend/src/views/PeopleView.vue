<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorMessage } from '@/api/http';
import { createPerson, listPeople, updatePerson, type Person } from '@/api/people';
import AppModal from '@/components/AppModal.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import PersonDetailView from '@/views/PersonDetailView.vue';
import { activeTone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();

// La persona abierta vive en la URL (?id=), igual que en proyectos y solicitudes.
const detailId = computed(() => {
  const id = Number(route.query.id);
  return Number.isInteger(id) && id > 0 ? id : null;
});
const canManage = computed(() => auth.can(PERMISSIONS.PEOPLE_MANAGE));

const people = ref<Person[]>([]);
const search = ref('');

// La lista se filtra mientras se escribe, con una pequeña espera para no consultar en cada tecla.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 300);
});
onBeforeUnmount(() => clearTimeout(searchTimer));
const loading = ref(true);
const error = ref('');

const formOpen = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const formError = ref('');
const form = reactive({ idNumber: '', name: '', phone: '', email: '', active: true });

// Al escribir rápido pueden quedar varias consultas en vuelo: solo la última actualiza la pantalla.
let loadSeq = 0;

async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const result = await listPeople({ search: search.value.trim() || undefined });
    if (seq !== loadSeq) return;
    people.value = result;
  } catch (e) {
    if (seq === loadSeq) error.value = errorMessage(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { idNumber: '', name: '', phone: '', email: '', active: true });
  formError.value = '';
  formOpen.value = true;
}

function openEdit(person: Person) {
  editingId.value = person.id;
  Object.assign(form, {
    idNumber: person.idNumber,
    name: person.name,
    phone: person.phone ?? '',
    email: person.email ?? '',
    active: person.active,
  });
  formError.value = '';
  formOpen.value = true;
}

async function save() {
  saving.value = true;
  formError.value = '';
  const payload = {
    idNumber: form.idNumber,
    name: form.name,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
  };
  try {
    if (editingId.value === null) {
      await createPerson(payload);
    } else {
      await updatePerson(editingId.value, { ...payload, active: form.active });
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
  <PersonDetailView v-if="detailId" :id="detailId" />
  <template v-else>
  <div class="page-header">
    <h1>Personas</h1>
    <button v-if="canManage" type="button" class="button button-primary" @click="openCreate">Nueva persona</button>
  </div>
  <p class="hint">Personal que cobra asignaciones. No tiene usuario en el sistema.</p>

  <AppModal
    :open="formOpen"
    :title="editingId === null ? 'Nueva persona' : 'Editar persona'"
    @close="formOpen = false"
  >
    <form class="form-grid" @submit.prevent="save">
      <label class="field">
        Cédula
        <input v-model="form.idNumber" required placeholder="V-12345678" maxlength="12" />
      </label>
      <label class="field">
        Nombre completo
        <input v-model="form.name" required maxlength="120" />
      </label>
      <label class="field">
        Teléfono (opcional)
        <input v-model="form.phone" maxlength="30" />
      </label>
      <label class="field">
        Email (opcional)
        <input v-model="form.email" type="email" />
      </label>
      <label v-if="editingId !== null" class="checkbox">
        <input v-model="form.active" type="checkbox" />
        Persona activa
      </label>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="actions">
        <button type="button" class="button" @click="formOpen = false">Cancelar</button>
        <button type="submit" class="button button-primary" :disabled="saving">Guardar</button>
      </div>
    </form>
  </AppModal>

  <form class="actions section-gap" role="search" @submit.prevent="load()">
    <label class="field">
      <span class="sr-only">Buscar</span>
      <input v-model="search" type="search" placeholder="Buscar por nombre o cédula" />
    </label>
  </form>

  <p v-if="error" class="error section-gap" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="section-gap">Cargando…</p>
  <div v-else class="table-wrapper section-gap">
    <table>
      <thead>
        <tr>
          <th scope="col">Cédula</th>
          <th scope="col">Nombre</th>
          <th scope="col">Teléfono</th>
          <th scope="col">Email</th>
          <th scope="col">Estado</th>
          <th v-if="canManage" scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="person in people" :key="person.id">
          <td class="nowrap">{{ person.idNumber }}</td>
          <td><RouterLink :to="{ name: 'people', query: { id: person.id } }">{{ person.name }}</RouterLink></td>
          <td>{{ person.phone ?? '—' }}</td>
          <td>{{ person.email ?? '—' }}</td>
          <td><StatusBadge :label="person.active ? 'Activa' : 'Inactiva'" :tone="activeTone(person.active)" /></td>
          <td v-if="canManage">
            <button type="button" class="button" @click="openEdit(person)">Editar</button>
          </td>
        </tr>
        <tr v-if="people.length === 0">
          <td :colspan="canManage ? 6 : 5">No hay personas que coincidan.</td>
        </tr>
      </tbody>
    </table>
  </div>
  </template>
</template>
