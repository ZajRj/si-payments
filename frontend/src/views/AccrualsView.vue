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
} from '@/api/accruals';
import { errorMessage } from '@/api/http';
import { listPaymentGroups, listPeriods, type PaymentGroup, type Period } from '@/api/payment-groups';
import { listPeople, type Person } from '@/api/people';
import { listProjects, type Project } from '@/api/projects';
import AppIcon from '@/components/AppIcon.vue';
import AppModal from '@/components/AppModal.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatUsd } from '@/lib/money';
import { ACCRUAL_STATUS_TONES } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, formatRange } from '@/lib/dates';

const auth = useAuthStore();
const canGenerate = computed(() => auth.can(PERMISSIONS.ACCRUALS_GENERATE));

const batches = ref<AccrualBatch[]>([]);
const paging = reactive({ page: 1, pageCount: 0, total: 0 });
const projects = ref<Project[]>([]);
const people = ref<Person[]>([]);
const groups = ref<PaymentGroup[]>([]);
const loading = ref(true);
const error = ref('');

const filters = reactive({ projectId: 0, paymentGroupId: 0, periodId: 0, personId: 0 });
const filterPeriods = ref<Period[]>([]);
const hasFilters = computed(() => Boolean(filters.projectId || filters.paymentGroupId || filters.periodId || filters.personId));

function clearFilters() {
  Object.assign(filters, { projectId: 0, paymentGroupId: 0, periodId: 0, personId: 0 });
}

// Fecha local en formato AAAA-MM-DD, para comparar con las fechas de la API.
const today = new Date().toLocaleDateString('sv-SE');

async function periodsOf(groupId: number) {
  return groupId ? listPeriods(groupId) : [];
}

// Los períodos del filtro dependen del grupo elegido.
watch(
  () => filters.paymentGroupId,
  async (groupId) => {
    filters.periodId = 0;
    try {
      filterPeriods.value = (await periodsOf(groupId)).slice().reverse();
    } catch (e) {
      error.value = errorMessage(e);
    }
  },
);

// Si cambian los filtros mientras hay una consulta en vuelo, solo la última actualiza la tabla.
let loadSeq = 0;

async function loadBatches(page = paging.page) {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const result = await listBatches({
      projectId: filters.projectId || undefined,
      paymentGroupId: filters.paymentGroupId || undefined,
      periodId: filters.periodId || undefined,
      personId: filters.personId || undefined,
      page,
    });
    if (seq !== loadSeq) return;
    // Si la página quedó fuera de rango, retrocede a la última que existe.
    if (result.batches.length === 0 && result.pageCount > 0 && page > result.pageCount) {
      return loadBatches(result.pageCount);
    }
    batches.value = result.batches;
    Object.assign(paging, { page: result.page, pageCount: result.pageCount, total: result.total });
  } catch (e) {
    if (seq === loadSeq) error.value = errorMessage(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(filters, () => {
  collapseAll();
  void loadBatches(1);
});

async function load() {
  try {
    [projects.value, people.value, groups.value] = await Promise.all([listProjects(), listPeople(), listPaymentGroups()]);
  } catch (e) {
    error.value = errorMessage(e);
  }
  await loadBatches(1);
}

// Lotes desplegados y sus causaciones. Se cargan al desplegar y se guardan mientras siga abierto.
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

async function changePage(page: number) {
  collapseAll();
  await loadBatches(page);
}

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
    await loadBatches(1);
    // Despliega lo recién generado para ver su detalle sin buscarlo.
    for (const batch of created) {
      if (!expanded.has(batch.id) && batches.value.some((row) => row.id === batch.id)) toggleBatch(batch.id);
    }
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
    await Promise.all([loadBatches(), reloadExpanded()]);
  } catch (e) {
    annulError.value = errorMessage(e);
  } finally {
    annulSaving.value = false;
  }
}

// Una causación se puede anular si no tiene pagos ni está en una solicitud abierta.
function annulBlockedReason(accrual: Accrual) {
  if (accrual.status === 'ANNULLED') return '';
  if (accrual.openRequestId) return `En la solicitud #${accrual.openRequestId}`;
  if (accrual.paidCents > 0) return 'Tiene pagos';
  return '';
}

