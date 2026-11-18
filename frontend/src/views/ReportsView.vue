<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { listAreas, type Area } from '@/api/areas';
import { errorMessage } from '@/api/http';
import { listProjects, type Project } from '@/api/projects';
import {
  getBalances,
  getPaymentsReport,
  type BalanceRow,
  type BalancesReport,
  type GroupBy,
  type PaymentsReport,
} from '@/api/reports';
import BalanceList from '@/components/reports/BalanceList.vue';
import PaymentsLedger from '@/components/reports/PaymentsLedger.vue';
import ProjectReportPage from '@/components/reports/ProjectReportPage.vue';
import PersonStatementPage from '@/components/reports/PersonStatementPage.vue';
import ReportSummary from '@/components/reports/ReportSummary.vue';

type Lens = 'balances' | 'payments';
type Preset = 'all' | 'month' | 'lastMonth' | 'year' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes pasado' },
  { value: 'year', label: 'Este año' },
  { value: 'custom', label: 'Personalizado' },
];

const route = useRoute();
const router = useRouter();

// La persona abierta a pantalla completa vive en la URL (?id=); la lista queda montada debajo,
// así al volver se conservan los filtros y la selección.
const positiveId = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const personId = computed(() => positiveId(route.query.personaId));
const projectDetailId = computed(() => positiveId(route.query.proyectoId));
const detailId = computed(() => personId.value ?? projectDetailId.value);

const lens = ref<Lens>('balances');
const groupBy = ref<GroupBy>('person');
const preset = ref<Preset>('all');
// Si se llega desde el detalle de una persona, los filtros vuelven en la URL.
const queryText = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '');
const filters = reactive({
  projectId: Number(queryText('projectId')) || 0,
  areaId: 0,
  from: queryText('from'),
  to: queryText('to'),
});
if (filters.from || filters.to) preset.value = 'custom';

const projects = ref<Project[]>([]);
const areas = ref<Area[]>([]);

const balances = ref<BalancesReport | null>(null);
const payments = ref<PaymentsReport | null>(null);
const loading = ref(false);
const error = ref('');


const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function applyPreset(value: Preset) {
  preset.value = value;
  const now = new Date();
  if (value === 'all') {
    filters.from = '';
    filters.to = '';
  } else if (value === 'month') {
    filters.from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    filters.to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  } else if (value === 'lastMonth') {
    filters.from = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    filters.to = iso(new Date(now.getFullYear(), now.getMonth(), 0));
  } else if (value === 'year') {
    filters.from = iso(new Date(now.getFullYear(), 0, 1));
    filters.to = iso(new Date(now.getFullYear(), 11, 31));
  }
}

const baseFilters = () => ({
  projectId: filters.projectId || undefined,
  from: filters.from || undefined,
  to: filters.to || undefined,
});

const hasActiveFilters = computed(() => preset.value !== 'all' || filters.projectId > 0 || filters.areaId > 0);

function clearFilters() {
  filters.projectId = 0;
  filters.areaId = 0;
  applyPreset('all');
}

// Evita que una respuesta lenta pise a una más reciente.
let balancesSeq = 0;
let paymentsSeq = 0;

async function loadBalances() {
  const seq = ++balancesSeq;
  loading.value = true;
  error.value = '';
  try {
    const result = await getBalances(groupBy.value, { ...baseFilters(), areaId: filters.areaId || undefined });
    if (seq === balancesSeq) balances.value = result;
  } catch (e) {
    if (seq === balancesSeq) error.value = errorMessage(e);
  } finally {
    if (seq === balancesSeq) loading.value = false;
  }
}

async function loadPayments() {
  const seq = ++paymentsSeq;
  loading.value = true;
  error.value = '';
  try {
    const result = await getPaymentsReport({ ...baseFilters(), areaId: filters.areaId || undefined });
    if (seq === paymentsSeq) payments.value = result;
  } catch (e) {
    if (seq === paymentsSeq) error.value = errorMessage(e);
  } finally {
    if (seq === paymentsSeq) loading.value = false;
  }
}

function refresh() {
  void loadBalances();
  if (lens.value === 'payments') void loadPayments();
}

function selectRow(row: BalanceRow) {
  if (row.person) {
    // Una persona abre directo su estado de cuenta completo, con los filtros en la URL.
    void router.push({
      name: 'reports',
      query: {
        personaId: row.person.id,
        projectId: filters.projectId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      },
    });
  } else if (row.project) {
    // Un proyecto abre su reporte completo, con el rango de fechas en la URL.
    void router.push({
      name: 'reports',
      query: { proyectoId: row.project.id, from: filters.from || undefined, to: filters.to || undefined },
    });
  }
}

watch(() => [filters.projectId, filters.areaId, filters.from, filters.to], refresh);
watch(groupBy, () => {
  void loadBalances();
});
watch(lens, (value) => {
  if (value === 'payments') void loadPayments();
});

