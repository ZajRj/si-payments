<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
} from '@/api/payment-requests';
import { listProjects, type Project } from '@/api/projects';
import { paymentRequestPdfUrl, receiptPdfUrl } from '@/api/reports';
import AppIcon from '@/components/AppIcon.vue';
import AppModal from '@/components/AppModal.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { centsToInput, formatUsd, parseUsd } from '@/lib/money';
import { REQUEST_STATUS_TONES } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { usePendingStore } from '@/stores/pending';
import { formatDate, formatDateTime, formatRange } from '@/lib/dates';

const auth = useAuthStore();
const pending = usePendingStore();
const canCreate = computed(() => auth.can(PERMISSIONS.PAYMENT_REQUESTS_CREATE));
const canDecide = computed(() => auth.can(PERMISSIONS.PAYMENT_REQUESTS_DECIDE));
const canRegister = computed(() => auth.can(PERMISSIONS.PAYMENTS_REGISTER));
const canReport = computed(() => auth.can(PERMISSIONS.REPORTS_READ));

const requests = ref<PaymentRequestSummary[]>([]);
const projects = ref<Project[]>([]);
const loading = ref(true);
const error = ref('');
const filters = reactive({ projectId: 0 });

const today = new Date().toLocaleDateString('sv-SE');
const route = useRoute();
const router = useRouter();

// Filtros por estado. Se aplican sobre la lista ya cargada para mostrar cuántas hay de cada una.
type StatusFilter = { label: string; test: (request: PaymentRequestSummary) => boolean };
const STATUS_FILTERS: Record<string, StatusFilter> = {
  mine: { label: 'Esperan mi acción', test: (request) => pending.needsAction(request) },
  all: { label: 'Todas', test: () => true },
  DRAFT: { label: 'Borrador', test: (request) => request.status === 'DRAFT' },
  SUBMITTED: { label: 'Enviada', test: (request) => request.status === 'SUBMITTED' },
  TO_PAY: { label: 'Aprobada con saldo', test: (request) => request.status === 'APPROVED' && request.outstandingCents > 0 },
  TO_CLOSE: { label: 'Pagada, falta cerrar', test: (request) => request.status === 'APPROVED' && request.outstandingCents === 0 },
  CLOSED: { label: 'Cerrada', test: (request) => request.status === 'CLOSED' },
  REJECTED: { label: 'Rechazada', test: (request) => request.status === 'REJECTED' },
  CANCELLED: { label: 'Cancelada', test: (request) => request.status === 'CANCELLED' },
};
const hasOwnStep = computed(() => canCreate.value || canDecide.value);
const filterKeys = computed(() => Object.keys(STATUS_FILTERS).filter((key) => key !== 'mine' || hasOwnStep.value));

// El estado elegido vive en la URL (?estado=), así Inicio puede enlazar a una lista ya filtrada.
const statusFilter = computed(() => {
  const value = String(route.query.estado ?? '');
  if (filterKeys.value.includes(value)) return value;
  return hasOwnStep.value ? 'mine' : 'all';
});

function setStatusFilter(key: string) {
  void router.replace({ query: { ...route.query, estado: key } });
}

const filteredRequests = computed(() => requests.value.filter(STATUS_FILTERS[statusFilter.value].test));
const filterCount = (key: string) => requests.value.filter(STATUS_FILTERS[key].test).length;

// Al cambiar el proyecto se recarga la lista; no hace falta un botón.
watch(filters, () => void loadRequests());

// Si cambian los filtros mientras hay una consulta en vuelo, solo la última actualiza la lista.
let loadSeq = 0;

