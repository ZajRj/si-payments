<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import {
  getBalances,
  getPaymentsReport,
  paymentRequestPdfUrl,
  receiptPdfUrl,
  type BalanceRow,
  type PaymentsReport,
} from '@/api/reports';
import AppIcon from '@/components/AppIcon.vue';
import ReportSummary from '@/components/reports/ReportSummary.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatDate } from '@/lib/dates';
import { formatUsd } from '@/lib/money';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

// Reporte completo de un proyecto. Vive en /reportes?proyectoId=N; el rango de fechas también va
// en la URL (?from, ?to), así el enlace se comparte tal cual.
const props = defineProps<{ id: number }>();

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const canProjects = computed(() => auth.can(PERMISSIONS.PROJECTS_READ));

type Totals = { accruedCents: number; paidCents: number; owedCents: number; accrualCount: number };
const project = ref<NonNullable<BalanceRow['project']> | null>(null);
const totals = ref<Totals>({ accruedCents: 0, paidCents: 0, owedCents: 0, accrualCount: 0 });
const people = ref<BalanceRow[]>([]);
const payments = ref<PaymentsReport | null>(null);
const loading = ref(true);
const error = ref('');

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const from = computed(() => text(route.query.from));
const to = computed(() => text(route.query.to));
const hasFilters = computed(() => Boolean(from.value) || Boolean(to.value));

const backQuery = computed(() => {
  const { proyectoId: _id, ...rest } = route.query;
  return rest;
});

function setFilter(key: 'from' | 'to', value: string) {
  const query = { ...route.query };
  if (value) query[key] = value;
  else delete query[key];
  void router.replace({ query });
}

