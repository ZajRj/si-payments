<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import { listPaymentRequests, REQUEST_STATUS_LABELS, type PaymentRequestSummary } from '@/api/payment-requests';
import { getBalances, type BalanceTotals } from '@/api/reports';
import AppIcon from '@/components/AppIcon.vue';
import BalanceStats from '@/components/BalanceStats.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatUsd } from '@/lib/money';
import { REQUEST_STATUS_TONES } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const DESCRIPTIONS: Record<string, string> = {
  users: 'Cuentas y roles de acceso',
  roles: 'Qué puede hacer cada rol',
  people: 'Beneficiarios que cobran',
  projects: 'Área, ámbito y vigencia',
  assignments: 'Persona, proyecto y monto por período',
  accruals: 'Causar períodos con prorrateo',
  'payment-requests': 'Enviar, aprobar y entregar fondos',
  'petty-cash': 'Vales, rendiciones y arrastre de saldo',
  reports: 'Saldos, pagos y estados de cuenta',
  areas: 'Física, química, biología',
  'payment-groups': 'Periodicidad y fechas de corte',
  settings: 'Datos de la empresa para los PDFs',
  'audit-log': 'Quién, cuándo y qué cambió',
};

const shortcuts = computed(() =>
  router
    .getRoutes()
    .filter(({ name, meta }) => meta.navGroup && (!meta.permission || auth.can(meta.permission)) && name)
    .map((route) => ({
      path: route.path,
      label: route.meta.navLabel!,
      icon: route.meta.navIcon ?? 'arrow',
      description: DESCRIPTIONS[String(route.name)] ?? '',
    })),
);

const canReport = computed(() => auth.can(PERMISSIONS.REPORTS_READ));
const canSeeRequests = computed(() => auth.can(PERMISSIONS.PAYROLL_READ));
const decides = computed(() => auth.can(PERMISSIONS.PAYMENT_REQUESTS_DECIDE));

const totals = ref<BalanceTotals | null>(null);
const requests = ref<PaymentRequestSummary[]>([]);
const error = ref('');

// Lo que espera una acción del usuario: el receptor decide y entrega; el generador completa borradores.
const pending = computed(() =>
  requests.value.filter((request) =>
    decides.value ? ['SUBMITTED', 'APPROVED'].includes(request.status) : request.status === 'DRAFT',
  ),
);
const pendingTitle = computed(() => (decides.value ? 'Solicitudes por decidir o pagar' : 'Borradores por enviar'));

const greeting = (() => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
})();

const firstName = computed(() => auth.user?.name.split(' ')[0] ?? '');

onMounted(async () => {
  try {
    const [balances, list] = await Promise.all([
      canReport.value ? getBalances('project', {}) : null,
      canSeeRequests.value ? listPaymentRequests() : [],
    ]);
    totals.value = balances?.totals ?? null;
    requests.value = list;
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <header class="welcome">
    <h1>{{ greeting }}, {{ firstName }}</h1>
    <p>
      Entraste como <strong>{{ auth.user?.role.name }}</strong>.
      <template v-if="!canSeeRequests">Este rol administra el sistema y no participa en operaciones de dinero.</template>
    </p>
  </header>

  <p v-if="error" class="error" role="alert">{{ error }}</p>

  <BalanceStats v-if="totals" v-bind="totals" />

  <section v-if="canSeeRequests" class="card">
    <div class="page-header">
      <h2>{{ pendingTitle }}</h2>
      <RouterLink to="/solicitudes-de-pago" class="button">Ver todas</RouterLink>
    </div>
    <p v-if="pending.length === 0" class="hint">No hay nada pendiente por ahora.</p>
    <div v-else class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Solicitud</th>
            <th scope="col">Proyecto</th>
            <th scope="col">Estado</th>
            <th scope="col" class="num">Solicitado</th>
            <th scope="col" class="num">Pendiente</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="request in pending" :key="request.id">
            <td>#{{ request.id }}</td>
            <td>{{ request.project.code }} · {{ request.project.name }}</td>
            <td><StatusBadge :label="REQUEST_STATUS_LABELS[request.status]" :tone="REQUEST_STATUS_TONES[request.status]" /></td>
            <td class="num">{{ formatUsd(request.requestedCents) }}</td>
            <td class="num">{{ formatUsd(request.outstandingCents) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <h2 class="section-title">Accesos rápidos</h2>
  <nav class="shortcuts" aria-label="Accesos rápidos">
    <RouterLink v-for="item in shortcuts" :key="item.path" :to="item.path" class="shortcut">
      <span class="shortcut-icon"><AppIcon :name="item.icon" :size="20" /></span>
      <span class="shortcut-text">
        <strong>{{ item.label }}</strong>
        <span>{{ item.description }}</span>
      </span>
      <AppIcon name="arrow" :size="16" />
    </RouterLink>
  </nav>
</template>
