import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { listPaymentRequests, type PaymentRequestSummary } from '@/api/payment-requests';
import { listVouchers, type Voucher, type VoucherStatus } from '@/api/petty-cash';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

// Lo que espera una acción del usuario según su rol. Alimenta los contadores del menú, Inicio y la búsqueda.
export const usePendingStore = defineStore('pending', () => {
  const auth = useAuthStore();
  const requests = ref<PaymentRequestSummary[]>([]);
  const vouchers = ref<Voucher[]>([]);

  const decides = computed(() => auth.can(PERMISSIONS.PAYMENT_REQUESTS_DECIDE));
  const creates = computed(() => auth.can(PERMISSIONS.PAYMENT_REQUESTS_CREATE));

  // El receptor decide y entrega; el generador completa y envía sus borradores.
  function needsAction(request: PaymentRequestSummary) {
    if (decides.value) return request.status === 'SUBMITTED' || request.status === 'APPROVED';
    if (creates.value) return request.status === 'DRAFT';
    return false;
  }

  // El receptor aprueba y desembolsa; el generador rinde lo desembolsado.
  const voucherStatuses = computed<VoucherStatus[]>(() => {
    if (auth.can(PERMISSIONS.PETTY_CASH_MANAGE)) return ['REQUESTED', 'APPROVED'];
    if (auth.can(PERMISSIONS.PETTY_CASH_REQUEST)) return ['DISBURSED'];
    return [];
  });

  const pendingRequests = computed(() => requests.value.filter(needsAction));
  const counts = computed(() => ({
    'payment-requests': pendingRequests.value.length,
    'petty-cash': vouchers.value.length,
  }));

  // Si llegan dos recargas seguidas, solo la última actualiza los datos.
  let seq = 0;

  async function refresh() {
    const current = ++seq;
    const [list, pendingVouchers] = await Promise.all([
      auth.can(PERMISSIONS.PAYROLL_READ) ? listPaymentRequests() : [],
      auth.can(PERMISSIONS.PETTY_CASH_READ)
        ? Promise.all(voucherStatuses.value.map((status) => listVouchers({ status }))).then((lists) => lists.flat())
        : [],
    ]);
    if (current !== seq) return;
    requests.value = list;
    // Quien solicita solo tiene pendientes sus propios vales por rendir.
    const own = auth.can(PERMISSIONS.PETTY_CASH_MANAGE)
      ? pendingVouchers
      : pendingVouchers.filter((voucher) => voucher.requestedBy?.id === auth.user?.id);
    vouchers.value = own.sort((a, b) => b.id - a.id);
  }

  function clear() {
    seq++;
    requests.value = [];
    vouchers.value = [];
  }

  return { requests, vouchers, pendingRequests, counts, needsAction, refresh, clear };
});
