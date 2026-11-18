<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { listAccruals, ACCRUAL_STATUS_LABELS, type AccrualPage } from '@/api/accruals';
import { listAssignments, type Assignment } from '@/api/assignments';
import { errorMessage } from '@/api/http';
import {
  listPaymentRequests,
  listPayments,
  REQUEST_STATUS_LABELS,
  type Payment,
  type PaymentRequestSummary,
} from '@/api/payment-requests';
import { listFunds, type PettyCashFund } from '@/api/petty-cash';
import { getProject, SCOPE_LABELS, type Project } from '@/api/projects';
import AppIcon from '@/components/AppIcon.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatDate, formatDateTime, formatRange } from '@/lib/dates';
import { formatUsd } from '@/lib/money';
import { ACCRUAL_STATUS_TONES, activeTone, REQUEST_STATUS_TONES } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ id: number }>();

const auth = useAuthStore();
const route = useRoute();
const canPayroll = computed(() => auth.can(PERMISSIONS.PAYROLL_READ));
const canPettyCash = computed(() => auth.can(PERMISSIONS.PETTY_CASH_READ));

const project = ref<Project | null>(null);
const assignments = ref<Assignment[]>([]);
const accruals = ref<AccrualPage | null>(null);
const requests = ref<PaymentRequestSummary[]>([]);
const payments = ref<Payment[]>([]);
const funds = ref<PettyCashFund[]>([]);
const loading = ref(true);
const error = ref('');
// Un bloque que falla no tumba la página: se avisa solo en su sección.
const sectionErrors = ref<Record<string, string>>({});

const listQuery = computed(() => {
  const { id: _id, ...rest } = route.query;
  return rest;
});

const openAssignments = computed(() => assignments.value.filter((a) => !a.endDate || a.endDate >= today));
const today = new Date().toLocaleDateString('sv-SE');
const activePayments = computed(() => payments.value.filter((p) => !p.annulledAt));
const totalPaid = computed(() => activePayments.value.reduce((sum, p) => sum + p.amountCents, 0));
const monthlyCommitment = computed(() => openAssignments.value.reduce((sum, a) => sum + a.amountCents, 0));
const peopleCount = computed(() => new Set(assignments.value.map((a) => a.person.id)).size);
const openRequests = computed(() => requests.value.filter((r) => ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(r.status)));

// Cada bloque se pide aparte y solo si el usuario tiene permiso para verlo.
let loadSeq = 0;
async function load(id: number) {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  sectionErrors.value = {};
  project.value = null;
  try {
    const loaded = await getProject(id);
    if (seq !== loadSeq) return;
    project.value = loaded;
  } catch (e) {
    if (seq === loadSeq) {
      error.value = errorMessage(e);
      loading.value = false;
    }
    return;
  }

  const tasks: [string, () => Promise<void>][] = [
    ['assignments', async () => void (assignments.value = await listAssignments({ projectId: id }))],
  ];
  if (canPayroll.value) {
    tasks.push(
      ['accruals', async () => void (accruals.value = await listAccruals({ projectId: id, pageSize: 200 }))],
      ['requests', async () => void (requests.value = await listPaymentRequests({ projectId: id }))],
      ['payments', async () => void (payments.value = await listPayments({ projectId: id }))],
    );
  }
  if (canPettyCash.value) {
    tasks.push(['funds', async () => void (funds.value = (await listFunds()).filter((f) => f.project.id === id))]);
  }
  const results = await Promise.allSettled(tasks.map(([, run]) => run()));
  if (seq !== loadSeq) return;
  results.forEach((result, index) => {
    if (result.status === 'rejected') sectionErrors.value[tasks[index][0]] = errorMessage(result.reason);
  });
  loading.value = false;
}

watch(() => props.id, (id) => void load(id), { immediate: true });
</script>