function clearFilters() {
  const { from: _f, to: _t, ...rest } = route.query;
  void router.replace({ query: rest });
}

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  const filters = { projectId: props.id, from: from.value || undefined, to: to.value || undefined };
  try {
    const [byProject, byPerson, ledger] = await Promise.all([
      getBalances('project', filters),
      getBalances('person', filters),
      getPaymentsReport(filters),
    ]);
    if (seq !== loadSeq) return;
    project.value = byProject.rows[0]?.project ?? project.value;
    totals.value = byPerson.totals;
    people.value = [...byPerson.rows].sort((a, b) => b.owedCents - a.owedCents);
    payments.value = ledger;
  } catch (e) {
    if (seq === loadSeq) error.value = errorMessage(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(() => [props.id, from.value, to.value], load, { immediate: true });

const activePayments = computed(() => payments.value?.payments.filter((p) => !p.annulledAt) ?? []);
const receivedCents = computed(() => activePayments.value.reduce((sum, p) => sum + p.amountCents, 0));

// Pagos agrupados por solicitud, para ver cuánto salió en cada una.
const byRequest = computed(() => {
  const map = new Map<number, { requestId: number; count: number; cents: number; last: string }>();
  for (const p of activePayments.value) {
    const row = map.get(p.requestId) ?? { requestId: p.requestId, count: 0, cents: 0, last: '' };
    row.count += 1;
    row.cents += p.amountCents;
    if (p.paidOn > row.last) row.last = p.paidOn;
    map.set(p.requestId, row);
  }
  return [...map.values()].sort((a, b) => b.requestId - a.requestId);
});

const pct = (paid: number, accrued: number) => (accrued > 0 ? `${Math.round(Math.min(100, (paid / accrued) * 100))}%` : '—');

function openPerson(personId: number) {
  void router.push({ name: 'reports', query: { personaId: personId, projectId: props.id, from: from.value || undefined, to: to.value || undefined } });
}
</script>

<template>
  <div class="page">
    <nav aria-label="Ruta">
      <ol class="crumbs">
        <li>
          <RouterLink :to="{ name: 'reports', query: backQuery }"><AppIcon name="back" :size="14" /> Reportes</RouterLink>
        </li>
        <li><span aria-current="page">{{ project?.code ?? `Proyecto #${id}` }}</span></li>
      </ol>
    </nav>

    <div class="detail-head">
      <div>
        <h1>{{ project ? `${project.code} · ${project.name}` : 'Reporte del proyecto' }}</h1>
        <p class="hint">
          Reporte del proyecto<template v-if="project"> · {{ project.area.name }}</template>
          <template v-if="canProjects"> · <RouterLink :to="{ name: 'projects', query: { id } }">Ver ficha del proyecto</RouterLink></template>
        </p>
      </div>
    </div>

    <section class="card filters" aria-label="Filtros">
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
    <p v-else-if="loading && !payments">Cargando…</p>

    <template v-else-if="payments">
      <ReportSummary v-bind="totals" :class="{ stale: loading }" />

      <section class="card">
        <h2>Personas <span class="hint">{{ people.length }}</span></h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col" class="num">Cálculos</th>
                <th scope="col" class="num">Calculado</th>
                <th scope="col" class="num">Pagado</th>
                <th scope="col" class="num">Debe</th>
                <th scope="col" class="num">% pagado</th>
                <th scope="col"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in people" :key="row.person?.id">
                <td>
                  {{ row.person?.name }}
                  <span class="permission-code">{{ row.person?.idNumber }}</span>
                </td>
                <td class="num">{{ row.accrualCount }}</td>
                <td class="num">{{ formatUsd(row.accruedCents) }}</td>
                <td class="num">{{ formatUsd(row.paidCents) }}</td>
                <td class="num" :class="{ owed: row.owedCents > 0 }">{{ formatUsd(row.owedCents) }}</td>
                <td class="num">{{ pct(row.paidCents, row.accruedCents) }}</td>
                <td>
                  <button v-if="row.person" type="button" class="button" @click="openPerson(row.person.id)">Estado de cuenta</button>
                </td>
              </tr>
              <tr v-if="people.length === 0">
                <td colspan="7">No hay nada calculado en estas fechas.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>Por solicitud de pago <span class="hint">{{ byRequest.length }}</span></h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col">Solicitud</th>
                <th scope="col" class="num">Pagos vigentes</th>
                <th scope="col" class="num">Entregado</th>
                <th scope="col">Último pago</th>
                <th scope="col"><span class="sr-only">Documentos</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in byRequest" :key="row.requestId">
                <td class="nowrap">
                  <RouterLink :to="{ name: 'payment-requests', query: { id: row.requestId } }">#{{ row.requestId }}</RouterLink>
                </td>
                <td class="num">{{ row.count }}</td>
                <td class="num">{{ formatUsd(row.cents) }}</td>
                <td class="nowrap">{{ formatDate(row.last) }}</td>
                <td>
                  <a class="button" :href="paymentRequestPdfUrl(row.requestId)" target="_blank" rel="noopener">Solicitud PDF</a>
                </td>
              </tr>
              <tr v-if="byRequest.length === 0">
                <td colspan="5">Sin pagos en este rango.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>Pagos entregados <span class="hint">{{ payments.payments.length }}</span></h2>
        <p class="hint">
          {{ activePayments.length }} vigentes · {{ formatUsd(receivedCents) }} entregados
          <template v-if="payments.totals.annulledCount"> · {{ payments.totals.annulledCount }} anulados</template>
        </p>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col">Recibo</th>
                <th scope="col">Solicitud</th>
                <th scope="col">Persona</th>
                <th scope="col">Fecha</th>
                <th scope="col" class="num">Monto</th>
                <th scope="col">Referencia</th>
                <th scope="col">Registrado por</th>
                <th scope="col">Estado</th>
                <th scope="col"><span class="sr-only">Documentos</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in payments.payments" :key="p.id" :class="{ annulled: p.annulledAt }">
                <td class="nowrap">#{{ p.id }}</td>
                <td class="nowrap">
                  <RouterLink :to="{ name: 'payment-requests', query: { id: p.requestId } }">#{{ p.requestId }}</RouterLink>
                </td>
                <td>{{ p.person.name }}</td>
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
                <td>
                  <a class="button" :href="receiptPdfUrl(p.id)" target="_blank" rel="noopener">Recibo PDF</a>
                </td>
              </tr>
              <tr v-if="payments.payments.length === 0">
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
.f input {
  font: inherit;
  font-weight: 400;
  min-width: 11rem;
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
.owed {
  color: var(--danger);
  font-weight: 600;
}
tr.annulled td {
  color: var(--muted);
}
</style>
