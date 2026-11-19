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
import AppIcon from '@/components/AppIcon.vue';
import AppModal from '@/components/AppModal.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatDate, formatRange } from '@/lib/dates';
import { activeTone } from '@/lib/status';
import { notify } from '@/lib/toast';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const canManage = computed(() => auth.can(PERMISSIONS.ASSIGNMENTS_MANAGE));

const groups = ref<PaymentGroup[]>([]);
const loading = ref(true);
const error = ref('');

const EVERY: Record<Frequency, string> = { WEEKLY: 'Se paga cada semana', BIWEEKLY: 'Se paga cada quincena', MONTHLY: 'Se paga una vez al mes' };

// Formulario del grupo. El corte se edita como texto porque en el grupo mensual puede quedar vacío.
const formOpen = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const formError = ref('');
const form = reactive({ name: '', frequency: 'BIWEEKLY' as Frequency, cutoff: '15', active: true });

// Calendario (períodos) del grupo seleccionado.
const selected = ref<PaymentGroup | null>(null);
const periods = ref<Period[]>([]);
const periodsLoading = ref(false);
const periodsError = ref('');
const generating = ref(false);
const confirmingRemove = ref(false);
const generateForm = reactive({ from: '', until: '' });

const lastPeriod = computed(() => periods.value[periods.value.length - 1] ?? null);
const nextStart = computed(() => {
  if (!lastPeriod.value) return null;
  const date = new Date(`${lastPeriod.value.endDate}T00:00:00Z`);
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
      notify(`Listo: se creó el grupo «${form.name}». Ahora agrégale los períodos del calendario.`);
    } else {
      await updatePaymentGroup(editingId.value, { ...payload, active: form.active });
      notify(`Listo: se guardaron los cambios de «${form.name}».`);
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
  confirmingRemove.value = false;
  Object.assign(generateForm, { from: '', until: '' });
  await loadPeriods();
  document.getElementById('calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

async function runPeriodAction(action: () => Promise<unknown>, success: string) {
  generating.value = true;
  periodsError.value = '';
  try {
    await action();
    await Promise.all([loadPeriods(), load()]);
    confirmingRemove.value = false;
    notify(success);
  } catch (e) {
    periodsError.value = errorMessage(e);
  } finally {
    generating.value = false;
  }
}

function generate() {
  const group = selected.value!;
  const from = periods.value.length === 0 ? generateForm.from : undefined;
  return runPeriodAction(
    () => generatePeriods(group.id, { from, until: generateForm.until }),
    `Listo: el calendario de «${group.name}» ahora llega hasta el ${formatDate(generateForm.until)}.`,
  );
}

function removeLast() {
  if (!lastPeriod.value) return;
  const label = formatRange(lastPeriod.value.startDate, lastPeriod.value.endDate);
  return runPeriodAction(() => deleteLastPeriod(selected.value!.id), `Se quitó el último período (${label}) del calendario.`);
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Grupos de pago</h1>
    <button v-if="canManage" type="button" class="button button-primary" @click="openCreate">Crear un grupo de pago</button>
  </div>
  <p class="hint">
    Un grupo de pago define <strong>cada cuánto se les paga</strong> a las personas (cada semana, cada quincena o cada mes) y qué día se cierra
    cada período. A cada asignación se le elige uno de estos grupos.
  </p>

  <!-- Crear / editar -->
  <AppModal :open="formOpen" :title="editingId === null ? 'Crear un grupo de pago' : 'Editar el grupo de pago'" @close="formOpen = false">
    <form class="form-grid" @submit.prevent="save">
      <label class="field">
        Nombre del grupo
        <input v-model="form.name" required maxlength="80" placeholder="Ej.: Personal quincenal" />
      </label>
      <label class="field">
        ¿Cada cuánto se paga?
        <select v-model="form.frequency" @change="onFrequencyChange">
          <option v-for="(label, value) in FREQUENCY_LABELS" :key="value" :value="value">
            {{ { WEEKLY: 'Cada semana', BIWEEKLY: 'Cada quincena', MONTHLY: 'Cada mes' }[value] }}
          </option>
        </select>
      </label>
      <label v-if="form.frequency === 'WEEKLY'" class="field">
        ¿Qué día de la semana termina el período?
        <select v-model="form.cutoff">
          <option v-for="(day, index) in WEEKDAYS" :key="index" :value="String(index)">{{ day }}</option>
        </select>
      </label>
      <label v-else-if="form.frequency === 'BIWEEKLY'" class="field">
        ¿Qué día del mes termina la primera quincena?
        <input v-model="form.cutoff" type="number" min="1" max="27" required />
        <span class="hint">Normalmente es el 15. La segunda quincena siempre termina a fin de mes.</span>
      </label>
      <label v-else class="field">
        ¿Qué día del mes termina el período?
        <input v-model="form.cutoff" type="number" min="1" max="28" placeholder="Fin de mes" />
        <span class="hint">Si lo dejas vacío, cada período termina el último día del mes.</span>
      </label>
      <label v-if="editingId !== null" class="checkbox">
        <input v-model="form.active" type="checkbox" />
        El grupo está en uso
      </label>
      <p v-if="editingId !== null" class="hint">Si cambias esto, solo afecta a los períodos que se agreguen después. Los que ya existen no cambian.</p>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="confirm-actions">
        <button type="button" class="button" @click="formOpen = false">Volver</button>
        <button type="submit" class="button button-primary" :disabled="saving">{{ saving ? 'Un momento…' : 'Guardar' }}</button>
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
          <th scope="col">Cada cuánto se paga</th>
          <th scope="col">Cierre</th>
          <th scope="col">Períodos</th>
          <th scope="col">Estado</th>
          <th scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="group in groups" :key="group.id">
          <td>{{ group.name }}</td>
          <td>{{ EVERY[group.frequency] }}</td>
          <td>{{ describeCutoff(group) }}</td>
          <td>{{ group.periodCount }}</td>
          <td><StatusBadge :label="group.active ? 'En uso' : 'Fuera de uso'" :tone="activeTone(group.active)" /></td>
          <td>
            <div class="table-actions">
              <button type="button" class="button" :class="{ 'button-primary': selected?.id === group.id }" @click="showPeriods(group)">Ver calendario</button>
              <button v-if="canManage" type="button" class="button" @click="openEdit(group)">Editar</button>
            </div>
          </td>
        </tr>
        <tr v-if="groups.length === 0">
          <td colspan="6">Todavía no hay grupos de pago. Crea uno para poder asignar personas a proyectos.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Calendario del grupo -->
  <section v-if="selected" id="calendar" class="card section-gap">
    <div class="page-header">
      <div>
        <h2>Calendario de «{{ selected.name }}»</h2>
        <p class="hint">Son los períodos de pago de este grupo. Un período se puede calcular cuando ya terminó.</p>
      </div>
      <button type="button" class="button" @click="selected = null; confirmingRemove = false">Cerrar el calendario</button>
    </div>

    <form v-if="canManage && selected.active" class="calendar-form" @submit.prevent="generate">
      <h3>Agregar períodos al calendario</h3>
      <label v-if="periods.length === 0" class="field">
        ¿Desde qué día empieza el primer período?
        <input v-model="generateForm.from" type="date" required />
      </label>
      <p v-else class="hint">Los períodos nuevos empiezan el {{ formatDate(nextStart) }}, justo después del último.</p>
      <label class="field">
        ¿Hasta qué fecha quieres tener períodos?
        <input v-model="generateForm.until" type="date" required />
        <span class="hint">Por ejemplo, pon el 31 de diciembre para tener todo el año.</span>
      </label>
      <div class="actions">
        <button type="submit" class="button button-primary" :disabled="generating">{{ generating ? 'Un momento…' : 'Agregar períodos' }}</button>
        <button v-if="periods.length > 0" type="button" class="button" :disabled="generating" @click="confirmingRemove = true">
          Quitar el último período
        </button>
      </div>
    </form>

    <ConfirmDialog
      :open="confirmingRemove && Boolean(lastPeriod)"
      title="¿Quitar el último período?"
      confirm-label="Sí, quitarlo"
      danger
      :busy="generating"
      :error="periodsError"
      @close="confirmingRemove = false"
      @confirm="removeLast"
    >
      <p v-if="lastPeriod" class="hint">
        Se quitará el período <strong>{{ formatRange(lastPeriod.startDate, lastPeriod.endDate) }}</strong> del calendario de «{{ selected.name }}».
      </p>
      <p>Solo se puede quitar si todavía no se calculó nada de ese período.</p>
    </ConfirmDialog>

    <p v-if="periodsError && !confirmingRemove" class="error" role="alert">{{ periodsError }}</p>
    <p v-else-if="periodsLoading" class="hint">Cargando…</p>
    <p v-else-if="periods.length === 0" class="empty-inline">Este grupo todavía no tiene períodos. Agrega los primeros arriba.</p>
    <div v-else class="table-wrapper section-gap">
      <table>
        <thead>
          <tr>
            <th scope="col">Empieza</th>
            <th scope="col">Termina</th>
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
