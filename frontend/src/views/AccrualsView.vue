<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  annulAccrual,
  annulBatch,
  generateAccruals,
  listAccruals,
  listBatches,
  type Accrual,
  type AccrualBatch,
  type AccrualTotals,
  type AccrualStatusFilter,
} from '@/api/accruals';
import { errorMessage } from '@/api/http';
import { listPaymentGroups, listPeriods, type PaymentGroup, type Period } from '@/api/payment-groups';
import { listPeople, type Person } from '@/api/people';
import { listProjects, type Project } from '@/api/projects';
import AppIcon from '@/components/AppIcon.vue';
import AppModal from '@/components/AppModal.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatUsd } from '@/lib/money';
import { ACCRUAL_STATUS_TONES } from '@/lib/status';
import { notify } from '@/lib/toast';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { formatDate, formatDateTime, formatRange } from '@/lib/dates';

const auth = useAuthStore();
const canGenerate = computed(() => auth.can(PERMISSIONS.ACCRUALS_GENERATE));

const accruals = ref<Accrual[]>([]);
const batches = ref<AccrualBatch[]>([]);
const totals = ref<AccrualTotals>({ amountCents: 0, paidCents: 0, pendingCents: 0 });
// Cada tabla se pagina por separado; el total de causaciones cubre todo lo filtrado, no solo la página.
const accrualPaging = reactive({ page: 1, pageCount: 0, total: 0 });
const batchPaging = reactive({ page: 1, pageCount: 0, total: 0 });
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

function filterArgs() {
  return {
    projectId: filters.projectId || undefined,
    periodId: filters.periodId || undefined,
  };
}

async function loadAccruals(page = accrualPaging.page, seq = loadSeq) {
  const result = await listAccruals({
    ...filterArgs(),
    personId: filters.personId || undefined,
    paymentGroupId: filters.paymentGroupId || undefined,
    status: filters.status || undefined,
    page,
  });
  if (seq !== loadSeq) return;
  // Si anular dejó la página vacía, retrocede a la última que existe.
  if (result.accruals.length === 0 && result.pageCount > 0 && page > result.pageCount) {
    return loadAccruals(result.pageCount, seq);
  }
  accruals.value = result.accruals;
  totals.value = result.totals;
  Object.assign(accrualPaging, { page: result.page, pageCount: result.pageCount, total: result.total });
}

async function loadBatches(page = batchPaging.page, seq = loadSeq) {
  const result = await listBatches({ ...filterArgs(), page });
  if (seq !== loadSeq) return;
  if (result.batches.length === 0 && result.pageCount > 0 && page > result.pageCount) {
    return loadBatches(result.pageCount, seq);
  }
  batches.value = result.batches;
  Object.assign(batchPaging, { page: result.page, pageCount: result.pageCount, total: result.total });
}

// `reset` vuelve a la primera página de ambas tablas (filtros nuevos o lote recién generado).
let loadSeq = 0;

