<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { listAreas, type Area } from '@/api/areas';
import { listAssignments, type Assignment } from '@/api/assignments';
import { errorMessage } from '@/api/http';
import { listPaymentRequests, REQUEST_STATUS_LABELS, type PaymentRequestSummary } from '@/api/payment-requests';
import { listFunds, monthLabel, type PettyCashFund } from '@/api/petty-cash';
import { listProjects, SCOPE_LABELS, type Project } from '@/api/projects';
import { getBalances, type BalanceRow, type BalanceTotals } from '@/api/reports';
import AppIcon from '@/components/AppIcon.vue';
import ReportSummary from '@/components/reports/ReportSummary.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatDate, formatDateTime, formatRange } from '@/lib/dates';
import { formatUsd } from '@/lib/money';
import { activeTone, REQUEST_STATUS_TONES, type Tone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();

const canReport = computed(() => auth.can(PERMISSIONS.REPORTS_READ));
const canSeePayroll = computed(() => auth.can(PERMISSIONS.PAYROLL_READ));
const canSeePettyCash = computed(() => auth.can(PERMISSIONS.PETTY_CASH_READ));

// Fecha local en formato AAAA-MM-DD, para comparar con las fechas de la API.
const today = new Date().toLocaleDateString('sv-SE');

const project = ref<Project | null>(null);
const area = ref<Area | null>(null);
const assignments = ref<Assignment[]>([]);
const balanceRows = ref<BalanceRow[]>([]);
const totals = ref<BalanceTotals | null>(null);
const requests = ref<PaymentRequestSummary[]>([]);
const funds = ref<PettyCashFund[]>([]);
const loading = ref(true);
const error = ref('');

const projectId = computed(() => Number(route.params.projectId));

// Vigencia en palabras: cuánto falta, si está en curso o si ya terminó.
const vigency = computed<{ label: string; tone: Tone; detail: string } | null>(() => {
  const p = project.value;
  if (!p) return null;
  if (p.startDate > today) return { label: 'Por iniciar', tone: 'info', detail: `Empieza el ${formatDate(p.startDate)}` };
  if (p.endDate < today) return { label: 'Finalizado', tone: 'neutral', detail: `Terminó el ${formatDate(p.endDate)}` };
  const days = Math.round((Date.parse(p.endDate) - Date.parse(today)) / 86_400_000);
  return {
    label: 'En curso',
    tone: 'success',
    detail: days === 0 ? 'Termina hoy' : `Quedan ${days} ${days === 1 ? 'día' : 'días'} (hasta el ${formatDate(p.endDate)})`,
  };
});

function assignmentStatus(assignment: Assignment): { label: string; tone: Tone } {
  if (assignment.annulledAt) return { label: 'Anulada', tone: 'danger' };
  if (assignment.startDate > today) return { label: 'Futura', tone: 'info' };
  if (assignment.effectiveEndDate < today) return { label: 'Finalizada', tone: 'neutral' };
  return { label: 'Vigente', tone: 'success' };
}

const openAssignments = computed(() => assignments.value.filter((a) => !a.annulledAt && a.effectiveEndDate >= today).length);
const assignmentsNote = computed(() => {
  const annulled = assignments.value.filter((a) => a.annulledAt).length;
  const total = `${assignments.value.length - annulled} en total`;
  return annulled ? `${total} · ${annulled} ${annulled === 1 ? 'anulada' : 'anuladas'}` : total;
});
const openRequests = computed(() => requests.value.filter((r) => ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(r.status)));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [projects, areas] = await Promise.all([listProjects(), listAreas()]);
    project.value = projects.find((p) => p.id === projectId.value) ?? null;
    if (!project.value) {
      error.value = 'El proyecto no existe.';
      return;
    }
    area.value = areas.find((a) => a.id === project.value!.area.id) ?? null;

    const [loadedAssignments, balances, loadedRequests, loadedFunds] = await Promise.all([
      listAssignments({ projectId: projectId.value }),
      canReport.value ? getBalances('person', { projectId: projectId.value }) : null,
      canSeePayroll.value ? listPaymentRequests({ projectId: projectId.value }) : [],
      canSeePettyCash.value ? listFunds() : [],
    ]);
    assignments.value = loadedAssignments;
    balanceRows.value = balances?.rows ?? [];
    totals.value = balances?.totals ?? null;
    requests.value = loadedRequests;
    funds.value = loadedFunds.filter((fund) => fund.project.id === projectId.value);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

watch(projectId, () => void load(), { immediate: true });
</script>

<template>
  <nav aria-label="Ruta">
    <ol class="crumbs">
      <li>
        <RouterLink :to="{ name: 'projects' }"><AppIcon name="back" :size="14" /> Proyectos</RouterLink>
      </li>
      <li><span aria-current="page">{{ project?.code ?? '…' }}</span></li>
    </ol>
  </nav>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading && !project">Cargando…</p>
  <template v-else-if="project">
    <div class="detail-head">
      <div>
        <h1>
          {{ project.code }} · {{ project.name }}
          <StatusBadge v-if="vigency" :label="vigency.label" :tone="vigency.tone" />
          <StatusBadge v-if="!project.active" label="Inactivo" :tone="activeTone(false)" />
        </h1>
        <p class="hint">{{ project.area.name }} · {{ SCOPE_LABELS[project.scope] }} · {{ vigency?.detail }}</p>
      </div>
      <RouterLink
        v-if="canReport"
        class="button"
        :to="{ name: 'report-project', params: { projectId: project.id } }"
      >
        <AppIcon name="chart" :size="16" /> Ver en Reportes
      </RouterLink>
    </div>

    <section class="card project-facts">
      <dl>
        <div>
          <dt>Área</dt>
          <dd>
            {{ project.area.name }}
            <span v-if="area?.description" class="permission-code">{{ area.description }}</span>
          </dd>
        </div>
        <div>
          <dt>Ámbito</dt>
          <dd>{{ SCOPE_LABELS[project.scope] }}</dd>
        </div>
        <div>
          <dt>Vigencia</dt>
          <dd>{{ formatRange(project.startDate, project.endDate) }}</dd>
        </div>
        <div>
          <dt>Asignaciones</dt>
          <dd>
            {{ openAssignments }} vigentes o futuras
            <span class="permission-code">{{ assignmentsNote }}</span>
          </dd>
        </div>
        <div v-if="canSeePayroll">
          <dt>Solicitudes abiertas</dt>
          <dd>{{ openRequests.length }}</dd>
        </div>
      </dl>
    </section>

    <template v-if="totals">
      <h2 class="section-title">Saldos del proyecto</h2>
      <ReportSummary v-bind="totals" />
    </template>

    <section class="card section-gap">
      <div class="page-header">
        <h2>Personas y asignaciones</h2>
        <RouterLink :to="{ name: 'assignments', query: { projectId: project.id } }" class="button">Ir a Asignaciones</RouterLink>
      </div>
      <p v-if="assignments.length === 0" class="hint">El proyecto todavía no tiene asignaciones.</p>
      <div v-else class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col">Grupo de pago</th>
              <th scope="col" class="num">Monto por período</th>
              <th scope="col">Desde</th>
              <th scope="col">Hasta</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="assignment in assignments" :key="assignment.id">
              <td>
                {{ assignment.person.name }}
                <span class="permission-code">{{ assignment.person.idNumber }}</span>
              </td>
              <td>{{ assignment.paymentGroup.name }}</td>
              <td class="num">{{ formatUsd(assignment.amountCents) }}</td>
              <td class="nowrap">{{ formatDate(assignment.startDate) }}</td>
              <td class="nowrap">
                {{ formatDate(assignment.effectiveEndDate) }}
                <span v-if="assignment.endDate === null" class="permission-code">fin del proyecto</span>
              </td>
              <td>
                <StatusBadge :label="assignmentStatus(assignment).label" :tone="assignmentStatus(assignment).tone" />
                <span v-if="assignment.annulmentReason" class="permission-code">{{ assignment.annulmentReason }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="canReport" class="card section-gap">
      <h2>Saldo por persona</h2>
      <p v-if="balanceRows.length === 0" class="hint">Todavía no se ha causado nada en este proyecto.</p>
      <div v-else class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col" class="num">Causado</th>
              <th scope="col" class="num">Pagado</th>
              <th scope="col" class="num">Adeudado</th>
              <th scope="col"><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in balanceRows" :key="row.person?.id">
              <td>{{ row.person?.name }}</td>
              <td class="num">{{ formatUsd(row.accruedCents) }}</td>
              <td class="num">{{ formatUsd(row.paidCents) }}</td>
              <td class="num">
                <strong v-if="row.owedCents > 0">{{ formatUsd(row.owedCents) }}</strong>
                <span v-else class="hint">{{ formatUsd(0) }}</span>
              </td>
              <td>
                <RouterLink
                  v-if="row.person"
                  class="button"
                  :to="{ name: 'report-person', params: { personId: row.person.id } }"
                >
                  Estado de cuenta
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="canSeePayroll" class="card section-gap">
      <div class="page-header">
        <h2>Solicitudes de pago</h2>
        <RouterLink :to="{ name: 'payment-requests', query: { estado: 'all' } }" class="button">Ir a Solicitudes</RouterLink>
      </div>
      <p v-if="requests.length === 0" class="hint">El proyecto no tiene solicitudes de pago.</p>
      <div v-else class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Solicitud</th>
              <th scope="col">Estado</th>
              <th scope="col">Personas</th>
              <th scope="col" class="num">Solicitado</th>
              <th scope="col" class="num">Pagado</th>
              <th scope="col" class="num">Pendiente</th>
              <th scope="col">Creada</th>
              <th scope="col"><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="request in requests" :key="request.id">
              <td class="nowrap">#{{ request.id }}</td>
              <td><StatusBadge :label="REQUEST_STATUS_LABELS[request.status]" :tone="REQUEST_STATUS_TONES[request.status]" /></td>
              <td>{{ request.personCount }}</td>
              <td class="num">{{ formatUsd(request.requestedCents) }}</td>
              <td class="num">{{ formatUsd(request.paidCents) }}</td>
              <td class="num">{{ formatUsd(request.outstandingCents) }}</td>
              <td class="nowrap">{{ formatDateTime(request.createdAt) }}</td>
              <td>
                <RouterLink class="button" :to="{ name: 'payment-requests', query: { id: request.id } }">Ver</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="canSeePettyCash" class="card section-gap">
      <h2>Cajas chicas</h2>
      <p v-if="funds.length === 0" class="hint">El proyecto no tiene cajas chicas.</p>
      <div v-else class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Caja</th>
              <th scope="col">Mes abierto</th>
              <th scope="col" class="num">Disponible</th>
              <th scope="col">Estado</th>
              <th scope="col"><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="fund in funds" :key="fund.id">
              <td>{{ fund.name }}</td>
              <td>{{ fund.openPeriod ? monthLabel(fund.openPeriod) : 'Ninguno' }}</td>
              <td class="num">{{ fund.openPeriod ? formatUsd(fund.openPeriod.availableCents) : '' }}</td>
              <td><StatusBadge :label="fund.active ? 'Activa' : 'Inactiva'" :tone="activeTone(fund.active)" /></td>
              <td>
                <RouterLink class="button" :to="{ name: 'petty-cash', query: { fund: fund.id } }">Ver</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>