async function loadRequests() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const result = await listPaymentRequests({ projectId: filters.projectId || undefined });
    if (seq !== loadSeq) return;
    requests.value = result;
  } catch (e) {
    if (seq === loadSeq) error.value = errorMessage(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

async function load() {
  try {
    projects.value = await listProjects();
  } catch (e) {
    error.value = errorMessage(e);
  }
  await loadRequests();
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
    void pending.refresh();
    showDetail(created);
    await router.push({ query: { ...route.query, id: created.id } });
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// Detalle de la solicitud seleccionada. Su número va en la URL (?id=): Atrás vuelve a la lista
// y el enlace se puede compartir o recargar.
const detail = ref<PaymentRequestDetail | null>(null);
const detailError = ref('');
const busy = ref(false);
const paymentForm = reactive({ paidOn: today, reference: '', amounts: {} as Record<number, string> });

const detailId = computed(() => {
  const id = Number(route.query.id);
  return Number.isInteger(id) && id > 0 ? id : null;
});

const listQuery = computed(() => {
  const { id: _id, ...rest } = route.query;
  return rest;
});

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

async function loadDetail(id: number | null) {
  if (id === null) {
    detail.value = null;
    return;
  }
  if (detail.value?.id === id) return;
  detailError.value = '';
  try {
    showDetail(await getPaymentRequest(id));
    await nextTick();
    window.scrollTo({ top: 0 });
  } catch (e) {
    detail.value = null;
    error.value = errorMessage(e);
  }
}

watch(detailId, (id) => void loadDetail(id));

async function run(action: () => Promise<PaymentRequestDetail>) {
  detailError.value = '';
  busy.value = true;
  try {
    showDetail(await action());
    await loadRequests();
    void pending.refresh();
  } catch (e) {
    detailError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

// Enviar cierra el trabajo del Generador sobre la solicitud: se vuelve a la lista con un aviso.
const listNotice = ref('');

async function submitRequest() {
  const id = detail.value!.id;
  await run(() => submitPaymentRequest(id));
  if (detailError.value) return;
  listNotice.value = `Solicitud #${id} enviada. Queda a la espera de que el Receptor la apruebe o la rechace.`;
  await router.push({ name: 'payment-requests', query: listQuery.value });
}

// El aviso se borra al abrir otra solicitud o crear una.
watch(detailId, (id) => {
  if (id !== null) listNotice.value = '';
});

// Total que se va a entregar con los montos escritos en la tabla.
const paymentTotal = computed(() =>
  Object.values(paymentForm.amounts).reduce((sum, text) => sum + (text.trim() ? (parseUsd(text) ?? 0) : 0), 0),
);

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

// Acciones que se confirman en un modal; algunas piden una nota o un motivo.
type Prompt =
  | { kind: 'approve' | 'reject' | 'close' | 'cancel'; text: string }
  | { kind: 'annul'; payment: Payment; text: string };
const prompt = ref<Prompt | null>(null);

// Aprobada y sin saldo por entregar: solo falta cerrarla.
const readyToClose = computed(() => detail.value?.status === 'APPROVED' && detail.value.outstandingCents === 0);

// Los errores de la solicitud están arriba del detalle; al accionar desde un botón de más abajo
// (como registrar entrega) quedarían fuera de vista.
const detailErrorEl = ref<HTMLElement | null>(null);
watch(detailError, async (value) => {
  if (!value || prompt.value) return;
  await nextTick();
  detailErrorEl.value?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

const PROMPT_TITLES: Record<Prompt['kind'], string> = {
  approve: 'Aprobar solicitud',
  reject: 'Rechazar solicitud',
  close: 'Cerrar solicitud',
  cancel: 'Cancelar solicitud',
  annul: 'Anular pago',
};

const PROMPT_CONFIRM: Record<Prompt['kind'], string> = {
  approve: 'Aprobar',
  reject: 'Rechazar solicitud',
  close: 'Cerrar solicitud',
  cancel: 'Cancelar solicitud',
  annul: 'Anular pago',
};

const promptRequiresText = computed(() => {
  const current = prompt.value;
  if (!current) return false;
  if (current.kind === 'reject' || current.kind === 'annul') return true;
  return current.kind === 'close' && (detail.value?.outstandingCents ?? 0) > 0;
});

// Rechazar, anular, cancelar y cerrar con saldo pendiente no se pueden deshacer.
const promptIsDestructive = computed(() => {
  const current = prompt.value;
  if (!current) return false;
  return current.kind !== 'approve' && (current.kind !== 'close' || (detail.value?.outstandingCents ?? 0) > 0);
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
      void pending.refresh();
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
  if (current.kind === 'cancel') await run(() => cancelPaymentRequest(request.id));
}

// Ciclo de la solicitud: creación, envío, decisión, entrega de fondos y cierre.
type StepState = 'done' | 'current' | 'failed' | 'todo';

const steps = computed(() => {
  const request = detail.value;
  if (!request) return [];
  const rejected = request.status === 'REJECTED';
  const cancelled = request.status === 'CANCELLED';
  const delivered = request.status === 'CLOSED' || readyToClose.value;
  const list: { label: string; when: string; state: StepState }[] = [
    { label: 'Creada', when: formatDateTime(request.createdAt), state: 'done' },
    { label: 'Enviada', when: formatDateTime(request.submittedAt), state: request.submittedAt ? 'done' : 'todo' },
    {
      label: rejected ? 'Rechazada' : 'Aprobada',
      when: formatDateTime(request.decidedAt),
      state: rejected ? 'failed' : request.decidedAt ? 'done' : 'todo',
    },
    {
      label: 'Entrega de fondos',
      when: request.paidCents > 0 ? `${formatUsd(request.paidCents)} de ${formatUsd(request.requestedCents)}` : '',
      state: delivered ? 'done' : 'todo',
    },
    {
      label: cancelled ? 'Cancelada' : 'Cerrada',
      when: formatDateTime(request.closedAt ?? request.cancelledAt),
      state: cancelled ? 'failed' : request.status === 'CLOSED' ? 'done' : 'todo',
    },
  ];
  // El paso en curso es el primero sin completar, mientras la solicitud siga abierta.
  if (!rejected && !cancelled) {
    const current = list.find((step) => step.state === 'todo');
    if (current) current.state = 'current';
  }
  return list;
});

// Qué falta para avanzar y quién debe hacerlo.
const nextStep = computed(() => {
  const request = detail.value;
  if (!request) return null;
  const pendingText = formatUsd(request.outstandingCents);
  switch (request.status) {
    case 'DRAFT':
      return canCreate.value
        ? { tone: '', eyebrow: 'Siguiente paso', title: 'Enviar la solicitud al Receptor', detail: 'Mientras sea borrador, nadie más la ve.' }
        : { tone: 'waiting', eyebrow: 'En preparación', title: 'El Generador todavía no la envía', detail: '' };
    case 'SUBMITTED':
      return canDecide.value
        ? { tone: '', eyebrow: 'Siguiente paso', title: 'Aprobar o rechazar', detail: 'Revisa las personas y los montos antes de decidir.' }
        : { tone: 'waiting', eyebrow: 'Esperando', title: 'Esperando la decisión del Receptor de Nómina', detail: '' };
    case 'APPROVED':
      if (readyToClose.value) {
        return {
          tone: 'done',
          eyebrow: 'Pagada por completo',
          title: canRegister.value ? 'Falta cerrar la solicitud para terminar el ciclo' : 'Falta que el Receptor la cierre',
          detail: '',
        };
      }
      return canRegister.value
        ? {
            tone: '',
            eyebrow: 'Siguiente paso',
            title: `Entregar ${pendingText} pendientes`,
            detail: 'Ajusta los montos en la tabla de personas y registra la entrega. Puede ser parcial.',
          }
        : { tone: 'waiting', eyebrow: 'Esperando', title: 'El Receptor está entregando los fondos', detail: `Pendiente ${pendingText}.` };
    case 'REJECTED':
      return {
        tone: 'failed',
        eyebrow: 'Rechazada',
        title: request.decisionNote ?? 'Sin motivo',
        detail: 'La deuda vuelve a estar disponible para otra solicitud.',
      };
    case 'CANCELLED':
      return { tone: 'waiting', eyebrow: 'Cancelada', title: 'La deuda volvió a quedar disponible para otra solicitud', detail: '' };
    case 'CLOSED':
      return {
        tone: 'done',
        eyebrow: 'Ciclo terminado',
        title: `Cerrada por ${request.closedBy?.name ?? 'el Receptor'}`,
        detail: request.closingNote ?? 'Un pago se corrige anulándolo con un motivo.',
      };
  }
  return null;
});

const paymentsTable = ref<HTMLElement | null>(null);

function goToPayments() {
  paymentsTable.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  paymentsTable.value?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
}

onMounted(async () => {
  await load();
  await loadDetail(detailId.value);
});
</script>

<template>
  <AppModal :open="formOpen" title="Nueva solicitud" @close="formOpen = false">
    <form class="form-grid" @submit.prevent="save">
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
        <button type="button" class="button" @click="formOpen = false">Cancelar</button>
        <button type="submit" class="button button-primary" :disabled="saving">Crear</button>
      </div>
    </form>
  </AppModal>

  <template v-if="detail">
    <nav aria-label="Ruta">
      <ol class="crumbs">
        <li>
          <RouterLink :to="{ name: 'payment-requests', query: listQuery }">
            <AppIcon name="back" :size="14" /> Solicitudes de pago
          </RouterLink>
        </li>
        <li><span aria-current="page">#{{ detail.id }}</span></li>
      </ol>
    </nav>

    <div class="detail-head">
      <div>
        <h1>
          Solicitud #{{ detail.id }}
          <StatusBadge :label="REQUEST_STATUS_LABELS[detail.status]" :tone="REQUEST_STATUS_TONES[detail.status]" />
        </h1>
        <p class="hint">
          {{ detail.project.code }} · {{ detail.project.name }} · creada por {{ detail.createdBy?.name }}
          <template v-if="detail.notes"> · Notas: {{ detail.notes }}</template>
        </p>
      </div>
      <a v-if="canReport" class="button" :href="paymentRequestPdfUrl(detail.id)" target="_blank" rel="noopener">
        <AppIcon name="file" :size="16" /> Solicitud consolidada PDF
      </a>
    </div>

    <section class="card" aria-label="Ciclo de la solicitud">
      <ol class="steps">
        <li
          v-for="(step, index) in steps"
          :key="step.label"
          class="step"
          :class="`step-${step.state}`"
          :aria-current="step.state === 'current' ? 'step' : undefined"
        >
          <span class="step-bullet" aria-hidden="true">
            <AppIcon v-if="step.state === 'done'" name="check" :size="14" />
            <AppIcon v-else-if="step.state === 'failed'" name="close" :size="14" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <strong>{{ step.label }}</strong>
          <span>{{ step.when || '—' }}</span>
        </li>
      </ol>
      <p class="section-gap">
        Solicitado <strong>{{ formatUsd(detail.requestedCents) }}</strong> · Pagado
        <strong>{{ formatUsd(detail.paidCents) }}</strong> · Pendiente <strong>{{ formatUsd(detail.outstandingCents) }}</strong>
      </p>
    </section>

    <section v-if="nextStep" class="next-step" :class="nextStep.tone && `next-step-${nextStep.tone}`" aria-live="polite">
      <div class="next-step-text">
        <span class="eyebrow">{{ nextStep.eyebrow }}</span>
        <strong>{{ nextStep.title }}</strong>
        <span v-if="nextStep.detail" class="next-step-detail">{{ nextStep.detail }}</span>
      </div>
      <div class="actions">
        <template v-if="canCreate">
          <button
            v-if="detail.status === 'DRAFT' || detail.status === 'SUBMITTED'"
            type="button"
            class="button button-danger"
            :disabled="busy"
            @click="prompt = { kind: 'cancel', text: '' }"
          >
            Cancelar solicitud
          </button>
          <button
            v-if="detail.status === 'DRAFT'"
            type="button"
            class="button button-primary"
            :disabled="busy"
            @click="submitRequest"
          >
            <AppIcon name="send" :size="16" /> Enviar
          </button>
        </template>
        <template v-if="canDecide && detail.status === 'SUBMITTED'">
          <button type="button" class="button button-danger" @click="prompt = { kind: 'reject', text: '' }">Rechazar</button>
          <button type="button" class="button button-primary" @click="prompt = { kind: 'approve', text: '' }">Aprobar</button>
        </template>
        <template v-if="canRegister && detail.status === 'APPROVED'">
          <button
            type="button"
            :class="['button', { 'button-primary': readyToClose }]"
            @click="prompt = { kind: 'close', text: '' }"
          >
            {{ readyToClose ? 'Cerrar solicitud' : 'Cerrar con saldo' }}
          </button>
          <button v-if="!readyToClose" type="button" class="button button-primary" @click="goToPayments">Ir a entregar</button>
        </template>
      </div>
    </section>

    <p v-if="detail.decisionNote && detail.status !== 'REJECTED'" class="hint">Nota de la decisión: {{ detail.decisionNote }}</p>

    <AppModal
      :open="Boolean(prompt)"
      :title="
        prompt
          ? prompt.kind === 'annul'
            ? `${PROMPT_TITLES[prompt.kind]} · recibo #${prompt.payment.id} (${prompt.payment.person.name})`
            : `${PROMPT_TITLES[prompt.kind]} #${detail.id}`
          : ''
      "
      @close="prompt = null"
    >
      <form v-if="prompt" class="form-grid" @submit.prevent="confirmPrompt">
        <p v-if="prompt.kind === 'annul'" class="hint">
          El recibo no se borra: queda anulado y sus {{ formatUsd(prompt.payment.amountCents) }} vuelven a estar pendientes.
        </p>
        <p v-else-if="prompt.kind === 'cancel'" class="hint">
          La deuda de {{ detail.project.code }} ({{ formatUsd(detail.requestedCents) }}) queda libre para incluirse en otra solicitud.
        </p>
        <p v-else-if="prompt.kind === 'reject'" class="hint">El Generador verá tu motivo y la deuda vuelve a quedar disponible.</p>
        <p v-else-if="prompt.kind === 'approve'" class="hint">
          {{ detail.people.length }} personas · {{ formatUsd(detail.requestedCents) }}. Después se registran las entregas, completas o
          parciales.
        </p>
        <label v-if="prompt.kind !== 'cancel'" class="field">
          {{ promptRequiresText ? 'Motivo' : 'Nota (opcional)' }}
          <input v-model="prompt.text" :required="promptRequiresText" :minlength="promptRequiresText ? 5 : undefined" maxlength="500" />
          <span v-if="prompt.kind === 'close' && detail.outstandingCents > 0" class="hint">
            Los {{ formatUsd(detail.outstandingCents) }} pendientes vuelven a la deuda y podrán incluirse en otra solicitud.
          </span>
        </label>
        <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
        <div class="actions">
          <button type="button" class="button" @click="prompt = null">Volver</button>
          <button
            type="submit"
            class="button"
            :class="promptIsDestructive ? 'button-danger-solid' : 'button-primary'"
            :disabled="busy"
          >
            {{ PROMPT_CONFIRM[prompt.kind] }}
          </button>
        </div>
      </form>
    </AppModal>

    <p v-if="detailError" ref="detailErrorEl" class="error section-gap" role="alert">{{ detailError }}</p>

    <section ref="paymentsTable" class="card section-gap">
      <h2>Personas</h2>
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
            <p class="pay-total">
              A entregar ahora
              <strong>{{ formatUsd(paymentTotal) }}</strong>
            </p>
            <button type="submit" class="button button-primary" :disabled="busy || paymentTotal === 0">Registrar entrega</button>
          </div>
        </div>
      </form>
    </section>

    <section class="card">
      <h2>Pagos (recibos)</h2>
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
                  class="button button-danger"
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

    <details class="card fold">
      <summary>
        <AppIcon name="chevron" />
        Detalle por causación
        <span class="hint">{{ detail.items.length }} causaciones · primero la deuda más antigua</span>
      </summary>
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
    </details>
  </template>

  <template v-else>
    <div class="page-header">
      <h1>Solicitudes de pago</h1>
      <button v-if="canCreate" type="button" class="button button-primary" @click="openCreate">Nueva solicitud</button>
    </div>
    <p class="hint">
      Creación → envío → aprobación o rechazo → entrega de fondos → cierre. Los pagos pueden ser parciales y se aplican
      primero a la deuda más antigua.
    </p>
    <p v-if="listNotice" class="notice notice-success section-gap" role="status">{{ listNotice }}</p>

    <div class="filter-bar">
      <div class="chips" role="group" aria-label="Estado">
        <button
          v-for="key in filterKeys"
          :key="key"
          type="button"
          class="chip"
          :class="{ 'chip-mine': key === 'mine' }"
          :aria-pressed="statusFilter === key"
          @click="setStatusFilter(key)"
        >
          {{ STATUS_FILTERS[key].label }}
          <span class="chip-count">{{ filterCount(key) }}</span>
        </button>
      </div>
      <label class="field">
        Proyecto
        <select v-model.number="filters.projectId">
          <option :value="0">Todos</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
        </select>
      </label>
    </div>

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
          <tr v-for="request in filteredRequests" :key="request.id">
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
              <RouterLink class="button" :to="{ name: 'payment-requests', query: { ...route.query, id: request.id } }">Ver</RouterLink>
            </td>
          </tr>
          <tr v-if="filteredRequests.length === 0">
            <td colspan="9">
              No hay solicitudes con esos filtros.
              <button v-if="statusFilter !== 'all'" type="button" class="button" @click="setStatusFilter('all')">Ver todas</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>