async function loadData(reset = false) {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    if (reset) {
      accrualPaging.page = 1;
      batchPaging.page = 1;
    }
    await Promise.all([loadAccruals(accrualPaging.page, seq), loadBatches(batchPaging.page, seq)]);
  } catch (e) {
    if (seq === loadSeq) error.value = errorMessage(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(filters, () => void loadData(true));

async function changePage(table: 'accruals' | 'batches', page: number) {
  error.value = '';
  try {
    await (table === 'accruals' ? loadAccruals(page) : loadBatches(page));
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function load() {
  try {
    [projects.value, people.value, groups.value] = await Promise.all([listProjects(), listPeople(), listPaymentGroups()]);
  } catch (e) {
    error.value = errorMessage(e);
  }
  await loadData(true);
}

const STATUS_LABELS = { PENDING: 'Por pagar', PARTIAL: 'Pagada en parte', PAID: 'Pagada', ANNULLED: 'Anulada' } as const;

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

const PERIODICITY: Record<string, string> = { WEEKLY: 'cada semana', BIWEEKLY: 'cada quincena', MONTHLY: 'cada mes' };
const selectedGroup = computed(() => groups.value.find((group) => group.id === form.paymentGroupId));
const nextPeriodToClose = computed(() => formPeriods.value.find((period) => period.endDate > today));

// Qué períodos cerrados ya tienen cálculos (con su total), para avisar antes de que el usuario intente repetirlos.
const calculated = ref<Record<number, { count: number; totalCents: number }>>({});

async function loadCalculated(list: Period[]) {
  const recent = list.slice(0, 8);
  const results = await Promise.all(
    recent.map((period) =>
      listAccruals({ periodId: period.id, pageSize: 1 })
        .then((page) => [period.id, { count: page.total, totalCents: page.totals.amountCents }] as const)
        .catch(() => [period.id, { count: 0, totalCents: 0 }] as const),
    ),
  );
  calculated.value = Object.fromEntries(results);
}

const isCalculated = (periodId: number) => (calculated.value[periodId]?.totalCents ?? 0) > 0;

// Al elegir un grupo se propone el período cerrado más reciente que todavía no tenga cálculos.
watch(closedPeriods, async (list) => {
  calculated.value = {};
  if (!list.length) return;
  await loadCalculated(list);
  if (!form.periodId) form.periodId = (list.find((period) => !isCalculated(period.id)) ?? list[0]).id;
});

const selectedCalculated = computed(() => (form.periodId ? calculated.value[form.periodId] : undefined));

async function friendlyGenerateError(message: string) {
  if (/No hay asignaciones pendientes/i.test(message)) {
    try {
      const page = await listAccruals({ periodId: form.periodId, projectId: form.projectId || undefined, pageSize: 1 });
      if (page.totals.amountCents > 0) {
        return `Ese período ya está calculado (${formatUsd(page.totals.amountCents)}) y no falta nadie por calcular. Elige otro período, uno que no diga «ya calculado».`;
      }
    } catch {
      // Si la consulta falla, se muestra el mensaje general.
    }
    return 'Ese período no tiene nada por calcular: ninguna persona tenía una asignación activa en esas fechas. Elige otro período.';
  }
  return message;
}

async function generate() {
  formError.value = '';
  formResult.value = '';
  if (!form.paymentGroupId) {
    formError.value = 'Primero elige el grupo de pago.';
    return;
  }
  if (!form.periodId) {
    formError.value = 'Elige el período que quieres calcular.';
    return;
  }
  saving.value = true;
  try {
    const created = await generateAccruals({ periodId: form.periodId, projectId: form.projectId || undefined });
    const total = created.reduce((sum, batch) => sum + batch.totalCents, 0);
    const count = created.reduce((sum, batch) => sum + batch.activeCount, 0);
    formOpen.value = false;
    notify(`Listo: se calculó lo que se debe a ${count} ${count === 1 ? 'persona' : 'personas'}, por un total de ${formatUsd(total)}. Ya puedes pedir ese dinero en una solicitud de pago.`, {
      action: undefined,
      seconds: 14,
    });
    await loadData(true);
  } catch (e) {
    formError.value = await friendlyGenerateError(errorMessage(e));
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
    notify('Listo: se anuló el cálculo. Se puede volver a calcular ese período.', { tone: 'info' });
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
    <h1>Cálculo de pagos</h1>
    <button v-if="canGenerate" type="button" class="button button-primary" @click="openGenerate">Calcular lo que se debe de un período</button>
  </div>
  <p class="hint">
        Cuando termina un período (una quincena, un mes…), aquí le pides al sistema que calcule cuánto se le debe a cada persona. Lo
        calculado es lo que después se pide en una <RouterLink :to="{ name: 'payment-requests' }">solicitud de pago</RouterLink>.
  </p>

  <!-- Asistente para calcular -->
  <AppModal :open="formOpen" title="Calcular lo que se debe de un período" @close="formOpen = false">
    <form class="form-grid" @submit.prevent="generate">
      <p class="hint">Elige el grupo y el período que ya terminó. El sistema calcula, para cada persona con asignación, lo que le toca por los días que trabajó.</p>

      <label class="field">
        1. ¿De qué grupo de pago?
        <select v-model.number="form.paymentGroupId">
          <option :value="0" disabled>Elige un grupo</option>
          <option v-for="group in groups" :key="group.id" :value="group.id">
            {{ group.name }} ({{ PERIODICITY[group.frequency] }})
          </option>
        </select>
        <span class="hint">Un grupo es una forma de pagar: por ejemplo, todos los que cobran cada quincena.</span>
      </label>

      <label class="field">
        2. ¿Qué período?
        <select v-model.number="form.periodId" :disabled="!form.paymentGroupId">
          <option :value="0" disabled>{{ form.paymentGroupId ? 'Elige un período' : 'Primero elige el grupo' }}</option>
          <option v-for="(period, index) in closedPeriods" :key="period.id" :value="period.id">
            {{ formatRange(period.startDate, period.endDate) }}{{ index === 0 ? ' — el más reciente' : '' }}{{ isCalculated(period.id) ? ' — ya calculado' : '' }}
          </option>
        </select>
        <span v-if="form.paymentGroupId && closedPeriods.length === 0" class="hint">
          Todavía no ha terminado ningún período de este grupo.
          <template v-if="nextPeriodToClose">El primero termina el {{ formatDate(nextPeriodToClose.endDate) }}.</template>
        </span>
        <span v-else-if="selectedCalculated && selectedCalculated.totalCents > 0" class="hint hint-warn">
          Este período ya está calculado ({{ formatUsd(selectedCalculated.totalCents) }}). Solo tiene sentido calcularlo otra vez si se agregó una asignación nueva.
        </span>
        <span v-else class="hint">Solo aparecen los períodos que ya terminaron. Los que dicen «ya calculado» ya tienen su cálculo.</span>
      </label>

      <label class="field">
        3. ¿Para qué proyectos?
        <select v-model.number="form.projectId">
          <option :value="0">Todos los proyectos</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
        </select>
      </label>

      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="confirm-actions">
        <button type="button" class="button" @click="formOpen = false">Volver</button>
        <button type="submit" class="button button-primary" :disabled="saving">{{ saving ? 'Calculando…' : 'Calcular' }}</button>
      </div>
    </form>
  </AppModal>

  <!-- Anular -->
  <ConfirmDialog
    :open="Boolean(annulTarget)"
    :title="annulTarget?.type === 'batch' ? '¿Anular este cálculo completo?' : '¿Anular este cálculo?'"
    confirm-label="Sí, anular"
    danger
    :busy="annulSaving"
    :error="annulError"
    reason-label="¿Por qué se anula?"
    reason-hint="Ej.: Se calculó con un monto equivocado"
    reason-required
    v-model:reason="annulReason"
    @close="annulTarget = null"
    @confirm="saveAnnul"
  >
    <template v-if="annulTarget">
      <p v-if="annulTarget.type === 'batch'" class="lead">
        Se anulará el cálculo del proyecto <strong>{{ annulTarget.batch.project.code }}</strong> para el período
        {{ formatRange(annulTarget.batch.period.startDate, annulTarget.batch.period.endDate) }} ({{ formatUsd(annulTarget.batch.totalCents) }}).
      </p>
      <p v-else class="lead">
        Se anulará lo calculado para <strong>{{ annulTarget.accrual.person.name }}</strong> en el período
        {{ formatRange(annulTarget.accrual.period.startDate, annulTarget.accrual.period.endDate) }} ({{ formatUsd(annulTarget.accrual.amountCents) }}).
      </p>
      <p>No se borra: queda marcado como anulado con tu motivo. Después se puede volver a calcular ese período.</p>
    </template>
  </ConfirmDialog>

  <section class="card" aria-label="Resumen">
    <dl class="summary-grid">
      <div>
        <dt>Total calculado</dt>
        <dd>{{ formatUsd(totals.amountCents) }}</dd>
      </div>
      <div>
        <dt>Ya pagado</dt>
        <dd>{{ formatUsd(totals.paidCents) }}</dd>
      </div>
      <div>
        <dt>Falta pagar</dt>
        <dd>{{ formatUsd(totals.pendingCents) }}</dd>
      </div>
    </dl>
  </section>

  <!-- Filtros sencillos -->
  <section class="card" aria-label="Filtrar">
    <div class="form-row">
      <label class="field">
        Proyecto
        <select v-model.number="filters.projectId">
          <option :value="0">Todos</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
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
          <option value="UNPAID">Falta pagar (todo o en parte)</option>
          <option v-for="(label, value) in STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
    </div>
    <details class="more-filters">
      <summary>Más opciones para filtrar</summary>
      <div class="form-row">
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
            <option :value="0">{{ filters.paymentGroupId ? 'Todos' : 'Primero elige un grupo' }}</option>
            <option v-for="period in filterPeriods" :key="period.id" :value="period.id">{{ formatRange(period.startDate, period.endDate) }}</option>
          </select>
        </label>
      </div>
    </details>
  </section>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <template v-else>
    <h2 class="section-gap">Lo que se le debe a cada persona</h2>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Persona</th>
            <th scope="col">Proyecto</th>
            <th scope="col">Período</th>
            <th scope="col">Días trabajados</th>
            <th scope="col" class="num">Le tocaba</th>
            <th scope="col" class="num">Ya recibió</th>
            <th scope="col" class="num">Se le debe</th>
            <th scope="col">Situación</th>
            <th v-if="canGenerate" scope="col"><span class="sr-only">Opciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="accrual in accruals" :key="accrual.id">
            <td>
              <strong>{{ accrual.person.name }}</strong>
              <span class="permission-code">{{ accrual.person.idNumber }}</span>
            </td>
            <td class="nowrap" :title="accrual.project.name">{{ accrual.project.code }}</td>
            <td class="nowrap">{{ formatRange(accrual.period.startDate, accrual.period.endDate) }}</td>
            <td class="nowrap">{{ accrual.activeDays }} de {{ accrual.periodDays }}</td>
            <td class="num">{{ formatUsd(accrual.amountCents) }}</td>
            <td class="num">{{ formatUsd(accrual.paidCents) }}</td>
            <td class="num"><strong>{{ formatUsd(accrual.pendingCents) }}</strong></td>
            <td>
              <StatusBadge :label="STATUS_LABELS[accrual.status]" :tone="ACCRUAL_STATUS_TONES[accrual.status]" />
              <span v-if="accrual.openRequestId" class="permission-code">Ya está en la solicitud #{{ accrual.openRequestId }}</span>
              <span v-if="accrual.annulmentReason" class="permission-code">Motivo: {{ accrual.annulmentReason }}</span>
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
            <td :colspan="canGenerate ? 9 : 8">No hay nada que mostrar con estos filtros. Quita algún filtro, o pulsa «Calcular lo que se debe de un período» si todavía no se ha calculado.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <PaginationBar
      :page="accrualPaging.page"
      :page-count="accrualPaging.pageCount"
      :total="accrualPaging.total"
      noun="registros"
      @change="changePage('accruals', $event)"
    />

    <details class="card fold section-gap">
      <summary>
        <AppIcon name="chevron" />
        Ver los cálculos hechos por período
        <span class="hint">{{ batchPaging.total }} {{ batchPaging.total === 1 ? 'cálculo' : 'cálculos' }} · aquí también se pueden anular</span>
      </summary>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Proyecto</th>
              <th scope="col">Período</th>
              <th scope="col">Personas incluidas</th>
              <th scope="col" class="num">Total</th>
              <th scope="col">Calculado por</th>
              <th v-if="canGenerate" scope="col"><span class="sr-only">Opciones</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="batch in batches" :key="batch.id">
              <td class="nowrap" :title="batch.project.name">{{ batch.project.code }}</td>
              <td class="nowrap">
                {{ formatRange(batch.period.startDate, batch.period.endDate) }}
                <span class="permission-code">{{ batch.period.paymentGroup.name }}</span>
              </td>
              <td>{{ batch.activeCount }}</td>
              <td class="num">{{ formatUsd(batch.totalCents) }}</td>
              <td>
                {{ batch.createdBy.name }}
                <span class="permission-code">{{ formatDateTime(batch.createdAt) }}</span>
              </td>
              <td v-if="canGenerate">
                <button v-if="batch.activeCount > 0" type="button" class="button" @click="openAnnul({ type: 'batch', batch })">
                  Anular todo este cálculo
                </button>
              </td>
            </tr>
            <tr v-if="batches.length === 0">
              <td :colspan="canGenerate ? 6 : 5">Todavía no se ha calculado nada con estos filtros.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar
        :page="batchPaging.page"
        :page-count="batchPaging.pageCount"
        :total="batchPaging.total"
        noun="cálculos"
        @change="changePage('batches', $event)"
      />
    </details>
  </template>
</template>