<template>
  <nav aria-label="Ruta">
    <ol class="crumbs">
      <li>
        <RouterLink :to="{ name: 'projects', query: listQuery }"><AppIcon name="back" :size="14" /> Proyectos</RouterLink>
      </li>
      <li><span aria-current="page">{{ project?.code ?? `#${id}` }}</span></li>
    </ol>
  </nav>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading && !project">Cargando…</p>

  <template v-else-if="project">
    <div class="detail-head">
      <div>
        <h1>
          {{ project.code }} · {{ project.name }}
          <StatusBadge :label="project.active ? 'Activo' : 'Inactivo'" :tone="activeTone(project.active)" />
        </h1>
        <p class="hint">
          {{ project.area.name }} · {{ SCOPE_LABELS[project.scope] }} · vigencia
          {{ formatRange(project.startDate, project.endDate) }}
        </p>
      </div>
    </div>

    <section class="card" aria-label="Resumen">
      <dl class="summary-grid">
        <div>
          <dt>Personas asignadas</dt>
          <dd>{{ peopleCount }}</dd>
        </div>
        <div>
          <dt>Asignaciones vigentes</dt>
          <dd>{{ openAssignments.length }} <span class="hint">de {{ project.assignmentCount }}</span></dd>
        </div>
        <div>
          <dt>Compromiso por período</dt>
          <dd>{{ formatUsd(monthlyCommitment) }}</dd>
        </div>
        <template v-if="canPayroll">
          <div>
            <dt>Causado</dt>
            <dd>{{ accruals ? formatUsd(accruals.totals.amountCents) : '—' }}</dd>
          </div>
          <div>
            <dt>Pagado</dt>
            <dd>{{ accruals ? formatUsd(accruals.totals.paidCents) : '—' }}</dd>
          </div>
          <div>
            <dt>Deuda pendiente</dt>
            <dd>{{ accruals ? formatUsd(accruals.totals.pendingCents) : '—' }}</dd>
          </div>
          <div>
            <dt>Solicitudes abiertas</dt>
            <dd>{{ openRequests.length }}</dd>
          </div>
        </template>
      </dl>
    </section>

    <section class="card">
      <div class="page-header">
        <h2>Asignaciones</h2>
        <RouterLink class="button" :to="{ name: 'assignments', query: { projectId: project.id } }">Gestionar</RouterLink>
      </div>
      <p v-if="sectionErrors.assignments" class="error" role="alert">{{ sectionErrors.assignments }}</p>
      <div v-else class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col">Grupo de pago</th>
              <th scope="col" class="num">Monto</th>
              <th scope="col">Vigencia</th>
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
              <td class="nowrap">{{ formatRange(assignment.startDate, assignment.effectiveEndDate) }}</td>
            </tr>
            <tr v-if="assignments.length === 0">
              <td colspan="4">El proyecto no tiene asignaciones.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <template v-if="canPayroll">
      <section class="card">
        <div class="page-header">
          <h2>Solicitudes de pago</h2>
        </div>
        <p v-if="sectionErrors.requests" class="error" role="alert">{{ sectionErrors.requests }}</p>
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
              </tr>
            </thead>
            <tbody>
              <tr v-for="request in requests" :key="request.id">
                <td class="nowrap">
                  <RouterLink :to="{ name: 'payment-requests', query: { id: request.id } }">#{{ request.id }}</RouterLink>
                </td>
                <td><StatusBadge :label="REQUEST_STATUS_LABELS[request.status]" :tone="REQUEST_STATUS_TONES[request.status]" /></td>
                <td>{{ request.personCount }}</td>
                <td class="num">{{ formatUsd(request.requestedCents) }}</td>
                <td class="num">{{ formatUsd(request.paidCents) }}</td>
                <td class="num">{{ formatUsd(request.outstandingCents) }}</td>
                <td>
                  {{ request.createdBy?.name }}
                  <span class="permission-code">{{ formatDateTime(request.createdAt) }}</span>
                </td>
              </tr>
              <tr v-if="requests.length === 0">
                <td colspan="7">Todavía no hay solicitudes de pago.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>Pagos (recibos)</h2>
        <p v-if="sectionErrors.payments" class="error" role="alert">{{ sectionErrors.payments }}</p>
        <template v-else>
          <p class="hint">{{ activePayments.length }} vigentes · {{ formatUsd(totalPaid) }} entregados</p>
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
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="payment in payments" :key="payment.id">
                  <td class="nowrap">#{{ payment.id }}</td>
                  <td class="nowrap">
                    <RouterLink :to="{ name: 'payment-requests', query: { id: payment.requestId } }">#{{ payment.requestId }}</RouterLink>
                  </td>
                  <td>{{ payment.person.name }}</td>
                  <td class="nowrap">{{ formatDate(payment.paidOn) }}</td>
                  <td class="num">{{ formatUsd(payment.amountCents) }}</td>
                  <td>{{ payment.reference }}</td>
                  <td>
                    <StatusBadge :label="payment.annulledAt ? 'Anulado' : 'Vigente'" :tone="payment.annulledAt ? 'danger' : 'success'" />
                  </td>
                </tr>
                <tr v-if="payments.length === 0">
                  <td colspan="7">Todavía no hay pagos.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>

      <details class="card fold">
        <summary>
          <AppIcon name="chevron" />
          Causaciones
          <span class="hint">{{ accruals?.total ?? 0 }} en total</span>
        </summary>
        <p v-if="sectionErrors.accruals" class="error" role="alert">{{ sectionErrors.accruals }}</p>
        <div v-else-if="accruals" class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Período</th>
                <th scope="col">Días</th>
                <th scope="col" class="num">Causado</th>
                <th scope="col" class="num">Pagado</th>
                <th scope="col" class="num">Pendiente</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="accrual in accruals.accruals" :key="accrual.id">
                <td>{{ accrual.person.name }}</td>
                <td class="nowrap">{{ formatRange(accrual.period.startDate, accrual.period.endDate) }}</td>
                <td class="nowrap">{{ accrual.activeDays }} / {{ accrual.periodDays }}</td>
                <td class="num">{{ formatUsd(accrual.amountCents) }}</td>
                <td class="num">{{ formatUsd(accrual.paidCents) }}</td>
                <td class="num">{{ formatUsd(accrual.pendingCents) }}</td>
                <td><StatusBadge :label="ACCRUAL_STATUS_LABELS[accrual.status]" :tone="ACCRUAL_STATUS_TONES[accrual.status]" /></td>
              </tr>
              <tr v-if="accruals.accruals.length === 0">
                <td colspan="7">Todavía no hay causaciones.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="accruals && accruals.pageCount > 1" class="hint">
          Se muestran las primeras {{ accruals.accruals.length }} de {{ accruals.total }}. Consulta la lista completa en
          <RouterLink :to="{ name: 'accruals', query: { projectId: project.id } }">Causación</RouterLink>.
        </p>
      </details>
    </template>

    <section v-if="canPettyCash" class="card">
      <div class="page-header">
        <h2>Cajas chicas</h2>
        <RouterLink class="button" :to="{ name: 'petty-cash' }">Ver cajas chicas</RouterLink>
      </div>
      <p v-if="sectionErrors.funds" class="error" role="alert">{{ sectionErrors.funds }}</p>
      <div v-else class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Caja</th>
              <th scope="col">Estado</th>
              <th scope="col">Período abierto</th>
              <th scope="col" class="num">Disponible</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="fund in funds" :key="fund.id">
              <td>{{ fund.name }}</td>
              <td><StatusBadge :label="fund.active ? 'Activa' : 'Inactiva'" :tone="activeTone(fund.active)" /></td>
              <td>{{ fund.openPeriod ? `${String(fund.openPeriod.month).padStart(2, '0')}/${fund.openPeriod.year}` : 'Sin período abierto' }}</td>
              <td class="num">{{ fund.openPeriod ? formatUsd(fund.openPeriod.availableCents) : '—' }}</td>
            </tr>
            <tr v-if="funds.length === 0">
              <td colspan="4">El proyecto no tiene cajas chicas.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped>
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
  margin: 0;
}

.summary-grid dt {
  color: var(--muted);
  font-size: 0.8125rem;
}

.summary-grid dd {
  margin: 0.15rem 0 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.summary-grid dd .hint {
  font-size: 0.8125rem;
  font-weight: 400;
}
</style>