onMounted(async () => {
  try {
    [projects.value, areas.value] = await Promise.all([listProjects(), listAreas()]);
  } catch (e) {
    error.value = errorMessage(e);
  }
  await loadBalances();
});

const totals = computed(() => balances.value?.totals ?? { accruedCents: 0, paidCents: 0, owedCents: 0, accrualCount: 0 });
</script>

<template>
  <PersonStatementPage v-if="personId" :id="personId" />
  <ProjectReportPage v-else-if="projectDetailId" :id="projectDetailId" />
  <div v-show="!detailId" class="rp">
    <header class="rp-head">
      <div>
        <h1>Reportes</h1>
        <p class="rp-sub">Lo causado, lo pagado y lo que se adeuda, por persona, proyecto y fecha.</p>
      </div>
      <div class="seg seg-lg" role="group" aria-label="Vista del reporte">
        <button type="button" :aria-pressed="lens === 'balances'" :class="{ on: lens === 'balances' }" @click="lens = 'balances'">
          Saldos
        </button>
        <button type="button" :aria-pressed="lens === 'payments'" :class="{ on: lens === 'payments' }" @click="lens = 'payments'">
          Libro de pagos
        </button>
      </div>
    </header>

    <section class="filters" aria-label="Filtros">
      <div class="chips" role="group" aria-label="Período">
        <button
          v-for="item in PRESETS"
          :key="item.value"
          type="button"
          class="chip"
          :aria-pressed="preset === item.value"
          @click="item.value === 'custom' ? (preset = 'custom') : applyPreset(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="filter-fields">
        <label v-if="preset === 'custom'" class="f">
          <span>Desde</span>
          <input v-model="filters.from" type="date" />
        </label>
        <label v-if="preset === 'custom'" class="f">
          <span>Hasta</span>
          <input v-model="filters.to" type="date" />
        </label>
        <label class="f">
          <span>Proyecto</span>
          <select v-model.number="filters.projectId">
            <option :value="0">Todos</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
          </select>
        </label>
        <label class="f">
          <span>Área</span>
          <select v-model.number="filters.areaId">
            <option :value="0">Todas</option>
            <option v-for="area in areas" :key="area.id" :value="area.id">{{ area.name }}</option>
          </select>
        </label>
        <button v-if="hasActiveFilters" type="button" class="link" @click="clearFilters">Limpiar filtros</button>
      </div>
      <p class="note">
        {{
          lens === 'payments'
            ? 'Las fechas filtran por el día de entrega del pago.'
            : 'Las causaciones se filtran por la fecha de fin de su período; lo pagado es lo aplicado a ellas, sin importar la fecha del pago.'
        }}
      </p>
    </section>

    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <ReportSummary v-if="balances" v-bind="totals" :class="{ 'is-loading': loading }" />

    <template v-if="lens === 'balances'">
      <div class="subbar">
        <div class="seg" role="group" aria-label="Agrupar por">
          <button type="button" :aria-pressed="groupBy === 'person'" :class="{ on: groupBy === 'person' }" @click="groupBy = 'person'">Por persona</button>
          <button type="button" :aria-pressed="groupBy === 'project'" :class="{ on: groupBy === 'project' }" @click="groupBy = 'project'">Por proyecto</button>
        </div>
        <span class="hint-inline">
          {{ groupBy === 'person' ? 'Selecciona una persona para abrir su estado de cuenta completo.' : 'Selecciona un proyecto para abrir su reporte completo.' }}
        </span>
      </div>

      <BalanceList v-if="balances" :rows="balances.rows" :group-by="groupBy" @select="selectRow" />
      <p v-else-if="loading" class="loading">Cargando…</p>
    </template>

    <template v-else>
      <PaymentsLedger v-if="payments" :report="payments" />
      <p v-else-if="loading" class="loading">Cargando…</p>
    </template>
  </div>
</template>

<style scoped>
.rp {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.rp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
}
.rp-sub {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
}
.seg button {
  font: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.85rem;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.seg button + button {
  border-left: 1px solid var(--border-strong);
}
.seg button.on {
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 650;
}
.seg-lg button {
  padding: 0.55rem 1.1rem;
  font-size: 0.95rem;
}

.filters {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.9rem 1rem;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.filter-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}
.f {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--muted);
}
.f select,
.f input {
  font: inherit;
  font-weight: 400;
  min-width: 11rem;
  max-width: 18rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
}
.link {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.45rem 0.25rem;
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
}
.note {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}
.err {
  margin: 0;
  padding: 0.7rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
}
.is-loading {
  opacity: 0.6;
  transition: opacity var(--ease);
}
.subbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.hint-inline {
  font-size: 0.85rem;
  color: var(--muted);
}

.loading {
  color: var(--muted);
}

</style>
