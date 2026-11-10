<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorMessage } from '@/api/http';
import {
  annulPayment,
  approvePaymentRequest,
  cancelPaymentRequest,
  closePaymentRequest,
  createPaymentRequest,
  getPaymentRequest,
  listPaymentRequests,
  registerPayments,
  rejectPaymentRequest,
  REQUEST_STATUS_LABELS,
  submitPaymentRequest,
  type Payment,
  type PaymentRequestDetail,
  type PaymentRequestSummary,
  type RequestStatus,
} from '@/api/payment-requests';
import { listProjects, type Project } from '@/api/projects';
import { paymentRequestPdfUrl, receiptPdfUrl } from '@/api/reports';
import StatusBadge from '@/components/StatusBadge.vue';
import { centsToInput, formatUsd, parseUsd } from '@/lib/money';
import { REQUEST_STATUS_TONES } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { formatDate, formatDateTime, formatRange } from '@/lib/dates';

const auth = useAuthStore();
const canCreate = computed(() => auth.can(PERMISSIONS.PAYMENT_REQUESTS_CREATE));
const canDecide = computed(() => auth.can(PERMISSIONS.PAYMENT_REQUESTS_DECIDE));
const canRegister = computed(() => auth.can(PERMISSIONS.PAYMENTS_REGISTER));
const canReport = computed(() => auth.can(PERMISSIONS.REPORTS_READ));

const requests = ref<PaymentRequestSummary[]>([]);
const projects = ref<Project[]>([]);
const loading = ref(true);
const error = ref('');
const filters = reactive({ projectId: 0, status: '' as '' | RequestStatus });

const today = new Date().toLocaleDateString('sv-SE');
const route = useRoute();
const detailEl = ref<HTMLElement | null>(null);

// Al cambiar un filtro se recarga la lista; no hace falta un botón.
watch(filters, loadRequests);

