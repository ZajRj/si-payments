<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { listAuditEntries } from '@/api/audit';
import { errorMessage } from '@/api/http';
import { REQUEST_STATUS_LABELS } from '@/api/payment-requests';
import { monthLabel, VOUCHER_STATUS_LABELS } from '@/api/petty-cash';
import { getBalances, type BalanceTotals } from '@/api/reports';
import { listSettings } from '@/api/settings';
import { listUsers } from '@/api/users';
import AppIcon from '@/components/AppIcon.vue';
import ReportSummary from '@/components/reports/ReportSummary.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatUsd } from '@/lib/money';
import { REQUEST_STATUS_TONES, VOUCHER_STATUS_TONES } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { usePendingStore } from '@/stores/pending';

const auth = useAuthStore();
const pending = usePendingStore();

const canReport = computed(() => auth.can(PERMISSIONS.REPORTS_READ));
const canSeeRequests = computed(() => auth.can(PERMISSIONS.PAYROLL_READ));
const canSeeVouchers = computed(() => auth.can(PERMISSIONS.PETTY_CASH_READ));
const decides = computed(() => auth.can(PERMISSIONS.PAYMENT_REQUESTS_DECIDE));
const isAdmin = computed(() => auth.can(PERMISSIONS.USERS_MANAGE));

const totals = ref<BalanceTotals | null>(null);
const error = ref('');

// Datos del administrador, que no participa en operaciones de dinero.
const adminStats = ref<{ activeUsers: number; emptySettings: number; changesToday: number } | null>(null);
const today = new Date().toLocaleDateString('sv-SE');

// Una tarea informativa muestra un dato del sistema, no trabajo pendiente.
type Task = { count: number; title: string; detail: string; action: string; to: RouteLocationRaw; informative?: boolean };

const requestsTo = (estado: string): RouteLocationRaw => ({ name: 'payment-requests', query: { estado } });

// Lo que le toca hacer a cada rol, con un enlace al listado ya filtrado.
const tasks = computed<Task[]>(() => {
  const requests = pending.requests;
  const vouchers = pending.vouchers.length;
  if (decides.value) {
    return [
      { count: requests.filter((r) => r.status === 'SUBMITTED').length, title: 'Solicitudes por responder', detail: 'Debes aprobarlas o rechazarlas', action: 'Revisar', to: requestsTo('SUBMITTED') },
      { count: requests.filter((r) => r.status === 'APPROVED' && r.outstandingCents > 0).length, title: 'Solicitudes por pagar', detail: 'Aprobadas, falta entregar el dinero', action: 'Entregar dinero', to: requestsTo('TO_PAY') },
      { count: requests.filter((r) => r.status === 'APPROVED' && r.outstandingCents === 0).length, title: 'Falta cerrarlas', detail: 'Ya se entregó todo el dinero', action: 'Cerrar', to: requestsTo('TO_CLOSE') },
      { count: vouchers, title: 'Vales de caja chica', detail: 'Esperan tu aprobación o la entrega del dinero', action: 'Ver cajas', to: { name: 'petty-cash' } },
    ];
  }
  if (canSeeRequests.value) {
    return [
      { count: requests.filter((r) => r.status === 'DRAFT').length, title: 'Solicitudes por enviar', detail: 'El Receptor todavía no las ve', action: 'Enviar', to: requestsTo('DRAFT') },
      { count: requests.filter((r) => r.status === 'SUBMITTED').length, title: 'Esperando respuesta', detail: 'Ya las enviaste; no tienes que hacer nada', action: 'Ver', to: requestsTo('SUBMITTED') },
      { count: vouchers, title: 'Vales sin comprobante', detail: 'Ya tienes el dinero; falta entregar el comprobante', action: 'Entregar comprobante', to: { name: 'petty-cash' } },
    ];
  }
  if (!adminStats.value) return [];
  return [
    { count: adminStats.value.emptySettings, title: 'Parámetros sin completar', detail: 'Datos que salen en los recibos y solicitudes en PDF', action: 'Completar', to: { name: 'settings' } },
    { count: adminStats.value.activeUsers, title: 'Usuarios activos', detail: 'Cuentas con acceso al sistema', action: 'Ver usuarios', to: { name: 'users' }, informative: true },
    { count: adminStats.value.changesToday, title: 'Cambios registrados hoy', detail: 'En el log de auditoría', action: 'Ver auditoría', to: { name: 'audit-log' }, informative: true },
  ];
});

const taskTone = (task: Task) => (task.count > 0 && !task.informative ? 'task-has-work' : 'task-done');

const pendingTitle = computed(() => (decides.value ? 'Solicitudes por decidir o pagar' : 'Borradores por enviar'));

const greeting = (() => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
})();

