<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ACCRUAL_STATUS_LABELS } from '@/api/accruals';
import { errorMessage } from '@/api/http';
import { listProjects, type Project } from '@/api/projects';
import { getPersonStatement, paymentRequestPdfUrl, receiptPdfUrl, type PersonStatement } from '@/api/reports';
import AppIcon from '@/components/AppIcon.vue';
import ReportSummary from '@/components/reports/ReportSummary.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatDate, formatRange } from '@/lib/dates';
import { formatUsd } from '@/lib/money';
import { ACCRUAL_STATUS_TONES } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

// Estado de cuenta completo de una persona. Vive en /reportes?personaId=N; el proyecto y el rango de
// fechas también van en la URL (?projectId, ?from, ?to), así el enlace se comparte tal cual.
const props = defineProps<{ id: number }>();

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const canProjects = computed(() => auth.can(PERMISSIONS.PROJECTS_READ));

const statement = ref<PersonStatement | null>(null);
const projects = ref<Project[]>([]);
const loading = ref(true);
const error = ref('');

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const projectId = computed(() => {
  const id = Number(route.query.projectId);
  return Number.isInteger(id) && id > 0 ? id : 0;
});
const from = computed(() => text(route.query.from));
const to = computed(() => text(route.query.to));
const hasFilters = computed(() => projectId.value > 0 || Boolean(from.value) || Boolean(to.value));

const backQuery = computed(() => {
  const { personaId: _id, ...rest } = route.query;
  return rest;
});

function setFilter(key: 'projectId' | 'from' | 'to', value: string | number) {
  const query = { ...route.query };
  if (value) query[key] = String(value);
  else delete query[key];
  void router.replace({ query });
}

