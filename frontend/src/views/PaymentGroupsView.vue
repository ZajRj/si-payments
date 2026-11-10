<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  createPaymentGroup,
  deleteLastPeriod,
  describeCutoff,
  FREQUENCY_LABELS,
  generatePeriods,
  listPaymentGroups,
  listPeriods,
  updatePaymentGroup,
  WEEKDAYS,
  type Frequency,
  type PaymentGroup,
  type Period,
} from '@/api/payment-groups';
import StatusBadge from '@/components/StatusBadge.vue';
import { activeTone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { formatDate, formatRange } from '@/lib/dates';

const auth = useAuthStore();
const canManage = computed(() => auth.can(PERMISSIONS.CATALOGS_MANAGE));

const groups = ref<PaymentGroup[]>([]);
const loading = ref(true);
const error = ref('');

// Formulario del grupo. El corte se edita como texto porque en el grupo mensual puede quedar vacío.
const formOpen = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const formError = ref('');
const form = reactive({ name: '', frequency: 'BIWEEKLY' as Frequency, cutoff: '15', active: true });

// Períodos del grupo seleccionado.
const selected = ref<PaymentGroup | null>(null);
const periods = ref<Period[]>([]);
const periodsLoading = ref(false);
const periodsError = ref('');
const generating = ref(false);
// Confirmación en línea para eliminar el último período (sin diálogos nativos del navegador).
const confirmingRemove = ref(false);
const generateForm = reactive({ from: '', until: '' });

const nextStart = computed(() => {
  const last = periods.value[periods.value.length - 1];
  if (!last) return null;
  const date = new Date(`${last.endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    groups.value = await listPaymentGroups();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, { name: '', frequency: 'BIWEEKLY', cutoff: '15', active: true });
  formError.value = '';
  formOpen.value = true;
}

function openEdit(group: PaymentGroup) {
  editingId.value = group.id;
  Object.assign(form, {
    name: group.name,
    frequency: group.frequency,
    cutoff: group.cutoffDay === null ? '' : String(group.cutoffDay),
    active: group.active,
  });
  formError.value = '';
  formOpen.value = true;
}

function onFrequencyChange() {
  form.cutoff = { WEEKLY: '5', BIWEEKLY: '15', MONTHLY: '' }[form.frequency];
}

async function save() {
  saving.value = true;
  formError.value = '';
  const payload = {
    name: form.name,
    frequency: form.frequency,
    cutoffDay: form.cutoff === '' ? null : Number(form.cutoff),
  };
  try {
    if (editingId.value === null) {
      await createPaymentGroup(payload);
    } else {
      await updatePaymentGroup(editingId.value, { ...payload, active: form.active });
    }
    formOpen.value = false;
    await load();
    if (selected.value) {
      selected.value = groups.value.find((group) => group.id === selected.value?.id) ?? null;
    }
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function showPeriods(group: PaymentGroup) {
  selected.value = group;
  Object.assign(generateForm, { from: '', until: '' });
  await loadPeriods();
}

async function loadPeriods() {
  if (!selected.value) return;
  periodsLoading.value = true;
  periodsError.value = '';
  try {
    periods.value = await listPeriods(selected.value.id);
  } catch (e) {
    periodsError.value = errorMessage(e);
  } finally {
    periodsLoading.value = false;
  }
}

async function runPeriodAction(action: () => Promise<unknown>) {
  generating.value = true;
  periodsError.value = '';
  try {
    await action();
    await Promise.all([loadPeriods(), load()]);
  } catch (e) {
    periodsError.value = errorMessage(e);
  } finally {
    generating.value = false;
  }
}

function generate() {
  const group = selected.value!;
  const from = periods.value.length === 0 ? generateForm.from : undefined;
  return runPeriodAction(() => generatePeriods(group.id, { from, until: generateForm.until }));
}

function removeLast() {
  const last = periods.value[periods.value.length - 1];
  if (!last) return;
  confirmingRemove.value = false;
  return runPeriodAction(() => deleteLastPeriod(selected.value!.id));
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Grupos de pago</h1>
    <button v-if="canManage" type="button" class="button button-primary" @click="openCreate">
      Nuevo grupo
    </button>
  </div>

  <form v-if="formOpen" class="card form-grid" @submit.prevent="save">
    <h2>{{ editingId === null ? 'Nuevo grupo de pago' : 'Editar grupo de pago' }}</h2>
    <label class="field">
      Nombre
      <input v-model="form.name" required maxlength="80" />
    </label>
    <label class="field">
      Periodicidad
      <select v-model="form.frequency" @change="onFrequencyChange">
        <option v-for="(label, value) in FREQUENCY_LABELS" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
    <label v-if="form.frequency === 'WEEKLY'" class="field">
      Día de cierre
      <select v-model="form.cutoff">
        <option v-for="(day, index) in WEEKDAYS" :key="index" :value="String(index)">{{ day }}</option>
      </select>
    </label>
    <label v-else-if="form.frequency === 'BIWEEKLY'" class="field">
      Cierre de la primera quincena (día)
      <input v-model="form.cutoff" type="number" min="1" max="27" required />
      <span class="hint">La segunda quincena cierra a fin de mes.</span>
    </label>
    <label v-else class="field">
      Día de cierre
      <input v-model="form.cutoff" type="number" min="1" max="28" placeholder="Fin de mes" />
      <span class="hint">Déjalo vacío para cerrar el último día de cada mes.</span>
    </label>
    <label v-if="editingId !== null" class="checkbox">
      <input v-model="form.active" type="checkbox" />
      Grupo activo
    </label>
    <p v-if="editingId !== null" class="hint">
      Un cambio de periodicidad o de corte solo afecta a los períodos que se generen después.
    </p>
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
          <th scope="col">Periodicidad</th>
          <th scope="col">Corte</th>
          <th scope="col">Períodos</th>
          <th scope="col">Estado</th>
          <th scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="group in groups" :key="group.id">
          <td>{{ group.name }}</td>
          <td>{{ FREQUENCY_LABELS[group.frequency] }}</td>
          <td>{{ describeCutoff(group) }}</td>
          <td>{{ group.periodCount }}</td>
          <td><StatusBadge :label="group.active ? 'Activo' : 'Inactivo'" :tone="activeTone(group.active)" /></td>
          <td>
            <div class="actions">
              <button type="button" class="button" @click="showPeriods(group)">Períodos</button>
              <button v-if="canManage" type="button" class="button" @click="openEdit(group)">Editar</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <section v-if="selected" class="card section-gap">
    <div class="page-header">
      <h2>Períodos de «{{ selected.name }}»</h2>
      <button type="button" class="button" @click="selected = null">Cerrar</button>
    </div>

    <form v-if="canManage && selected.active" class="form-grid" @submit.prevent="generate">
      <label v-if="periods.length === 0" class="field">
        Inicio del primer período
        <input v-model="generateForm.from" type="date" required />
      </label>
      <p v-else class="hint">La generación continúa desde el {{ formatDate(nextStart) }}.</p>
      <label class="field">
        Generar hasta
        <input v-model="generateForm.until" type="date" required />
      </label>
      <div class="actions">
        <button type="submit" class="button button-primary" :disabled="generating">Generar períodos</button>
        <template v-if="periods.length > 0 && !confirmingRemove">
          <button type="button" class="button" :disabled="generating" @click="confirmingRemove = true">Eliminar último período</button>
        </template>
        <template v-else-if="periods.length > 0">
          <span class="hint">
            ¿Eliminar el período {{ formatRange(periods[periods.length - 1]!.startDate, periods[periods.length - 1]!.endDate) }}?
          </span>
          <button type="button" class="button button-primary" :disabled="generating" @click="removeLast">Sí, eliminar</button>
          <button type="button" class="button" @click="confirmingRemove = false">No</button>
        </template>
      </div>
    </form>

    <p v-if="periodsError" class="error" role="alert">{{ periodsError }}</p>
    <p v-else-if="periodsLoading">Cargando…</p>
    <p v-else-if="periods.length === 0" class="hint">Este grupo todavía no tiene períodos.</p>
    <div v-else class="table-wrapper section-gap">
      <table>
        <thead>
          <tr>
            <th scope="col">Inicio</th>
            <th scope="col">Fin</th>
            <th scope="col">Días</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="period in periods" :key="period.id">
            <td>{{ formatDate(period.startDate) }}</td>
            <td>{{ formatDate(period.endDate) }}</td>
            <td>{{ period.days }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
