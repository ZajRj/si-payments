<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { listAuditEntries, type AuditEntry } from '@/api/audit';
import { errorMessage } from '@/api/http';
import { REQUEST_STATUS_LABELS } from '@/api/payment-requests';
import { monthLabel, VOUCHER_STATUS_LABELS } from '@/api/petty-cash';
import { getBalances, type BalanceTotals } from '@/api/reports';
import { listSettings } from '@/api/settings';
import { listUsers } from '@/api/users';
import AppIcon from '@/components/AppIcon.vue';
import ReportSummary from '@/components/reports/ReportSummary.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { ACTION_TONES, ACTIONS, ENTITY_SINGULAR } from '@/lib/audit-labels';
import { formatDateTime } from '@/lib/dates';
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

// Resumen del administrador: cuentas, parámetros de los PDF y actividad reciente.
type AdminSummary = {
  users: { active: number; inactive: number; byRole: { name: string; count: number }[] };
  missingSettings: string[];
  settingsCount: number;
  recent: AuditEntry[];
  changesThisWeek: number;
};
const admin = ref<AdminSummary | null>(null);
const RECENT_LIMIT = 8;

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
  return [];
});

const taskTone = (task: Task) => (task.count > 0 && !task.informative ? 'task-has-work' : 'task-done');

const pendingTitle = computed(() => (decides.value ? 'Solicitudes por decidir o pagar' : 'Borradores por enviar'));

const greeting = (() => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
})();

const firstName = computed(() => auth.user?.name.split(' ')[0] ?? '');

// Fecha local AAAA-MM-DD de hace `days` días.
function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toLocaleDateString('sv-SE');
}

async function loadAdminSummary() {
  const canAudit = auth.can(PERMISSIONS.AUDIT_READ);
  const [users, settings, recent, week] = await Promise.all([
    listUsers(),
    listSettings(),
    canAudit ? listAuditEntries({}) : null,
    canAudit ? listAuditEntries({ from: daysAgo(6) }) : null,
  ]);
  // Los usuarios eliminados no cuentan: ya no tienen cuenta.
  const current = users.filter((user) => !user.deleteDate);
  const roles = new Map<string, number>();
  for (const user of current.filter((u) => u.active)) roles.set(user.role.name, (roles.get(user.role.name) ?? 0) + 1);
  admin.value = {
    users: {
      active: current.filter((user) => user.active).length,
      inactive: current.filter((user) => !user.active).length,
      byRole: [...roles].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    },
    missingSettings: settings.filter((setting) => !setting.value.trim()).map((setting) => setting.label),
    settingsCount: settings.length,
    recent: recent?.entries.slice(0, RECENT_LIMIT) ?? [],
    changesThisWeek: week?.total ?? 0,
  };
}

// "hace 5 min", "hace 3 h", "hace 2 días".
function timeAgo(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function recordLabel(entry: AuditEntry) {
  return `${ENTITY_SINGULAR[entry.entity] ?? entry.entity} #${entry.entityId}`;
}

onMounted(async () => {
  try {
    const [balances] = await Promise.all([
      canReport.value ? getBalances('project', {}) : null,
      isAdmin.value ? loadAdminSummary() : null,
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

  <template v-if="admin">
    <h2 class="section-title">Resumen del sistema</h2>
    <div class="admin-cards">
      <RouterLink :to="{ name: 'users' }" class="admin-card">
        <span class="admin-card-label"><AppIcon name="users" :size="16" /> Usuarios</span>
        <span class="admin-card-value">
          {{ admin.users.active }} <small>{{ admin.users.active === 1 ? 'cuenta activa' : 'cuentas activas' }}</small>
        </span>
        <ul class="admin-card-detail admin-card-list">
          <li v-for="role in admin.users.byRole" :key="role.name">{{ role.count }} {{ role.name }}</li>
          <li v-if="admin.users.inactive > 0">
            {{ admin.users.inactive }} {{ admin.users.inactive === 1 ? 'cuenta desactivada' : 'cuentas desactivadas' }}
          </li>
        </ul>
        <span class="admin-card-go">Gestionar usuarios <AppIcon name="arrow" :size="14" /></span>
      </RouterLink>

      <RouterLink :to="{ name: 'settings' }" class="admin-card" :class="{ 'admin-card-warning': admin.missingSettings.length }">
        <span class="admin-card-label"><AppIcon name="settings" :size="16" /> Datos de los PDF</span>
        <span class="admin-card-value">
          <template v-if="admin.missingSettings.length === 0">
            <AppIcon name="check" :size="20" /> <small>Completos</small>
          </template>
          <template v-else>
            {{ admin.missingSettings.length }} <small>{{ admin.missingSettings.length === 1 ? 'dato sin completar' : 'datos sin completar' }}</small>
          </template>
        </span>
        <span class="admin-card-detail">
          {{
            admin.missingSettings.length === 0
              ? `Los ${admin.settingsCount} datos de la empresa que salen en recibos y solicitudes están cargados.`
              : `Falta: ${admin.missingSettings.join(', ')}.`
          }}
        </span>
        <span class="admin-card-go">
          {{ admin.missingSettings.length ? 'Completar' : 'Ver parámetros' }} <AppIcon name="arrow" :size="14" />
        </span>
      </RouterLink>

      <RouterLink :to="{ name: 'audit-log' }" class="admin-card">
        <span class="admin-card-label"><AppIcon name="history" :size="16" /> Auditoría</span>
        <span class="admin-card-value">
          {{ admin.changesThisWeek }} <small>{{ admin.changesThisWeek === 1 ? 'cambio en 7 días' : 'cambios en 7 días' }}</small>
        </span>
        <span class="admin-card-detail">
          <template v-if="admin.recent[0]">
            Último: {{ timeAgo(admin.recent[0].createdAt) }}, por {{ admin.recent[0].user?.name ?? 'el sistema' }}.
          </template>
          <template v-else>Todavía no hay cambios registrados.</template>
        </span>
        <span class="admin-card-go">Ver auditoría <AppIcon name="arrow" :size="14" /></span>
      </RouterLink>
    </div>

    <section v-if="admin.recent.length" class="card section-gap">
      <div class="page-header">
        <h2>Actividad reciente</h2>
        <RouterLink :to="{ name: 'audit-log' }" class="button">Ver toda la auditoría</RouterLink>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Cuándo</th>
              <th scope="col">Usuario</th>
              <th scope="col">Acción</th>
              <th scope="col">Registro</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in admin.recent" :key="entry.id">
              <td class="nowrap" :title="formatDateTime(entry.createdAt)">
                {{ timeAgo(entry.createdAt) }}
                <span class="permission-code">{{ formatDateTime(entry.createdAt) }}</span>
              </td>
              <td>{{ entry.user?.name ?? 'Sistema' }}</td>
              <td><StatusBadge :label="ACTIONS[entry.action]" :tone="ACTION_TONES[entry.action]" /></td>
              <td>{{ recordLabel(entry) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <template v-if="tasks.length">
    <h2 class="section-title">Lo que te toca</h2>
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
