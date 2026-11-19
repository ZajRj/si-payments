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
  { value: 'all', label: 'Todas las fechas' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes pasado' },
  { value: 'year', label: 'Este año' },
  { value: 'custom', label: 'Elegir fechas' },
];

const route = useRoute();
const router = useRouter();

// La persona abierta a pantalla completa vive en la URL (?id=); la lista queda montada debajo,
// así al volver se conservan los filtros y la selección.
const positiveId = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
// Se acepta la dirección /reportes/personas/12 (la que usa la ficha de proyecto) y también ?personaId=12.
const personId = computed(() => positiveId(route.params.personId ?? route.query.personaId));
const projectDetailId = computed(() => positiveId(route.params.projectId ?? route.query.proyectoId));
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

// Las tres preguntas que se pueden hacer; cada una elige el tipo de reporte y cómo se agrupa.
type Question = 'person' | 'project' | 'payments';
const QUESTIONS: { value: Question; short: string; title: string; sub: string }[] = [
  { value: 'person', short: 'Deuda por persona', title: '¿Cuánto se le debe a cada persona?', sub: 'Una lista de personas con lo que se les debe. Elige una para ver su estado de cuenta.' },
  { value: 'project', short: 'Deuda por proyecto', title: '¿Cuánto falta pagar en cada proyecto?', sub: 'Una lista de proyectos con lo que se debe en cada uno.' },
  { value: 'payments', short: 'Pagos entregados', title: '¿Qué pagos ya se hicieron?', sub: 'Todas las entregas de dinero, con su fecha y su recibo.' },
];
const question = computed<Question>(() => (lens.value === 'payments' ? 'payments' : groupBy.value));
function setQuestion(value: Question) {
  if (value === 'payments') {
    lens.value = 'payments';
    return;
  }
  lens.value = 'balances';
  groupBy.value = value;
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
  <div v-show="!detailId">
    <div class="page-header">
      <h1>Reportes</h1>
    </div>
    <p class="hint">Aquí consultas cuánto se debe y cuánto ya se pagó. Primero elige qué quieres saber.</p>

    <div class="chips section-gap" role="group" aria-label="¿Qué quieres saber?">
      <button v-for="item in QUESTIONS" :key="item.value" type="button" class="chip" :aria-pressed="question === item.value" @click="setQuestion(item.value)">
        {{ item.short }}
      </button>
    </div>
    <p class="hint">{{ QUESTIONS.find((item) => item.value === question)?.sub }}</p>

    <section class="card" aria-label="Filtros">
      <div class="chips" role="group" aria-label="Fechas">
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
      <div class="form-row section-gap">
        <label v-if="preset === 'custom'" class="field">
          Desde
          <input v-model="filters.from" type="date" />
        </label>
        <label v-if="preset === 'custom'" class="field">
          Hasta
          <input v-model="filters.to" type="date" />
        </label>
        <label class="field">
          Proyecto
          <select v-model.number="filters.projectId">
            <option :value="0">Todos</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
          </select>
        </label>
        <label class="field">
          Área
          <select v-model.number="filters.areaId">
            <option :value="0">Todas</option>
            <option v-for="area in areas" :key="area.id" :value="area.id">{{ area.name }}</option>
          </select>
        </label>
      </div>
      <div class="actions section-gap">
        <button v-if="hasActiveFilters" type="button" class="button" @click="clearFilters">Quitar filtros</button>
        <details class="dates-help">
          <summary>¿Cómo se cuentan las fechas?</summary>
          <p class="hint">
            {{
              lens === 'payments'
                ? 'Las fechas se refieren al día en que se entregó el dinero.'
                : 'Cada cálculo se ubica según el día en que terminó su período. Lo pagado es lo que ya se entregó para ese cálculo, sin importar qué día se pagó.'
            }}
          </p>
        </details>
      </div>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <ReportSummary v-if="balances" v-bind="totals" :class="{ 'is-loading': loading }" />

    <template v-if="lens === 'balances'">
      <BalanceList v-if="balances" :rows="balances.rows" :group-by="groupBy" @select="selectRow" />
      <p v-else-if="loading" class="hint">Cargando…</p>
    </template>

    <template v-else>
      <PaymentsLedger v-if="payments" :report="payments" />
      <p v-else-if="loading" class="hint">Cargando…</p>
    </template>
  </div>
</template>

<style scoped>
.is-loading {
  opacity: 0.6;
  transition: opacity var(--ease);
}
</style>