const selectedPersonId = computed(() => filters.personId);

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
const colspan = 8;

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Causación</h1>
    <button v-if="canGenerate" type="button" class="button button-primary" @click="openGenerate">Generar causación</button>
  </div>
  <p class="hint">
    Cada lote es una generación de la causación de un proyecto en un período. Despliega un lote para ver lo causado a cada
    persona: monto de la asignación × días activos ÷ días del período. Nada se edita ni se borra; los errores se corrigen
    anulando con un motivo.
  </p>

  <AppModal :open="formOpen" title="Generar causación por lote" @close="formOpen = false">
    <form class="form-grid" @submit.prevent="generate">
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
      <label class="field field-wide">
        Proyecto
        <select v-model.number="form.projectId">
          <option :value="0">Todos (un lote por proyecto)</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.code }} · {{ project.name }}
          </option>
        </select>
      </label>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <p v-if="formResult" class="notice notice-success" role="status">{{ formResult }}</p>
      <div class="actions">
        <button type="button" class="button" @click="formOpen = false">Cerrar</button>
        <button type="submit" class="button button-primary" :disabled="saving">Generar</button>
      </div>
    </form>
  </AppModal>

  <AppModal
    :open="Boolean(annulTarget)"
    :title="
      annulTarget
        ? annulTarget.type === 'accrual'
          ? `Anular causación #${annulTarget.accrual.id} · ${annulTarget.accrual.person.name}`
          : `Anular lote #${annulTarget.batch.id} · ${annulTarget.batch.project.code}`
        : ''
    "
    @close="annulTarget = null"
  >
    <form v-if="annulTarget" class="form-grid" @submit.prevent="saveAnnul">
      <p v-if="annulTarget.type === 'batch'" class="hint">
        Se anularán las {{ annulTarget.batch.activeCount }} causaciones vigentes del lote, por
        {{ formatUsd(annulTarget.batch.totalCents) }}, del período
        {{ formatRange(annulTarget.batch.period.startDate, annulTarget.batch.period.endDate) }}. Si alguna tiene pagos o está en
        una solicitud abierta, no se anula ninguna. Después se puede volver a generar el período.
      </p>
      <p v-else class="hint">
        Se anulará la causación de {{ formatUsd(annulTarget.accrual.amountCents) }} del período
        {{ formatRange(annulTarget.accrual.period.startDate, annulTarget.accrual.period.endDate) }}. Queda registrada como
        anulada, no se borra. Después se puede volver a generar el período.
      </p>
      <label class="field field-wide">
        Motivo
        <input v-model="annulReason" required minlength="5" maxlength="500" />
      </label>
      <p v-if="annulError" class="error" role="alert">{{ annulError }}</p>
      <div class="actions">
        <button type="button" class="button" @click="annulTarget = null">Volver</button>
        <button type="submit" class="button button-danger-solid" :disabled="annulSaving">
          {{ annulTarget.type === 'batch' ? 'Anular lote' : 'Anular causación' }}
        </button>
      </div>
    </form>
  </AppModal>

  <form class="card form-grid section-gap" @submit.prevent>
    <label class="field">
      Proyecto
      <select v-model.number="filters.projectId">
        <option :value="0">Todos</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
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
        <option :value="0">{{ filters.paymentGroupId ? 'Todos' : 'Elige antes el grupo' }}</option>
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
    <div v-if="hasFilters || expanded.size > 0" class="actions">
      <button v-if="expanded.size > 0" type="button" class="button" @click="collapseAll">Contraer todo</button>
      <button v-if="hasFilters" type="button" class="button" @click="clearFilters">Limpiar filtros</button>
    </div>
  </form>

  <p v-if="error" class="error section-gap" role="alert">{{ error }}</p>
  <p v-else-if="loading && batches.length === 0" class="section-gap">Cargando…</p>
  <template v-else>
    <div class="table-wrapper section-gap" :class="{ 'is-loading': loading }">
      <table class="batch-table">
        <thead>
          <tr>
            <th scope="col">Lote</th>
            <th scope="col">Proyecto</th>
            <th scope="col">Período</th>
            <th scope="col" class="num">Causado</th>
            <th scope="col" class="num">Pagado</th>
            <th scope="col" class="num">Pendiente</th>
            <th scope="col">Generado</th>
            <th scope="col" class="expand-col"><span class="sr-only">Detalle</span></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="batch in batches" :key="batch.id">
            <!-- La fila completa despliega con el ratón; con teclado se usa el botón de la última columna. -->
            <tr class="expand-row" :class="{ 'is-expanded': expanded.has(batch.id) }" @click="toggleBatch(batch.id)">
              <td>
                <strong>#{{ batch.id }}</strong>
                <span class="permission-code nowrap">{{ plural(batch.activeCount, 'causación', 'causaciones') }}</span>
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
                  :aria-label="`${expanded.has(batch.id) ? 'Ocultar' : 'Ver'} las causaciones del lote ${batch.id}`"
                  @click="toggleBatch(batch.id)"
                >
                  <AppIcon name="chevron" :size="16" />
                </button>
              </td>
            </tr>

            <tr v-if="expanded.has(batch.id)" :id="`lote-${batch.id}`" class="expand-detail-row">
              <td :colspan="colspan" class="expand-detail-cell">
                <p v-if="expanded.get(batch.id)!.error" class="error" role="alert">{{ expanded.get(batch.id)!.error }}</p>
                <p v-else-if="expanded.get(batch.id)!.loading" class="hint">Cargando causaciones…</p>
                <div v-else class="batch-panel">
                  <div class="batch-panel-head">
                    <span>
                      Lote #{{ batch.id }} · {{ batch.project.code }} {{ batch.project.name }} ·
                      {{ formatRange(batch.period.startDate, batch.period.endDate) }} ({{ batch.period.paymentGroup.name }})
                    </span>
                    <template v-if="canGenerate && batch.activeCount > 0">
                      <button
                        v-if="batch.paidCents === 0"
                        type="button"
                        class="button button-danger"
                        @click="openAnnul({ type: 'batch', batch })"
                      >
                        Anular lote
                      </button>
                      <span v-else class="hint">El lote tiene pagos: no se puede anular completo.</span>
                    </template>
                  </div>
                  <div class="batch-panel-scroll">
                  <table class="batch-accruals">
                    <thead>
                      <tr>
                        <th scope="col">Persona</th>
                        <th scope="col">Días activos</th>
                        <th scope="col" class="num">Monto por período</th>
                        <th scope="col" class="num">Causado</th>
                        <th scope="col" class="num">Pagado</th>
                        <th scope="col" class="num">Pendiente</th>
                        <th scope="col">Estado</th>
                        <th v-if="canGenerate" scope="col"><span class="sr-only">Acciones</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="accrual in expanded.get(batch.id)!.accruals"
                        :key="accrual.id"
                        :class="{
                          'is-annulled': accrual.status === 'ANNULLED',
                          'is-highlighted': accrual.person.id === selectedPersonId,
                        }"
                      >
                        <td>
                          {{ accrual.person.name }}
                          <span class="permission-code">{{ accrual.person.idNumber }} · causación #{{ accrual.id }}</span>
                        </td>
                        <td class="nowrap">
                          {{ accrual.activeDays }} de {{ accrual.periodDays }}
                          <span
                            v-if="accrual.activeDays < accrual.periodDays"
                            class="permission-code"
                            title="Trabajó parte del período: se causa en proporción a los días"
                          >
                            prorrateado
                          </span>
                        </td>
                        <td class="num">{{ formatUsd(accrual.assignmentAmountCents) }}</td>
                        <td class="num">{{ formatUsd(accrual.amountCents) }}</td>
                        <td class="num">{{ formatUsd(accrual.paidCents) }}</td>
                        <td class="num">{{ formatUsd(accrual.pendingCents) }}</td>
                        <td>
                          <StatusBadge
                            :label="ACCRUAL_STATUS_LABELS[accrual.status]"
                            :tone="ACCRUAL_STATUS_TONES[accrual.status]"
                          />
                          <span v-if="accrual.annulmentReason" class="permission-code">{{ accrual.annulmentReason }}</span>
                          <span v-else-if="annulBlockedReason(accrual)" class="permission-code">
                            {{ annulBlockedReason(accrual) }}
                          </span>
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
                        <td :colspan="canGenerate ? 8 : 7" class="hint">El lote no tiene causaciones.</td>
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
            <td :colspan="colspan">
              {{ hasFilters ? 'No hay lotes con esos filtros.' : 'Todavía no se ha generado ninguna causación.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <PaginationBar
      :page="paging.page"
      :page-count="paging.pageCount"
      :total="paging.total"
      noun="lotes"
      @change="changePage"
    />
  </template>
</template>