function clearFilters() {
  const { projectId: _p, from: _f, to: _t, ...rest } = route.query;
  void router.replace({ query: rest });
}

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const result = await getPersonStatement(props.id, {
      projectId: projectId.value || undefined,
      from: from.value || undefined,
      to: to.value || undefined,
    });
    if (seq === loadSeq) statement.value = result;
  } catch (e) {
    if (seq === loadSeq) {
      error.value = errorMessage(e);
      statement.value = null;
    }
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(() => [props.id, projectId.value, from.value, to.value], load, { immediate: true });
watch(
  canProjects,
  async (allowed) => {
    if (allowed && projects.value.length === 0) projects.value = await listProjects().catch(() => []);
  },
  { immediate: true },
);

const totals = computed(() => statement.value?.totals ?? { accruedCents: 0, paidCents: 0, owedCents: 0, accrualCount: 0 });
const activePayments = computed(() => statement.value?.payments.filter((p) => !p.annulledAt) ?? []);
const annulledPayments = computed(() => statement.value?.payments.filter((p) => p.annulledAt) ?? []);
const receivedCents = computed(() => activePayments.value.reduce((sum, p) => sum + p.amountCents, 0));

type Group = { key: string; label: string; sub: string; count: number; accrued: number; paid: number; owed: number };

function group(keyOf: (a: PersonStatement['accruals'][number]) => { key: string; label: string; sub: string }) {
  const map = new Map<string, Group>();
  for (const a of statement.value?.accruals ?? []) {
    if (a.status === 'ANNULLED') continue;
    const { key, label, sub } = keyOf(a);
    const row = map.get(key) ?? { key, label, sub, count: 0, accrued: 0, paid: 0, owed: 0 };
    row.count += 1;
    row.accrued += a.amountCents;
    row.paid += a.paidCents;
    row.owed += a.owedCents;
    map.set(key, row);
  }
  return [...map.values()];
}

const byProject = computed(() =>
  group((a) => ({ key: String(a.project.id), label: a.project.code, sub: a.project.name })).sort((x, y) => y.owed - x.owed),
);
const byMonth = computed(() =>
  group((a) => {
    const month = a.period.endDate.slice(0, 7);
    return { key: month, label: `${month.slice(5)}/${month.slice(0, 4)}`, sub: '' };
  }).sort((x, y) => (x.key < y.key ? 1 : -1)),
);

const pct = (paid: number, accrued: number) => (accrued > 0 ? `${Math.round(Math.min(100, (paid / accrued) * 100))}%` : '—');
</script>

<template>
  <div class="page">
    <nav aria-label="Ruta">
      <ol class="crumbs">
        <li>
          <RouterLink :to="{ name: 'reports', query: backQuery }"><AppIcon name="back" :size="14" /> Reportes</RouterLink>
        </li>
        <li><span aria-current="page">{{ statement?.person.name ?? `Persona #${id}` }}</span></li>
      </ol>
    </nav>

    <div class="detail-head">
      <div>
        <h1>
          {{ statement?.person.name ?? 'Estado de cuenta' }}
          <StatusBadge
            v-if="statement"
            :label="statement.person.active ? 'Activa' : 'Inactiva'"
            :tone="statement.person.active ? 'success' : 'neutral'"
          />
        </h1>
        <p v-if="statement" class="hint">
          Estado de cuenta · {{ statement.person.idNumber }}
          <template v-if="canProjects">
            · <RouterLink :to="{ name: 'people', query: { id: statement.person.id } }">Ver ficha de la persona</RouterLink>
          </template>
        </p>
      </div>
    </div>

    <section class="card filters" aria-label="Filtros">
      <label class="f">
        <span>Proyecto</span>
        <select :value="projectId" :disabled="!canProjects" @change="setFilter('projectId', Number(($event.target as HTMLSelectElement).value))">
          <option :value="0">Todos</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
        </select>
      </label>
      <label class="f">
        <span>Desde</span>
        <input type="date" :value="from" @change="setFilter('from', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="f">
        <span>Hasta</span>
        <input type="date" :value="to" :min="from" @change="setFilter('to', ($event.target as HTMLInputElement).value)" />
      </label>
      <button v-if="hasFilters" type="button" class="link" @click="clearFilters">Limpiar filtros</button>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="loading && !statement">Cargando…</p>

    <template v-else-if="statement">
      <ReportSummary v-bind="totals" :class="{ stale: loading }" />

      <div class="two-col">
        <section class="card">
          <h2>Por proyecto</h2>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th scope="col">Proyecto</th>
                  <th scope="col" class="num">Le tocaba</th>
                  <th scope="col" class="num">Pagado</th>
                  <th scope="col" class="num">Debe</th>
                  <th scope="col" class="num">% pagado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in byProject" :key="row.key">
                  <td>
                    <RouterLink v-if="canProjects" :to="{ name: 'projects', query: { id: row.key } }">{{ row.label }}</RouterLink>
                    <template v-else>{{ row.label }}</template>
                    <span class="permission-code">{{ row.sub }}</span>
                  </td>
                  <td class="num">{{ formatUsd(row.accrued) }}</td>
                  <td class="num">{{ formatUsd(row.paid) }}</td>
                  <td class="num" :class="{ owed: row.owed > 0 }">{{ formatUsd(row.owed) }}</td>
                  <td class="num">{{ pct(row.paid, row.accrued) }}</td>
                </tr>
                <tr v-if="byProject.length === 0">
                  <td colspan="5">No hay nada calculado en estas fechas.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <h2>Por mes</h2>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th scope="col">Mes (fin del período)</th>
                  <th scope="col" class="num">Le tocaba</th>
                  <th scope="col" class="num">Pagado</th>
                  <th scope="col" class="num">Debe</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in byMonth" :key="row.key">
                  <td class="nowrap">{{ row.label }}</td>
                  <td class="num">{{ formatUsd(row.accrued) }}</td>
                  <td class="num">{{ formatUsd(row.paid) }}</td>
                  <td class="num" :class="{ owed: row.owed > 0 }">{{ formatUsd(row.owed) }}</td>
                </tr>
                <tr v-if="byMonth.length === 0">
                  <td colspan="4">No hay nada calculado en estas fechas.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section class="card">
        <h2>Detalle de cada cálculo <span class="hint">{{ statement.accruals.length }}</span></h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col">Cálculo</th>
                <th scope="col">Proyecto</th>
                <th scope="col">Grupo de pago</th>
                <th scope="col">Período</th>
                <th scope="col">Días</th>
                <th scope="col" class="num">Le tocaba</th>
                <th scope="col" class="num">Pagado</th>
                <th scope="col" class="num">Debe</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in statement.accruals" :key="a.id">
                <td class="nowrap">#{{ a.id }}</td>
                <td class="nowrap" :title="a.project.name">{{ a.project.code }}</td>
                <td>{{ a.period.paymentGroup.name }}</td>
                <td class="nowrap">{{ formatRange(a.period.startDate, a.period.endDate) }}</td>
                <td class="nowrap">{{ a.activeDays }} / {{ a.periodDays }}</td>
                <td class="num">{{ formatUsd(a.amountCents) }}</td>
                <td class="num">{{ formatUsd(a.paidCents) }}</td>
                <td class="num" :class="{ owed: a.owedCents > 0 }">{{ formatUsd(a.owedCents) }}</td>
                <td><StatusBadge :label="ACCRUAL_STATUS_LABELS[a.status]" :tone="ACCRUAL_STATUS_TONES[a.status]" /></td>
              </tr>
              <tr v-if="statement.accruals.length === 0">
                <td colspan="9">No hay nada calculado en estas fechas.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>Pagos <span class="hint">{{ statement.payments.length }}</span></h2>
        <p class="hint">
          {{ activePayments.length }} vigentes · {{ formatUsd(receivedCents) }} recibidos
          <template v-if="annulledPayments.length"> · {{ annulledPayments.length }} anulados</template>
        </p>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col">Recibo</th>
                <th scope="col">Solicitud</th>
                <th scope="col">Proyecto</th>
                <th scope="col">Fecha</th>
                <th scope="col" class="num">Monto</th>
                <th scope="col">Referencia</th>
                <th scope="col">Registrado por</th>
                <th scope="col">Estado</th>
                <th scope="col"><span class="sr-only">Documentos</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in statement.payments" :key="p.id" :class="{ annulled: p.annulledAt }">
                <td class="nowrap">#{{ p.id }}</td>
                <td class="nowrap">
                  <RouterLink :to="{ name: 'payment-requests', query: { id: p.requestId } }">#{{ p.requestId }}</RouterLink>
                </td>
                <td class="nowrap" :title="p.project.name">{{ p.project.code }}</td>
                <td class="nowrap">{{ formatDate(p.paidOn) }}</td>
                <td class="num">{{ formatUsd(p.amountCents) }}</td>
                <td>{{ p.reference }}</td>
                <td>{{ p.createdBy?.name }}</td>
                <td>
                  <StatusBadge :label="p.annulledAt ? 'Anulado' : 'Vigente'" :tone="p.annulledAt ? 'danger' : 'success'" />
                  <span v-if="p.annulledAt" class="permission-code">
                    {{ formatDate(p.annulledAt) }}<template v-if="p.annulledBy"> · {{ p.annulledBy.name }}</template>
                    <template v-if="p.annulmentReason"> · {{ p.annulmentReason }}</template>
                  </span>
                </td>
                <td class="docs">
                  <a class="button" :href="receiptPdfUrl(p.id)" target="_blank" rel="noopener">Recibo PDF</a>
                  <a class="button" :href="paymentRequestPdfUrl(p.requestId)" target="_blank" rel="noopener">Solicitud PDF</a>
                </td>
              </tr>
              <tr v-if="statement.payments.length === 0">
                <td colspan="9">Sin pagos en este rango.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.page :deep(.card) {
  margin-bottom: 0;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}
.f {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.9375rem;
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
  font-size: 0.9375rem;
  padding: 0.45rem 0.25rem;
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
}
.stale {
  opacity: 0.6;
}
.two-col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-items: start;
}
.owed {
  color: var(--danger);
  font-weight: 600;
}
tr.annulled td {
  color: var(--muted);
}
.docs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
@media (max-width: 1000px) {
  .two-col {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
