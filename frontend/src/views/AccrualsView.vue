<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  ACCRUAL_STATUS_LABELS,
  annulAccrual,
  annulBatch,
  generateAccruals,
  listAccruals,
  listBatches,
  type Accrual,
  type AccrualBatch,
  type AccrualStatusFilter,
} from '@/api/accruals';
import { errorMessage } from '@/api/http';
import { listPaymentGroups, listPeriods, type PaymentGroup, type Period } from '@/api/payment-groups';
import { listPeople, type Person } from '@/api/people';
import { listProjects, type Project } from '@/api/projects';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatUsd } from '@/lib/money';
import { ACCRUAL_STATUS_TONES } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, formatRange } from '@/lib/dates';

const auth = useAuthStore();
const canGenerate = computed(() => auth.can(PERMISSIONS.ACCRUALS_GENERATE));

const accruals = ref<Accrual[]>([]);
const batches = ref<AccrualBatch[]>([]);
const projects = ref<Project[]>([]);
const people = ref<Person[]>([]);
const groups = ref<PaymentGroup[]>([]);
const loading = ref(true);
const error = ref('');

const filters = reactive({ projectId: 0, personId: 0, paymentGroupId: 0, periodId: 0, status: '' as '' | AccrualStatusFilter });
const filterPeriods = ref<Period[]>([]);

// Fecha local en formato AAAA-MM-DD, para comparar con las fechas de la API.
const today = new Date().toLocaleDateString('sv-SE');

async function periodsOf(groupId: number) {
  return groupId ? listPeriods(groupId) : [];
}

watch(
  () => filters.paymentGroupId,
  async (groupId) => {
    filters.periodId = 0;
    try {
      filterPeriods.value = await periodsOf(groupId);
    } catch (e) {
      error.value = errorMessage(e);
    }
  },
);

