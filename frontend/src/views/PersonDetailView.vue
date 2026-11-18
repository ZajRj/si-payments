<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ACCRUAL_STATUS_LABELS, listAccruals, type AccrualPage } from '@/api/accruals';
import { listAssignments, type Assignment } from '@/api/assignments';
import { errorMessage } from '@/api/http';
import { getPerson, type Person } from '@/api/people';
import { listPayments, type Payment } from '@/api/payment-requests';
import { receiptPdfUrl } from '@/api/reports';
import AppIcon from '@/components/AppIcon.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatDate, formatRange } from '@/lib/dates';
import { formatUsd } from '@/lib/money';
import { ACCRUAL_STATUS_TONES, activeTone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ id: number }>();

const auth = useAuthStore();
const route = useRoute();
const canPayroll = computed(() => auth.can(PERMISSIONS.PAYROLL_READ));
const canProjects = computed(() => auth.can(PERMISSIONS.PROJECTS_READ));
const canReport = computed(() => auth.can(PERMISSIONS.REPORTS_READ));

const person = ref<Person | null>(null);
const assignments = ref<Assignment[]>([]);
const accruals = ref<AccrualPage | null>(null);
const payments = ref<Payment[]>([]);
const loading = ref(true);
const error = ref('');
const sectionErrors = ref<Record<string, string>>({});

const listQuery = computed(() => {
  const { id: _id, ...rest } = route.query;
  return rest;
});

const today = new Date().toLocaleDateString('sv-SE');
const openAssignments = computed(() => assignments.value.filter((a) => a.effectiveEndDate >= today));
const activePayments = computed(() => payments.value.filter((p) => !p.annulledAt));
const totalPaid = computed(() => activePayments.value.reduce((sum, p) => sum + p.amountCents, 0));
const currentCommitment = computed(() => openAssignments.value.reduce((sum, a) => sum + a.amountCents, 0));

let loadSeq = 0;
async function load(id: number) {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  sectionErrors.value = {};
  person.value = null;
  try {
    const loaded = await getPerson(id);
    if (seq !== loadSeq) return;
    person.value = loaded;
  } catch (e) {
    if (seq === loadSeq) {
      error.value = errorMessage(e);
      loading.value = false;
    }
    return;
  }

  const tasks: [string, () => Promise<void>][] = [];
  if (canProjects.value) {
    tasks.push(['assignments', async () => void (assignments.value = await listAssignments({ personId: id }))]);
  }
  if (canPayroll.value) {
    tasks.push(
      ['accruals', async () => void (accruals.value = await listAccruals({ personId: id, pageSize: 200 }))],
      ['payments', async () => void (payments.value = await listPayments({ personId: id }))],
    );
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
        <RouterLink :to="{ name: 'people', query: listQuery }"><AppIcon name="back" :size="14" /> Personas</RouterLink>
      </li>
      <li><span aria-current="page">{{ person?.name ?? `#${id}` }}</span></li>
    </ol>
  </nav>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading && !person">Cargando…</p>

  <template v-else-if="person">
    <div class="detail-head">
      <div>
        <h1>
          {{ person.name }}
          <StatusBadge :label="person.active ? 'Activa' : 'Inactiva'" :tone="activeTone(person.active)" />
        </h1>
        <p class="hint">
          {{ person.idNumber }} · {{ person.phone ?? 'Sin teléfono' }} · {{ person.email ?? 'Sin correo' }}
        </p>
      </div>
    </div>

    <section v-if="canProjects || canPayroll" class="card" aria-label="Resumen">
      <dl class="summary-grid">
        <template v-if="canProjects">
          <div>
            <dt>Asignaciones vigentes</dt>
            <dd>{{ openAssignments.length }} <span class="hint">de {{ assignments.length }}</span></dd>
          </div>
          <div>
            <dt>Compromiso por período</dt>
            <dd>{{ formatUsd(currentCommitment) }}</dd>
          </div>
        </template>
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
        </template>
      </dl>
    </section>

    <section v-if="canProjects" class="card">
      <div class="page-header">
        <h2>Asignaciones</h2>
        <RouterLink class="button" :to="{ name: 'assignments' }">Gestionar</RouterLink>
      </div>
      <p v-if="sectionErrors.assignments" class="error" role="alert">{{ sectionErrors.assignments }}</p>
      <div v-else class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Proyecto</th>
              <th scope="col">Grupo de pago</th>
              <th scope="col" class="num">Monto</th>
              <th scope="col">Vigencia</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="assignment in assignments" :key="assignment.id">
              <td>
                <RouterLink :to="{ name: 'projects', query: { id: assignment.project.id } }">{{ assignment.project.code }}</RouterLink>
                <span class="permission-code">{{ assignment.project.name }}</span>
              </td>
              <td>{{ assignment.paymentGroup.name }}</td>
              <td class="num">{{ formatUsd(assignment.amountCents) }}</td>
              <td class="nowrap">{{ formatRange(assignment.startDate, assignment.effectiveEndDate) }}</td>
            </tr>
            <tr v-if="assignments.length === 0">
              <td colspan="4">La persona no tiene asignaciones.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <template v-if="canPayroll">
      <section class="card">
        <h2>Pagos (recibos)</h2>
        <p v-if="sectionErrors.payments" class="error" role="alert">{{ sectionErrors.payments }}</p>
        <template v-else>
          <p class="hint">{{ activePayments.length }} vigentes · {{ formatUsd(totalPaid) }} recibidos</p>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th scope="col">Recibo</th>
                  <th scope="col">Solicitud</th>
                  <th scope="col">Fecha</th>
                  <th scope="col" class="num">Monto</th>
                  <th scope="col">Referencia</th>
                  <th scope="col">Estado</th>
                  <th v-if="canReport" scope="col"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="payment in payments" :key="payment.id">
                  <td class="nowrap">#{{ payment.id }}</td>
                  <td class="nowrap">
                    <RouterLink :to="{ name: 'payment-requests', query: { id: payment.requestId } }">#{{ payment.requestId }}</RouterLink>
                  </td>
                  <td class="nowrap">{{ formatDate(payment.paidOn) }}</td>
                  <td class="num">{{ formatUsd(payment.amountCents) }}</td>
                  <td>{{ payment.reference }}</td>
                  <td>
                    <StatusBadge :label="payment.annulledAt ? 'Anulado' : 'Vigente'" :tone="payment.annulledAt ? 'danger' : 'success'" />
                  </td>
                  <td v-if="canReport">
                    <a class="button" :href="receiptPdfUrl(payment.id)" target="_blank" rel="noopener">Recibo PDF</a>
                  </td>
                </tr>
                <tr v-if="payments.length === 0">
                  <td :colspan="canReport ? 7 : 6">Todavía no hay pagos.</td>
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
                <th scope="col">Proyecto</th>
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
                <td>{{ accrual.project.code }}</td>
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
          Se muestran las primeras {{ accruals.accruals.length }} de {{ accruals.total }}.
        </p>
      </details>
    </template>
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