async function loadRequests() {
  loading.value = true;
  error.value = '';
  try {
    requests.value = await listPaymentRequests({
      projectId: filters.projectId || undefined,
      status: filters.status || undefined,
    });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

async function load() {
  try {
    projects.value = await listProjects();
  } catch (e) {
    error.value = errorMessage(e);
  }
  await loadRequests();
  const id = Number(route.query.id);
  if (id) await openDetail(id);
}

// Nueva solicitud: toma toda la deuda pendiente del proyecto.
const formOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const form = reactive({ projectId: 0, notes: '' });

function openCreate() {
  Object.assign(form, { projectId: filters.projectId, notes: '' });
  formError.value = '';
  formOpen.value = true;
}

async function save() {
  formError.value = '';
  if (!form.projectId) {
    formError.value = 'Selecciona el proyecto';
    return;
  }
  saving.value = true;
  try {
    const created = await createPaymentRequest({ projectId: form.projectId, notes: form.notes || null });
    formOpen.value = false;
    await loadRequests();
    showDetail(created);
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// Detalle de la solicitud seleccionada.
const detail = ref<PaymentRequestDetail | null>(null);
const detailError = ref('');
const busy = ref(false);
const paymentForm = reactive({ paidOn: today, reference: '', amounts: {} as Record<number, string> });

function showDetail(request: PaymentRequestDetail) {
  detail.value = request;
  detailError.value = '';
  prompt.value = null;
  paymentForm.paidOn = today;
  paymentForm.reference = '';
  paymentForm.amounts = Object.fromEntries(
    request.people.map((entry) => [entry.person.id, entry.outstandingCents > 0 ? centsToInput(entry.outstandingCents) : '']),
  );
}

async function openDetail(id: number) {
  detailError.value = '';
  try {
    showDetail(await getPaymentRequest(id));
    await nextTick();
    detailEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<PaymentRequestDetail>) {
  detailError.value = '';
  busy.value = true;
  try {
    showDetail(await action());
    await loadRequests();
  } catch (e) {
    detailError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function submitPayments() {
  if (!detail.value) return;
  const payments: { personId: number; amountCents: number }[] = [];
  for (const [personId, text] of Object.entries(paymentForm.amounts)) {
    if (!text.trim()) continue;
    const amountCents = parseUsd(text);
    if (amountCents === null) {
      detailError.value = 'Escribe montos válidos, por ejemplo 150 o 150.50';
      return;
    }
    if (amountCents > 0) payments.push({ personId: Number(personId), amountCents });
  }
  if (payments.length === 0) {
    detailError.value = 'Indica el monto entregado a al menos una persona';
    return;
  }
  const id = detail.value.id;
  return run(() =>
    registerPayments(id, { paidOn: paymentForm.paidOn, reference: paymentForm.reference || null, payments }),
  );
}

// Acciones que piden una nota o un motivo.
type Prompt =
  | { kind: 'approve' | 'reject' | 'close'; text: string }
  | { kind: 'annul'; payment: Payment; text: string };
const prompt = ref<Prompt | null>(null);

// Aprobada y sin saldo por entregar: solo falta cerrarla.
const readyToClose = computed(() => detail.value?.status === 'APPROVED' && detail.value.outstandingCents === 0);

const PROMPT_TITLES: Record<Prompt['kind'], string> = {
  approve: 'Aprobar solicitud',
  reject: 'Rechazar solicitud',
  close: 'Cerrar solicitud',
  annul: 'Anular pago',
};

const promptRequiresText = computed(() => {
  const current = prompt.value;
  if (!current) return false;
  if (current.kind === 'reject' || current.kind === 'annul') return true;
  return current.kind === 'close' && (detail.value?.outstandingCents ?? 0) > 0;
});

async function confirmPrompt() {
  const current = prompt.value;
  const request = detail.value;
  if (!current || !request) return;
  const text = current.text.trim() || null;

  if (current.kind === 'annul') {
    detailError.value = '';
    busy.value = true;
    try {
      await annulPayment(current.payment.id, text ?? '');
      showDetail(await getPaymentRequest(request.id));
      await loadRequests();
    } catch (e) {
      detailError.value = errorMessage(e);
    } finally {
      busy.value = false;
    }
    return;
  }

  if (current.kind === 'approve') await run(() => approvePaymentRequest(request.id, text));
  if (current.kind === 'reject') await run(() => rejectPaymentRequest(request.id, text ?? ''));
  if (current.kind === 'close') await run(() => closePaymentRequest(request.id, text));
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Solicitudes de pago</h1>
    <button v-if="canCreate" type="button" class="button button-primary" @click="openCreate">Nueva solicitud</button>
  </div>
  <p class="hint">
    Creación → envío → aprobación o rechazo → entrega de fondos → cierre. Los pagos pueden ser parciales y se aplican
    primero a la deuda más antigua.
  </p>

  <form v-if="formOpen" class="card form-grid section-gap" @submit.prevent="save">
    <h2>Nueva solicitud</h2>
    <label class="field">
      Proyecto
      <select v-model.number="form.projectId" required>
        <option :value="0" disabled>Selecciona un proyecto</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">
          {{ project.code }} · {{ project.name }}
        </option>
      </select>
      <span class="hint">Incluye toda la deuda causada y pendiente del proyecto que no esté en otra solicitud.</span>
    </label>
    <label class="field">
      Notas (opcional)
      <input v-model="form.notes" maxlength="500" />
    </label>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
    <div class="actions">
      <button type="submit" class="button button-primary" :disabled="saving">Crear</button>
      <button type="button" class="button" @click="formOpen = false">Cancelar</button>
    </div>
  </form>

  <section v-if="detail" ref="detailEl" class="card section-gap">
    <div class="page-header">
      <h2>
        Solicitud #{{ detail.id }} · {{ detail.project.code }}
        <StatusBadge :label="REQUEST_STATUS_LABELS[detail.status]" :tone="REQUEST_STATUS_TONES[detail.status]" />
      </h2>
      <button type="button" class="button" @click="detail = null">Cerrar detalle</button>
    </div>
    <p class="hint">
      Creada por {{ detail.createdBy?.name }} el {{ formatDateTime(detail.createdAt) }}
      <template v-if="detail.submittedAt"> · Enviada el {{ formatDateTime(detail.submittedAt) }}</template>
      <template v-if="detail.decidedAt">
        · {{ detail.status === 'REJECTED' ? 'Rechazada' : 'Aprobada' }} por {{ detail.decidedBy?.name }} el
        {{ formatDateTime(detail.decidedAt) }}
      </template>
      <template v-if="detail.closedAt"> · Cerrada por {{ detail.closedBy?.name }} el {{ formatDateTime(detail.closedAt) }}</template>
      <template v-if="detail.cancelledAt"> · Cancelada el {{ formatDateTime(detail.cancelledAt) }}</template>
    </p>
    <p v-if="detail.notes" class="hint">Notas: {{ detail.notes }}</p>
    <p v-if="detail.decisionNote" class="hint">Nota de la decisión: {{ detail.decisionNote }}</p>
    <p v-if="detail.closingNote" class="hint">Nota de cierre: {{ detail.closingNote }}</p>
    <p>
      Solicitado <strong>{{ formatUsd(detail.requestedCents) }}</strong> · Pagado
      <strong>{{ formatUsd(detail.paidCents) }}</strong> · Pendiente <strong>{{ formatUsd(detail.outstandingCents) }}</strong>
    </p>

    <div class="actions">
      <a v-if="canReport" class="button" :href="paymentRequestPdfUrl(detail.id)" target="_blank" rel="noopener">
        Solicitud consolidada PDF
      </a>
      <template v-if="canCreate">
        <button
          v-if="detail.status === 'DRAFT'"
          type="button"
          class="button button-primary"
          :disabled="busy"
          @click="run(() => submitPaymentRequest(detail!.id))"
        >
          Enviar
        </button>
        <button
          v-if="detail.status === 'DRAFT' || detail.status === 'SUBMITTED'"
          type="button"
          class="button"
          :disabled="busy"
          @click="run(() => cancelPaymentRequest(detail!.id))"
        >
          Cancelar solicitud
        </button>
      </template>
      <template v-if="canDecide && detail.status === 'SUBMITTED'">
        <button type="button" class="button button-primary" @click="prompt = { kind: 'approve', text: '' }">Aprobar</button>
        <button type="button" class="button" @click="prompt = { kind: 'reject', text: '' }">Rechazar</button>
      </template>
      <button
        v-if="canRegister && detail.status === 'APPROVED'"
        type="button"
        :class="['button', { 'button-primary': readyToClose }]"
        @click="prompt = { kind: 'close', text: '' }"
      >
        Cerrar solicitud
      </button>
    </div>

    <p v-if="readyToClose" class="notice notice-success section-gap" role="status">
      <strong>Pagada por completo.</strong>
      {{ canRegister ? 'Falta cerrar la solicitud para terminar el ciclo.' : 'Falta que el Receptor la cierre.' }}
    </p>

    <form v-if="prompt" class="form-grid section-gap" @submit.prevent="confirmPrompt">
      <h2>
        {{ PROMPT_TITLES[prompt.kind] }}
        <template v-if="prompt.kind === 'annul'"> · recibo #{{ prompt.payment.id }}, {{ prompt.payment.person.name }}</template>
      </h2>
      <label class="field">
        {{ promptRequiresText ? 'Motivo' : 'Nota (opcional)' }}
        <input v-model="prompt.text" :required="promptRequiresText" :minlength="promptRequiresText ? 5 : undefined" maxlength="500" />
        <span v-if="prompt.kind === 'close' && detail.outstandingCents > 0" class="hint">
          El saldo pendiente vuelve a la deuda y podrá incluirse en otra solicitud.
        </span>
      </label>
      <div class="actions">
        <button type="submit" class="button button-primary" :disabled="busy">Confirmar</button>
        <button type="button" class="button" @click="prompt = null">Cancelar</button>
      </div>
    </form>

    <p v-if="detailError" class="error section-gap" role="alert">{{ detailError }}</p>

    <h2 class="section-gap">Personas</h2>
    <form @submit.prevent="submitPayments">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col" class="num">Solicitado</th>
              <th scope="col" class="num">Pagado</th>
              <th scope="col" class="num">Pendiente</th>
              <th v-if="canRegister && detail.status === 'APPROVED'" scope="col">Entregar (USD)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in detail.people" :key="entry.person.id">
              <td>
                {{ entry.person.name }}
                <span class="permission-code">{{ entry.person.idNumber }}</span>
              </td>
              <td class="num">{{ formatUsd(entry.requestedCents) }}</td>
              <td class="num">{{ formatUsd(entry.paidCents) }}</td>
              <td class="num">{{ formatUsd(entry.outstandingCents) }}</td>
              <td v-if="canRegister && detail.status === 'APPROVED'" class="field">
                <input
                  v-model="paymentForm.amounts[entry.person.id]"
                  inputmode="decimal"
                  :disabled="entry.outstandingCents === 0"
                  :aria-label="`Monto a entregar a ${entry.person.name}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="canRegister && detail.status === 'APPROVED' && detail.outstandingCents > 0" class="form-grid section-gap">
        <label class="field">
          Fecha de entrega
          <input v-model="paymentForm.paidOn" type="date" required :max="today" />
        </label>
        <label class="field">
          Referencia (opcional)
          <input v-model="paymentForm.reference" maxlength="120" placeholder="Efectivo, transferencia…" />
        </label>
        <div class="actions">
          <button type="submit" class="button button-primary" :disabled="busy">Registrar entrega</button>
        </div>
      </div>
    </form>

    <h2 class="section-gap">Detalle por causación</h2>
    <p class="hint">Ordenado como se aplican los pagos: primero la deuda más antigua.</p>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Persona</th>
            <th scope="col">Período</th>
            <th scope="col">Días</th>
            <th scope="col" class="num">Solicitado</th>
            <th scope="col" class="num">Pagado</th>
            <th scope="col" class="num">Pendiente</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in detail.items" :key="item.id">
            <td>{{ item.person.name }}</td>
            <td class="nowrap">
              {{ formatRange(item.period.startDate, item.period.endDate) }}
              <span class="permission-code">Causación #{{ item.accrualId }}</span>
            </td>
            <td class="nowrap">{{ item.activeDays }} / {{ item.periodDays }}</td>
            <td class="num">{{ formatUsd(item.requestedCents) }}</td>
            <td class="num">{{ formatUsd(item.paidCents) }}</td>
            <td class="num">{{ formatUsd(item.outstandingCents) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 class="section-gap">Pagos (recibos)</h2>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Recibo</th>
            <th scope="col">Persona</th>
            <th scope="col">Fecha</th>
            <th scope="col" class="num">Monto</th>
            <th scope="col">Referencia</th>
            <th scope="col">Registrado por</th>
            <th scope="col">Estado</th>
            <th v-if="canRegister || canReport" scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="payment in detail.payments" :key="payment.id">
            <td class="nowrap">#{{ payment.id }}</td>
            <td>{{ payment.person.name }}</td>
            <td class="nowrap">{{ formatDate(payment.paidOn) }}</td>
            <td class="num">{{ formatUsd(payment.amountCents) }}</td>
            <td>{{ payment.reference }}</td>
            <td>{{ payment.createdBy?.name }}</td>
            <td>
              <StatusBadge :label="payment.annulledAt ? 'Anulado' : 'Vigente'" :tone="payment.annulledAt ? 'danger' : 'success'" />
              <span v-if="payment.annulmentReason" class="permission-code">{{ payment.annulmentReason }}</span>
            </td>
            <td v-if="canRegister || canReport" class="actions">
              <a v-if="canReport" class="button" :href="receiptPdfUrl(payment.id)" target="_blank" rel="noopener">
                Recibo PDF
              </a>
              <button
                v-if="canRegister && !payment.annulledAt"
                type="button"
                class="button"
                @click="prompt = { kind: 'annul', payment, text: '' }"
              >
                Anular
              </button>
            </td>
          </tr>
          <tr v-if="detail.payments.length === 0">
            <td :colspan="canRegister || canReport ? 8 : 7">Todavía no hay pagos.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <form class="card form-grid section-gap" @submit.prevent>
    <label class="field">
      Proyecto
      <select v-model.number="filters.projectId">
        <option :value="0">Todos</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }}</option>
      </select>
    </label>
    <label class="field">
      Estado
      <select v-model="filters.status">
        <option value="">Todos</option>
        <option v-for="(label, value) in REQUEST_STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
  </form>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Solicitud</th>
          <th scope="col">Proyecto</th>
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
          <td class="nowrap" :title="request.project.name">{{ request.project.code }}</td>
          <td>
            <StatusBadge :label="REQUEST_STATUS_LABELS[request.status]" :tone="REQUEST_STATUS_TONES[request.status]" />
            <span v-if="request.status === 'APPROVED' && request.outstandingCents === 0" class="permission-code">Pagada, falta cerrar</span>
          </td>
          <td>{{ request.personCount }}</td>
          <td class="num">{{ formatUsd(request.requestedCents) }}</td>
          <td class="num">{{ formatUsd(request.paidCents) }}</td>
          <td class="num">{{ formatUsd(request.outstandingCents) }}</td>
          <td>
            {{ request.createdBy?.name }}
            <span class="permission-code">{{ formatDateTime(request.createdAt) }}</span>
          </td>
          <td>
            <button type="button" class="button" @click="openDetail(request.id)">Ver</button>
          </td>
        </tr>
        <tr v-if="requests.length === 0">
          <td colspan="9">No hay solicitudes con esos filtros.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