const firstName = computed(() => auth.user?.name.split(' ')[0] ?? '');

async function loadAdminStats() {
  const [users, settings, audit] = await Promise.all([
    listUsers(),
    listSettings(),
    auth.can(PERMISSIONS.AUDIT_READ) ? listAuditEntries({ from: today }) : null,
  ]);
  adminStats.value = {
    activeUsers: users.filter((user) => user.active).length,
    emptySettings: settings.filter((setting) => !setting.value.trim()).length,
    changesToday: audit?.total ?? 0,
  };
}

onMounted(async () => {
  try {
    const [balances] = await Promise.all([
      canReport.value ? getBalances('project', {}) : null,
      isAdmin.value ? loadAdminStats() : null,
      pending.refresh(),
    ]);
    totals.value = balances?.totals ?? null;
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <header class="welcome">
    <h1>{{ greeting }}, {{ firstName }}</h1>
    <p>Entraste como <strong>{{ auth.user?.role.name }}</strong>.</p>
  </header>

  <p v-if="error" class="error" role="alert">{{ error }}</p>

  <template v-if="tasks.length">
    <h2 class="section-title">{{ canSeeRequests ? 'Lo que te toca' : 'Estado del sistema' }}</h2>
    <nav class="tasks" aria-label="Pendientes">
      <RouterLink v-for="task in tasks" :key="task.title" :to="task.to" class="task" :class="taskTone(task)">
        <span class="task-count">{{ task.count }}</span>
        <strong>{{ task.title }}</strong>
        <span class="task-sub">{{ task.detail }}</span>
        <span class="task-go">
          <template v-if="task.count > 0 || task.informative">{{ task.action }} <AppIcon name="arrow" :size="14" /></template>
          <template v-else>Nada pendiente</template>
        </span>
      </RouterLink>
    </nav>
  </template>

  <div v-if="!canSeeRequests" class="role-note">
    <AppIcon name="info" :size="20" />
    <p>Este rol administra el sistema y no participa en operaciones de dinero, por eso no ve montos ni solicitudes.</p>
  </div>

  <template v-if="totals">
    <ReportSummary v-bind="totals" />
    <p class="summary-link">
      <RouterLink :to="{ name: 'reports' }">Ver reportes por persona y proyecto</RouterLink>
    </p>
  </template>

  <section v-if="canSeeRequests" class="card">
    <div class="page-header">
      <h2>{{ pendingTitle }}</h2>
      <RouterLink :to="{ name: 'payment-requests' }" class="button">Ver todas</RouterLink>
    </div>
    <p v-if="pending.pendingRequests.length === 0" class="hint">No hay nada pendiente por ahora.</p>
    <div v-else class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Solicitud</th>
            <th scope="col">Proyecto</th>
            <th scope="col">Estado</th>
            <th scope="col" class="num">Solicitado</th>
            <th scope="col" class="num">Pendiente</th>
            <th scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="request in pending.pendingRequests" :key="request.id">
            <td>#{{ request.id }}</td>
            <td>{{ request.project.code }} · {{ request.project.name }}</td>
            <td><StatusBadge :label="REQUEST_STATUS_LABELS[request.status]" :tone="REQUEST_STATUS_TONES[request.status]" /></td>
            <td class="num">{{ formatUsd(request.requestedCents) }}</td>
            <td class="num">{{ formatUsd(request.outstandingCents) }}</td>
            <td>
              <RouterLink :to="{ name: 'payment-requests', query: { id: request.id } }" class="button">
                {{ decides ? (request.status === 'SUBMITTED' ? 'Revisar' : request.outstandingCents === 0 ? 'Cerrar' : 'Pagar') : 'Abrir' }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section v-if="canSeeVouchers && pending.vouchers.length" class="card section-gap">
    <div class="page-header">
      <h2>{{ decides ? 'Vales que esperan tu respuesta' : 'Vales sin comprobante' }}</h2>
      <RouterLink :to="{ name: 'petty-cash' }" class="button">Ver cajas</RouterLink>
    </div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Caja</th>
            <th scope="col">Concepto</th>
            <th scope="col">Estado</th>
            <th scope="col" class="num">Monto</th>
            <th scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="voucher in pending.vouchers" :key="voucher.id">
            <td>{{ voucher.fund.name }} <span class="permission-code">{{ monthLabel(voucher.period) }}</span></td>
            <td>{{ voucher.concept }}</td>
            <td><StatusBadge :label="VOUCHER_STATUS_LABELS[voucher.status]" :tone="VOUCHER_STATUS_TONES[voucher.status]" /></td>
            <td class="num">{{ formatUsd(voucher.amountCents) }}</td>
            <td>
              <RouterLink :to="{ name: 'petty-cash', query: { fund: voucher.fund.id } }" class="button">Abrir</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