async function loadData() {
  loading.value = true;
  error.value = '';
  try {
    const projectId = filters.projectId || undefined;
    const periodId = filters.periodId || undefined;
    [accruals.value, batches.value] = await Promise.all([
      listAccruals({
        projectId,
        periodId,
        personId: filters.personId || undefined,
        paymentGroupId: filters.paymentGroupId || undefined,
        status: filters.status || undefined,
      }),
      listBatches({ projectId, periodId }),
    ]);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

watch(filters, () => loadData());

async function load() {
  try {
    [projects.value, people.value, groups.value] = await Promise.all([listProjects(), listPeople(), listPaymentGroups()]);
  } catch (e) {
    error.value = errorMessage(e);
  }
  await loadData();
}

const totals = computed(() =>
  accruals.value.reduce(
    (sum, accrual) => ({
      amountCents: sum.amountCents + (accrual.status === 'ANNULLED' ? 0 : accrual.amountCents),
      paidCents: sum.paidCents + accrual.paidCents,
      pendingCents: sum.pendingCents + accrual.pendingCents,
    }),
    { amountCents: 0, paidCents: 0, pendingCents: 0 },
  ),
);

// Generación por lote.
const formOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const formResult = ref('');
const form = reactive({ paymentGroupId: 0, periodId: 0, projectId: 0 });
const formPeriods = ref<Period[]>([]);

// Solo se causan períodos que ya cerraron.
const closedPeriods = computed(() => formPeriods.value.filter((period) => period.endDate <= today).reverse());

watch(
  () => form.paymentGroupId,
  async (groupId) => {
    form.periodId = 0;
    try {
      formPeriods.value = await periodsOf(groupId);
    } catch (e) {
      formError.value = errorMessage(e);
    }
  },
);

function openGenerate() {
  Object.assign(form, { paymentGroupId: 0, periodId: 0, projectId: 0 });
  formError.value = '';
  formResult.value = '';
  formOpen.value = true;
}

async function generate() {
  formError.value = '';
  formResult.value = '';
  if (!form.periodId) {
    formError.value = 'Selecciona el grupo de pago y el período';
    return;
  }
  saving.value = true;
  try {
    const created = await generateAccruals({ periodId: form.periodId, projectId: form.projectId || undefined });
    const total = created.reduce((sum, batch) => sum + batch.totalCents, 0);
    const count = created.reduce((sum, batch) => sum + batch.activeCount, 0);
    formResult.value = `Se ${created.length === 1 ? 'creó 1 lote' : `crearon ${created.length} lotes`} con ${count} causaciones por ${formatUsd(total)}.`;
    await loadData();
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// Anulación de una causación o de un lote completo.
const annulTarget = ref<{ type: 'accrual'; accrual: Accrual } | { type: 'batch'; batch: AccrualBatch } | null>(null);
const annulReason = ref('');
const annulSaving = ref(false);
const annulError = ref('');

function openAnnul(target: NonNullable<typeof annulTarget.value>) {
  annulTarget.value = target;
  annulReason.value = '';
  annulError.value = '';
}

async function saveAnnul() {
  if (!annulTarget.value) return;
  annulError.value = '';
  annulSaving.value = true;
  try {
    if (annulTarget.value.type === 'accrual') {
      await annulAccrual(annulTarget.value.accrual.id, annulReason.value);
    } else {
      await annulBatch(annulTarget.value.batch.id, annulReason.value);
    }
    annulTarget.value = null;
    await loadData();
  } catch (e) {
    annulError.value = errorMessage(e);
  } finally {
    annulSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Causación</h1>
    <button v-if="canGenerate" type="button" class="button button-primary" @click="openGenerate">Generar causación</button>
  </div>
  <p class="hint">
    Monto causado por período: monto de la asignación × días activos ÷ días del período. Los registros no se editan ni se
    borran; los errores se corrigen anulando con un motivo.
  </p>

  <form v-if="formOpen" class="card form-grid section-gap" @submit.prevent="generate">
    <h2>Generar causación por lote</h2>
    <label class="field">
      Grupo de pago
      <select v-model.number="form.paymentGroupId" required>
        <option :value="0" disabled>Selecciona un grupo</option>
        <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
      </select>
    </label>
    <label class="field">
      Período
      <select v-model.number="form.periodId" required :disabled="!form.paymentGroupId">
        <option :value="0" disabled>Selecciona un período</option>
        <option v-for="period in closedPeriods" :key="period.id" :value="period.id">
          {{ formatRange(period.startDate, period.endDate) }} ({{ period.days }} días)
        </option>
      </select>
      <span class="hint">Solo aparecen los períodos que ya cerraron.</span>
    </label>
    <label class="field">
      Proyecto
      <select v-model.number="form.projectId">
        <option :value="0">Todos (un lote por proyecto)</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">
          {{ project.code }} · {{ project.name }}
        </option>
      </select>
    </label>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
    <p v-if="formResult" class="hint" role="status">{{ formResult }}</p>
    <div class="actions">
      <button type="submit" class="button button-primary" :disabled="saving">Generar</button>
      <button type="button" class="button" @click="formOpen = false">Cerrar</button>
    </div>
  </form>

  <form v-if="annulTarget" class="card form-grid section-gap" @submit.prevent="saveAnnul">
    <h2 v-if="annulTarget.type === 'accrual'">
      Anular causación #{{ annulTarget.accrual.id }} · {{ annulTarget.accrual.person.name }},
      {{ formatRange(annulTarget.accrual.period.startDate, annulTarget.accrual.period.endDate) }}
    </h2>
    <h2 v-else>
      Anular lote #{{ annulTarget.batch.id }} · {{ annulTarget.batch.project.code }},
      {{ formatRange(annulTarget.batch.period.startDate, annulTarget.batch.period.endDate) }}
    </h2>
    <label class="field">
      Motivo
      <input v-model="annulReason" required minlength="5" maxlength="500" />
    </label>
    <p class="hint">Después de anular se puede volver a generar la causación del período.</p>
    <p v-if="annulError" class="error" role="alert">{{ annulError }}</p>
    <div class="actions">
      <button type="submit" class="button button-primary" :disabled="annulSaving">Anular</button>
      <button type="button" class="button" @click="annulTarget = null">Cancelar</button>
    </div>
  </form>

  <form class="card form-grid section-gap" @submit.prevent>
    <label class="field">
      Proyecto
      <select v-model.number="filters.projectId">
        <option :value="0">Todos</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }}</option>
      </select>
    </label>
    <label class="field">
      Grupo de pago
      <select v-model.number="filters.paymentGroupId">
        <option :value="0">Todos</option>
        <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
      </select>
    </label>
    <label class="field">
      Período
      <select v-model.number="filters.periodId" :disabled="!filters.paymentGroupId">
        <option :value="0">Todos</option>
        <option v-for="period in filterPeriods" :key="period.id" :value="period.id">
          {{ formatRange(period.startDate, period.endDate) }}
        </option>
      </select>
    </label>
    <label class="field">
      Persona
      <select v-model.number="filters.personId">
        <option :value="0">Todas</option>
        <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }}</option>
      </select>
    </label>
    <label class="field">
      Estado
      <select v-model="filters.status">
        <option value="">Todos</option>
        <option value="UNPAID">Con saldo pendiente</option>
        <option v-for="(label, value) in ACCRUAL_STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
  </form>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <template v-else>
    <h2>Lotes</h2>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Lote</th>
            <th scope="col">Proyecto</th>
            <th scope="col">Período</th>
            <th scope="col">Causaciones vigentes</th>
            <th scope="col" class="num">Total</th>
            <th scope="col">Generado</th>
            <th v-if="canGenerate" scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in batches" :key="batch.id">
            <td class="nowrap">#{{ batch.id }}</td>
            <td class="nowrap" :title="batch.project.name">{{ batch.project.code }}</td>
            <td class="nowrap">
              {{ formatRange(batch.period.startDate, batch.period.endDate) }}
              <span class="permission-code">{{ batch.period.paymentGroup.name }}</span>
            </td>
            <td>{{ batch.activeCount }} de {{ batch.accrualCount }}</td>
            <td class="num">{{ formatUsd(batch.totalCents) }}</td>
            <td>
              {{ batch.createdBy.name }}
              <span class="permission-code">{{ formatDateTime(batch.createdAt) }}</span>
            </td>
            <td v-if="canGenerate">
              <button
                v-if="batch.activeCount > 0"
                type="button"
                class="button"
                @click="openAnnul({ type: 'batch', batch })"
              >
                Anular lote
              </button>
            </td>
          </tr>
          <tr v-if="batches.length === 0">
            <td :colspan="canGenerate ? 7 : 6">No hay lotes con esos filtros.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 class="section-gap">Causaciones</h2>
    <p class="hint">
      Causado {{ formatUsd(totals.amountCents) }} · Pagado {{ formatUsd(totals.paidCents) }} · Pendiente
      {{ formatUsd(totals.pendingCents) }}
    </p>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Persona</th>
            <th scope="col">Proyecto</th>
            <th scope="col">Período</th>
            <th scope="col">Días</th>
            <th scope="col" class="num">Monto por período</th>
            <th scope="col" class="num">Causado</th>
            <th scope="col" class="num">Pagado</th>
            <th scope="col" class="num">Pendiente</th>
            <th scope="col">Estado</th>
            <th v-if="canGenerate" scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="accrual in accruals" :key="accrual.id">
            <td>
              {{ accrual.person.name }}
              <span class="permission-code">{{ accrual.person.idNumber }}</span>
            </td>
            <td class="nowrap" :title="accrual.project.name">{{ accrual.project.code }}</td>
            <td class="nowrap">
              {{ formatRange(accrual.period.startDate, accrual.period.endDate) }}
              <span class="permission-code">Lote #{{ accrual.batchId }}</span>
            </td>
            <td class="nowrap">{{ accrual.activeDays }} / {{ accrual.periodDays }}</td>
            <td class="num">{{ formatUsd(accrual.assignmentAmountCents) }}</td>
            <td class="num">{{ formatUsd(accrual.amountCents) }}</td>
            <td class="num">{{ formatUsd(accrual.paidCents) }}</td>
            <td class="num">{{ formatUsd(accrual.pendingCents) }}</td>
            <td>
              <StatusBadge :label="ACCRUAL_STATUS_LABELS[accrual.status]" :tone="ACCRUAL_STATUS_TONES[accrual.status]" />
              <span v-if="accrual.openRequestId" class="permission-code">Solicitud #{{ accrual.openRequestId }}</span>
              <span v-if="accrual.annulmentReason" class="permission-code">{{ accrual.annulmentReason }}</span>
            </td>
            <td v-if="canGenerate">
              <button
                v-if="accrual.status === 'PENDING' && !accrual.openRequestId"
                type="button"
                class="button"
                @click="openAnnul({ type: 'accrual', accrual })"
              >
                Anular
              </button>
            </td>
          </tr>
          <tr v-if="accruals.length === 0">
            <td :colspan="canGenerate ? 10 : 9">No hay causaciones con esos filtros.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>
