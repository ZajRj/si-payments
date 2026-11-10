<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import { listPaymentRequests, REQUEST_STATUS_LABELS, type PaymentRequestSummary } from '@/api/payment-requests';
import { listVouchers, monthLabel, VOUCHER_STATUS_LABELS, type Voucher } from '@/api/petty-cash';
import { getBalances, type BalanceTotals } from '@/api/reports';
import AppIcon from '@/components/AppIcon.vue';
import BalanceStats from '@/components/BalanceStats.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatUsd } from '@/lib/money';
import { REQUEST_STATUS_TONES, VOUCHER_STATUS_TONES } from '@/lib/status';
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
const vouchers = ref<Voucher[]>([]);
const canSeeVouchers = computed(() => auth.can(PERMISSIONS.PETTY_CASH_READ));

// Vales que esperan acción: el receptor aprueba y desembolsa; el generador rinde lo desembolsado.
const pendingVouchers = computed(() =>
  vouchers.value.filter((voucher) =>
    decides.value ? ['REQUESTED', 'APPROVED'].includes(voucher.status) : voucher.status === 'DISBURSED',
  ),
);

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
    const [balances, list, allVouchers] = await Promise.all([
      canReport.value ? getBalances('project', {}) : null,
      canSeeRequests.value ? listPaymentRequests() : [],
      canSeeVouchers.value ? listVouchers() : [],
    ]);
    totals.value = balances?.totals ?? null;
    requests.value = list;
    vouchers.value = allVouchers;
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
            <th scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="request in pending" :key="request.id">
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

  <section v-if="canSeeVouchers && pendingVouchers.length" class="card section-gap">
    <div class="page-header">
      <h2>{{ decides ? 'Vales por aprobar o desembolsar' : 'Vales por rendir' }}</h2>
      <RouterLink to="/cajas-chicas" class="button">Ver cajas</RouterLink>
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
          <tr v-for="voucher in pendingVouchers" :key="voucher.id">
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
