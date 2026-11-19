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
// Dos vistas de lo mismo: por período (cada cálculo) o por persona (lo que se le debe a cada una).
const tab = ref<'batches' | 'people'>('batches');
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
  const result = await listBatches({
    ...filterArgs(),
    paymentGroupId: filters.paymentGroupId || undefined,
    personId: filters.personId || undefined,
    page,
  });
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

watch(filters, () => {
  collapseAll();
  void loadData(true);
});

// Cálculos desplegados y las personas que incluyen. Se cargan al desplegar y se guardan mientras siga abierto.
type BatchDetail = { loading: boolean; error: string; accruals: Accrual[] };
const expanded = reactive(new Map<number, BatchDetail>());

async function loadDetail(batchId: number) {
  const detail = expanded.get(batchId);
  if (!detail) return;
  detail.loading = true;
  detail.error = '';
  try {
    const all: Accrual[] = [];
    for (let page = 1; ; page++) {
      const result = await listAccruals({ batchId, page });
      all.push(...result.accruals);
      if (page >= result.pageCount) break;
    }
    // Primero las vigentes, por persona; las anuladas al final.
    detail.accruals = all.sort(
      (a, b) => Number(a.status === 'ANNULLED') - Number(b.status === 'ANNULLED') || a.person.name.localeCompare(b.person.name),
    );
  } catch (e) {
    detail.error = errorMessage(e);
  } finally {
    detail.loading = false;
  }
}

function toggleBatch(batchId: number) {
  if (expanded.has(batchId)) {
    expanded.delete(batchId);
    return;
  }
  expanded.set(batchId, { loading: true, error: '', accruals: [] });
  void loadDetail(batchId);
}

function collapseAll() {
  expanded.clear();
}

function reloadExpanded() {
  return Promise.all([...expanded.keys()].map((id) => loadDetail(id)));
}

// Un cálculo por persona se puede anular si no tiene pagos ni está en una solicitud abierta.
function annulBlockedReason(accrual: Accrual) {
  if (accrual.status === 'ANNULLED') return '';
  if (accrual.openRequestId) return `Ya está en la solicitud #${accrual.openRequestId}`;
  if (accrual.paidCents > 0) return 'Ya tiene pagos';
  return '';
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

// Rango compacto para la tabla: "01/11 al 15/11/2026" si ambas fechas son del mismo año.
function shortRange(start: string, end: string) {
  const full = formatRange(start, end);
  if (start.slice(0, 4) !== end.slice(0, 4)) return full;
  const [from, to] = full.split(' al ');
  return to ? `${from.slice(0, 5)} al ${to}` : full;
}
const batchColspan = 8;

async function changePage(table: 'accruals' | 'batches', page: number) {
  if (table === 'batches') collapseAll();
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
    // Despliega lo recién calculado para ver su detalle sin buscarlo.
    for (const batch of created) {
      if (!expanded.has(batch.id) && batches.value.some((row) => row.id === batch.id)) toggleBatch(batch.id);
    }
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
    await Promise.all([loadData(), reloadExpanded()]);
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

  <div class="chips tab-bar" role="group" aria-label="Cómo quieres ver los cálculos">
    <button type="button" class="chip" :aria-pressed="tab === 'batches'" @click="tab = 'batches'">
      Por período
      <span class="chip-count">{{ batchPaging.total }}</span>
    </button>
    <button type="button" class="chip" :aria-pressed="tab === 'people'" @click="tab = 'people'">
      Por persona
      <span class="chip-count">{{ accrualPaging.total }}</span>
    </button>
  </div>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <template v-else>
    <section v-if="tab === 'batches'" class="card" aria-label="Cálculos por período">
      <div class="tab-head">
        <p class="hint">
          Cada fila es un cálculo de un proyecto en un período. Toca una fila para ver lo que le tocó a cada persona.
          <template v-if="filters.personId">La persona que elegiste arriba aparece resaltada.</template>
        </p>
        <button v-if="expanded.size > 0" type="button" class="button" @click="collapseAll">Contraer todo</button>
      </div>
      <div class="table-wrapper" :class="{ 'is-loading': loading }">
        <table class="batch-table">
          <thead>
            <tr>
              <th scope="col">Cálculo</th>
              <th scope="col">Proyecto</th>
              <th scope="col">Período</th>
              <th scope="col" class="num">Calculado</th>
              <th scope="col" class="num">Ya pagado</th>
              <th scope="col" class="num">Falta pagar</th>
              <th scope="col">Hecho</th>
              <th scope="col" class="expand-col"><span class="sr-only">Detalle</span></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="batch in batches" :key="batch.id">
              <!-- La fila completa despliega con el ratón; con teclado se usa el botón de la última columna. -->
              <tr class="expand-row" :class="{ 'is-expanded': expanded.has(batch.id) }" @click="toggleBatch(batch.id)">
                <td>
                  <strong>#{{ batch.id }}</strong>
                  <span class="permission-code nowrap">{{ plural(batch.activeCount, 'persona', 'personas') }}</span>
                  <span v-if="batch.accrualCount > batch.activeCount" class="permission-code nowrap">
                    {{ plural(batch.accrualCount - batch.activeCount, 'anulada', 'anuladas') }}
                  </span>
                </td>
                <td :title="batch.project.name">
                  {{ batch.project.code }}
                  <span class="permission-code cell-truncate">{{ batch.project.name }}</span>
                </td>
                <td>
                  <span class="nowrap">{{ shortRange(batch.period.startDate, batch.period.endDate) }}</span>
                  <span class="permission-code">{{ batch.period.paymentGroup.name }}</span>
                </td>
                <td class="num">{{ formatUsd(batch.totalCents) }}</td>
                <td class="num">{{ formatUsd(batch.paidCents) }}</td>
                <td class="num">
                  <strong v-if="batch.pendingCents > 0">{{ formatUsd(batch.pendingCents) }}</strong>
                  <span v-else class="hint">{{ formatUsd(0) }}</span>
                </td>
                <td>
                  <span class="nowrap">{{ formatDateTime(batch.createdAt) }}</span>
                  <span class="permission-code nowrap-wide">{{ batch.createdBy.name }}</span>
                </td>
                <td class="expand-col" @click.stop>
                  <button
                    type="button"
                    class="row-chevron"
                    :class="{ 'is-open': expanded.has(batch.id) }"
                    :aria-expanded="expanded.has(batch.id)"
                    :aria-controls="`lote-${batch.id}`"
                    :aria-label="`${expanded.has(batch.id) ? 'Ocultar' : 'Ver'} las personas del cálculo ${batch.id}`"
                    @click="toggleBatch(batch.id)"
                  >
                    <AppIcon name="chevron" :size="16" />
                  </button>
                </td>
              </tr>

              <tr v-if="expanded.has(batch.id)" :id="`lote-${batch.id}`" class="expand-detail-row">
                <td :colspan="batchColspan" class="expand-detail-cell">
                  <p v-if="expanded.get(batch.id)!.error" class="error" role="alert">{{ expanded.get(batch.id)!.error }}</p>
                  <p v-else-if="expanded.get(batch.id)!.loading" class="hint">Cargando…</p>
                  <div v-else class="batch-panel">
                    <div class="batch-panel-head">
                      <span>
                        Cálculo #{{ batch.id }} · {{ batch.project.code }} {{ batch.project.name }} ·
                        {{ formatRange(batch.period.startDate, batch.period.endDate) }} ({{ batch.period.paymentGroup.name }})
                      </span>
                      <template v-if="canGenerate && batch.activeCount > 0">
                        <button v-if="batch.paidCents === 0" type="button" class="button button-danger" @click="openAnnul({ type: 'batch', batch })">
                          Anular todo este cálculo
                        </button>
                        <span v-else class="hint">Ya tiene pagos: no se puede anular completo.</span>
                      </template>
                    </div>
                    <div class="batch-panel-scroll">
                      <table class="batch-accruals">
                        <thead>
                          <tr>
                            <th scope="col">Persona</th>
                            <th scope="col">Días trabajados</th>
                            <th scope="col" class="num">Monto por período</th>
                            <th scope="col" class="num">Le tocaba</th>
                            <th scope="col" class="num">Ya recibió</th>
                            <th scope="col" class="num">Se le debe</th>
                            <th scope="col">Situación</th>
                            <th v-if="canGenerate" scope="col"><span class="sr-only">Opciones</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="accrual in expanded.get(batch.id)!.accruals"
                            :key="accrual.id"
                            :class="{ 'is-annulled': accrual.status === 'ANNULLED', 'is-highlighted': accrual.person.id === filters.personId }"
                          >
                            <td>
                              {{ accrual.person.name }}
                              <span class="permission-code">{{ accrual.person.idNumber }}</span>
                            </td>
                            <td class="nowrap">
                              {{ accrual.activeDays }} de {{ accrual.periodDays }}
                              <span v-if="accrual.activeDays < accrual.periodDays" class="permission-code" title="Trabajó parte del período: se paga en proporción a los días">
                                parte del período
                              </span>
                            </td>
                            <td class="num">{{ formatUsd(accrual.assignmentAmountCents) }}</td>
                            <td class="num">{{ formatUsd(accrual.amountCents) }}</td>
                            <td class="num">{{ formatUsd(accrual.paidCents) }}</td>
                            <td class="num">{{ formatUsd(accrual.pendingCents) }}</td>
                            <td>
                              <StatusBadge :label="STATUS_LABELS[accrual.status]" :tone="ACCRUAL_STATUS_TONES[accrual.status]" />
                              <span v-if="accrual.annulmentReason" class="permission-code">Motivo: {{ accrual.annulmentReason }}</span>
                              <span v-else-if="annulBlockedReason(accrual)" class="permission-code">{{ annulBlockedReason(accrual) }}</span>
                            </td>
                            <td v-if="canGenerate" class="nowrap">
                              <button
                                v-if="accrual.status === 'PENDING' && !accrual.openRequestId"
                                type="button"
                                class="button button-danger"
                                @click="openAnnul({ type: 'accrual', accrual })"
                              >
                                Anular
                              </button>
                            </td>
                          </tr>
                          <tr v-if="expanded.get(batch.id)!.accruals.length === 0">
                            <td :colspan="canGenerate ? 8 : 7" class="hint">Este cálculo no tiene personas.</td>
                          </tr>
                        </tbody>
                        <tfoot v-if="expanded.get(batch.id)!.accruals.length > 0">
                          <tr>
                            <th scope="row" colspan="3">Total vigente</th>
                            <td class="num">{{ formatUsd(batch.totalCents) }}</td>
                            <td class="num">{{ formatUsd(batch.paidCents) }}</td>
                            <td class="num">{{ formatUsd(batch.pendingCents) }}</td>
                            <td :colspan="canGenerate ? 2 : 1"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="batches.length === 0">
              <td :colspan="batchColspan">Todavía no se ha calculado nada con estos filtros.</td>
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
    </section>

    <section v-else class="card" aria-label="Lo que se le debe a cada persona">
      <div class="tab-head">
        <p class="hint">Cada fila es lo que le tocó a una persona en un período, lo que ya recibió y lo que se le debe todavía.</p>
      </div>
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
    </section>
  </template>
</template>
