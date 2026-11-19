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
  submitPaymentRequest,
  type Payment,
  type PaymentRequestDetail,
  type PaymentRequestSummary,
} from '@/api/payment-requests';
import { listProjects, type Project } from '@/api/projects';
import { getBalances, paymentRequestPdfUrl, receiptPdfUrl } from '@/api/reports';
import AppIcon from '@/components/AppIcon.vue';
import AppModal from '@/components/AppModal.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatDate, formatDateTime, formatRange } from '@/lib/dates';
import { centsToInput, formatUsd, MONEY_EXAMPLE, parseUsd } from '@/lib/money';
import { REQUEST_STATUS_TONES } from '@/lib/status';
import { notify } from '@/lib/toast';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { usePendingStore } from '@/stores/pending';

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

const isOpen = (request: PaymentRequestSummary) => ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(request.status);

// ---------- Lista: tres pestañas en lugar de nueve filtros ----------
// Las claves antiguas (?estado=SUBMITTED…) siguen funcionando porque Inicio enlaza con ellas.
type StatusFilter = { label: string; test: (request: PaymentRequestSummary) => boolean };
const STATUS_FILTERS: Record<string, StatusFilter> = {
  mine: { label: 'Me toca a mí', test: (request) => pending.needsAction(request) },
  open: { label: 'En proceso', test: isOpen },
  done: { label: 'Ya terminadas', test: (request) => !isOpen(request) },
  all: { label: 'Todas', test: () => true },
  DRAFT: { label: 'Por enviar', test: (request) => request.status === 'DRAFT' },
  SUBMITTED: { label: 'Esperando respuesta', test: (request) => request.status === 'SUBMITTED' },
  TO_PAY: { label: 'Falta entregar dinero', test: (request) => request.status === 'APPROVED' && request.outstandingCents > 0 },
  TO_CLOSE: { label: 'Falta cerrar', test: (request) => request.status === 'APPROVED' && request.outstandingCents === 0 },
};
const hasOwnStep = computed(() => canCreate.value || canDecide.value);
const mainTabs = computed(() => ['mine', 'open', 'done'].filter((key) => key !== 'mine' || hasOwnStep.value));

const statusFilter = computed(() => {
  const value = String(route.query.estado ?? '');
  if (value in STATUS_FILTERS && (value !== 'mine' || hasOwnStep.value)) return value;
  return hasOwnStep.value ? 'mine' : 'open';
});
// Si llegan desde un enlace antiguo, se muestra esa pestaña extra además de las tres principales.
const visibleTabs = computed(() => (mainTabs.value.includes(statusFilter.value) ? mainTabs.value : [...mainTabs.value, statusFilter.value]));

function setStatusFilter(key: string) {
  void router.replace({ query: { ...route.query, estado: key } });
}

const filteredRequests = computed(() => requests.value.filter(STATUS_FILTERS[statusFilter.value].test));
const filterCount = (key: string) => requests.value.filter(STATUS_FILTERS[key].test).length;

// Qué le pasa a cada solicitud, dicho en una frase, y qué le toca hacer a quien mira.
type Plain = { tone: 'todo' | 'wait' | 'ok' | 'bad'; text: string; action: string };
function plain(request: PaymentRequestSummary): Plain {
  const pendingText = formatUsd(request.outstandingCents);
  switch (request.status) {
    case 'DRAFT':
      return canCreate.value
        ? { tone: 'todo', text: 'Todavía no se ha enviado. Revísala y envíala al Receptor.', action: 'Revisar y enviar' }
        : { tone: 'wait', text: 'Se está preparando. Todavía no se envía.', action: 'Ver' };
    case 'SUBMITTED':
      return canDecide.value
        ? { tone: 'todo', text: 'Espera tu respuesta: apruébala o recházala.', action: 'Revisar y responder' }
        : { tone: 'wait', text: 'Enviada. Esperando que el Receptor responda.', action: 'Ver' };
    case 'APPROVED':
      if (request.outstandingCents === 0) {
        return canRegister.value
          ? { tone: 'todo', text: 'Ya se entregó todo el dinero. Solo falta cerrarla.', action: 'Cerrar solicitud' }
          : { tone: 'wait', text: 'Ya se entregó todo el dinero. Falta que el Receptor la cierre.', action: 'Ver' };
      }
      return canRegister.value
        ? { tone: 'todo', text: `Aprobada. Falta entregar ${pendingText}.`, action: 'Entregar dinero' }
        : { tone: 'wait', text: `Aprobada. El Receptor está entregando el dinero (faltan ${pendingText}).`, action: 'Ver' };
    case 'CLOSED':
      return {
        tone: 'ok',
        text: request.outstandingCents > 0 ? `Terminada. Quedaron ${pendingText} sin entregar; siguen como deuda.` : 'Terminada. Todo el dinero fue entregado.',
        action: 'Ver',
      };
    case 'REJECTED':
      return { tone: 'bad', text: 'Rechazada. La deuda quedó libre para pedirla otra vez.', action: 'Ver' };
    case 'CANCELLED':
      return { tone: 'bad', text: 'Retirada. La deuda quedó libre para pedirla otra vez.', action: 'Ver' };
  }
}

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

// ---------- Pedir dinero (nueva solicitud) ----------
const formOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const form = reactive({ projectId: 0, notes: '' });
const owedByProject = ref<Record<number, number>>({});

// Lo que realmente se puede pedir de un proyecto: lo que se debe menos lo que ya está en solicitudes abiertas.
async function loadAvailable() {
  try {
    const [report, all] = await Promise.all([getBalances('project', {}), listPaymentRequests()]);
    const inOpen: Record<number, number> = {};
    for (const request of all.filter(isOpen)) inOpen[request.project.id] = (inOpen[request.project.id] ?? 0) + request.outstandingCents;
    const result: Record<number, number> = {};
    for (const row of report.rows) if (row.project) result[row.project.id] = Math.max(0, row.owedCents - (inOpen[row.project.id] ?? 0));
    owedByProject.value = result;
  } catch {
    owedByProject.value = {};
  }
}

const availableOf = (projectId: number) => owedByProject.value[projectId];
const projectsWithDebt = computed(() => projects.value.filter((project) => project.active));
const askedAmount = computed(() => (form.projectId ? availableOf(form.projectId) : undefined));

async function openCreate() {
  Object.assign(form, { projectId: filters.projectId, notes: '' });
  formError.value = '';
  formOpen.value = true;
  await loadAvailable();
}

async function save() {
  formError.value = '';
  if (!form.projectId) {
    formError.value = 'Elige primero el proyecto para el que vas a pedir el dinero.';
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
    notify(`Listo: se creó la solicitud #${created.id} por ${formatUsd(created.requestedCents)}. Todavía no se ha enviado: revísala y envíala.`);
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// ---------- Detalle ----------
const detail = ref<PaymentRequestDetail | null>(null);
const detailError = ref('');
const busy = ref(false);
const paymentForm = reactive({ paidOn: today, reference: '', amounts: {} as Record<number, string> });
const rowErrors = reactive<Record<number, string>>({});

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
  dialog.value = null;
  paymentForm.paidOn = today;
  paymentForm.reference = '';
  // Los campos empiezan vacíos: nadie paga sin escribir o pulsar "Todo" a propósito.
  paymentForm.amounts = Object.fromEntries(request.people.map((entry) => [entry.person.id, '']));
  for (const key of Object.keys(rowErrors)) delete rowErrors[Number(key)];
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

async function run(action: () => Promise<PaymentRequestDetail>, success?: (result: PaymentRequestDetail) => void) {
  detailError.value = '';
  busy.value = true;
  try {
    const result = await action();
    showDetail(result);
    await loadRequests();
    void pending.refresh();
    success?.(result);
  } catch (e) {
    detailError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const readyToClose = computed(() => detail.value?.status === 'APPROVED' && detail.value.outstandingCents === 0);
const canPay = computed(() => canRegister.value && detail.value?.status === 'APPROVED' && detail.value.outstandingCents > 0);

// ---------- Entrega de dinero ----------
function fillAll(personId: number, outstandingCents: number) {
  paymentForm.amounts[personId] = centsToInput(outstandingCents);
  delete rowErrors[personId];
}

function fillEveryone() {
  for (const entry of detail.value?.people ?? []) if (entry.outstandingCents > 0) fillAll(entry.person.id, entry.outstandingCents);
}

function clearAmounts() {
  for (const key of Object.keys(paymentForm.amounts)) paymentForm.amounts[Number(key)] = '';
  for (const key of Object.keys(rowErrors)) delete rowErrors[Number(key)];
}

// Lo que se entregaría con lo escrito, ya validado persona por persona.
const planned = computed(() => {
  const rows: { personId: number; name: string; amountCents: number; outstandingCents: number }[] = [];
  for (const entry of detail.value?.people ?? []) {
    const text = (paymentForm.amounts[entry.person.id] ?? '').trim();
    if (!text) continue;
    const amountCents = parseUsd(text);
    if (amountCents && amountCents > 0) {
      rows.push({ personId: entry.person.id, name: entry.person.name, amountCents, outstandingCents: entry.outstandingCents });
    }
  }
  return rows;
});
const plannedTotal = computed(() => planned.value.reduce((sum, row) => sum + row.amountCents, 0));

function validateAmounts() {
  for (const key of Object.keys(rowErrors)) delete rowErrors[Number(key)];
  let valid = true;
  for (const entry of detail.value?.people ?? []) {
    const text = (paymentForm.amounts[entry.person.id] ?? '').trim();
    if (!text) continue;
    const cents = parseUsd(text);
    if (cents === null || cents <= 0) {
      rowErrors[entry.person.id] = `Escribe solo el monto con números. ${MONEY_EXAMPLE}.`;
      valid = false;
    } else if (cents > entry.outstandingCents) {
      rowErrors[entry.person.id] = `A ${entry.person.name} solo se le debe ${formatUsd(entry.outstandingCents)}. Escribe ese monto o uno menor.`;
      valid = false;
    }
  }
  if (valid && planned.value.length === 0) {
    detailError.value = 'Escribe cuánto dinero le vas a entregar a al menos una persona, o pulsa «Todo» en su fila.';
    valid = false;
  }
  return valid;
}

function askToDeliver() {
  detailError.value = '';
  if (!validateAmounts()) return;
  dialog.value = { kind: 'deliver', text: '' };
}

async function deliver() {
  if (!detail.value) return;
  const request = detail.value;
  const knownReceipts = new Set(request.payments.map((payment) => payment.id));
  const payments = planned.value.map(({ personId, amountCents }) => ({ personId, amountCents }));
  await run(
    () => registerPayments(request.id, { paidOn: paymentForm.paidOn, reference: paymentForm.reference || null, payments }),
    (result) => {
      const created = result.payments.filter((payment) => !knownReceipts.has(payment.id));
      const link = created.length === 1 && canReport.value ? { label: 'Ver recibo', href: receiptPdfUrl(created[0].id) } : undefined;
      const rest = result.outstandingCents > 0 ? `Todavía faltan ${formatUsd(result.outstandingCents)} por entregar.` : 'Ya se entregó todo: falta cerrar la solicitud.';
      notify(`Listo: se registró la entrega de ${formatUsd(plannedTotal.value)}. ${rest}`, { action: link, seconds: 14 });
    },
  );
}

// ---------- Diálogos de confirmación ----------
type Dialog =
  | { kind: 'send' | 'approve' | 'reject' | 'close' | 'cancel' | 'deliver'; text: string }
  | { kind: 'annul'; payment: Payment; text: string };
const dialog = ref<Dialog | null>(null);

const closeNeedsReason = computed(() => (detail.value?.outstandingCents ?? 0) > 0);
const dialogTitle = computed(() => {
  const current = dialog.value;
  const request = detail.value;
  if (!current || !request) return '';
  return {
    send: `¿Enviar la solicitud #${request.id}?`,
    approve: `¿Aprobar la solicitud #${request.id}?`,
    reject: `¿Rechazar la solicitud #${request.id}?`,
    close: `¿Cerrar la solicitud #${request.id}?`,
    cancel: `¿Retirar la solicitud #${request.id}?`,
    deliver: '¿Entregar este dinero?',
    annul: `¿Anular el recibo #${current.kind === 'annul' ? current.payment.id : ''}?`,
  }[current.kind];
});
const dialogConfirm = computed(() => {
  const kind = dialog.value?.kind;
  return kind
    ? { send: 'Sí, enviar', approve: 'Sí, aprobar', reject: 'Sí, rechazar', close: 'Sí, cerrar', cancel: 'Sí, retirar', deliver: 'Sí, registrar la entrega', annul: 'Sí, anular el recibo' }[kind]
    : '';
});
const dialogDanger = computed(() => ['reject', 'cancel', 'annul'].includes(dialog.value?.kind ?? '') || (dialog.value?.kind === 'close' && closeNeedsReason.value));
const dialogReason = computed(() => {
  const kind = dialog.value?.kind;
  if (kind === 'reject') return { label: '¿Por qué la rechazas? (el Generador lo verá)', hint: 'Ej.: Los montos no coinciden con lo acordado', required: true };
  if (kind === 'annul') return { label: '¿Por qué se anula este recibo?', hint: 'Ej.: Se registró a la persona equivocada', required: true };
  if (kind === 'close' && closeNeedsReason.value) return { label: '¿Por qué se cierra sin entregar todo?', hint: 'Ej.: El resto se paga el próximo mes', required: true };
  if (kind === 'approve' || kind === 'close') return { label: 'Nota (si quieres dejar alguna)', hint: '', required: false };
  return null;
});

async function confirmDialog() {
  const current = dialog.value;
  const request = detail.value;
  if (!current || !request) return;
  const text = current.text.trim() || null;

  if (current.kind === 'deliver') return deliver();
  if (current.kind === 'send') {
    // Enviar cierra el trabajo del Generador sobre la solicitud: se vuelve a la lista con un aviso.
    return run(
      () => submitPaymentRequest(request.id),
      async () => {
        notify(`Listo: la solicitud #${request.id} fue enviada al Receptor. Ahora hay que esperar su respuesta.`);
        await router.push({ name: 'payment-requests', query: listQuery.value });
      },
    );
  }
  if (current.kind === 'approve') return run(() => approvePaymentRequest(request.id, text), () => notify(`Listo: aprobaste la solicitud #${request.id}. Ahora puedes entregar el dinero.`));
  if (current.kind === 'reject') return run(() => rejectPaymentRequest(request.id, text ?? ''), () => notify(`Se rechazó la solicitud #${request.id}. El Generador verá tu motivo.`, { tone: 'info' }));
  if (current.kind === 'close') return run(() => closePaymentRequest(request.id, text), () => notify(`Listo: la solicitud #${request.id} quedó cerrada.`));
  if (current.kind === 'cancel') return run(() => cancelPaymentRequest(request.id), () => notify(`Se retiró la solicitud #${request.id}. La deuda quedó libre para pedirla otra vez.`, { tone: 'info' }));

  if (current.kind !== 'annul') return;
  const payment = current.payment;
  detailError.value = '';
  busy.value = true;
  try {
    await annulPayment(payment.id, text ?? '');
    showDetail(await getPaymentRequest(request.id));
    await loadRequests();
    void pending.refresh();
    notify(`Se anuló el recibo #${payment.id}. Los ${formatUsd(payment.amountCents)} vuelven a quedar pendientes.`, { tone: 'info' });
  } catch (e) {
    detailError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

// ---------- Resumen del estado de la solicitud abierta ----------
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
      label: 'Dinero entregado',
      when: request.paidCents > 0 ? `${formatUsd(request.paidCents)} de ${formatUsd(request.requestedCents)}` : '',
      state: delivered ? 'done' : 'todo',
    },
    {
      label: cancelled ? 'Retirada' : 'Cerrada',
      when: formatDateTime(request.closedAt ?? request.cancelledAt),
      state: cancelled ? 'failed' : request.status === 'CLOSED' ? 'done' : 'todo',
    },
  ];
  if (!rejected && !cancelled) {
    const current = list.find((step) => step.state === 'todo');
    if (current) current.state = 'current';
  }
  return list;
});

// El mensaje grande de arriba: qué está pasando y qué toca hacer.
const HERO_TONE = { todo: '', wait: 'waiting', ok: 'done', bad: 'failed' } as const;
const HERO_EYEBROW = { todo: 'Siguiente paso', wait: 'Esperando', ok: 'Terminada', bad: 'No se pagó' } as const;

function statusLabel(request: PaymentRequestSummary) {
  switch (request.status) {
    case 'DRAFT':
      return 'Por enviar';
    case 'SUBMITTED':
      return 'Enviada';
    case 'APPROVED':
      return request.outstandingCents === 0 ? 'Falta cerrar' : 'Falta entregar dinero';
    case 'CLOSED':
      return 'Terminada';
    case 'REJECTED':
      return 'Rechazada';
    case 'CANCELLED':
      return 'Retirada';
  }
}

const hero = computed(() => {
  const base = heroBase.value;
  return base ? { ...base, eyebrow: HERO_EYEBROW[base.tone as keyof typeof HERO_EYEBROW], tone: HERO_TONE[base.tone as keyof typeof HERO_TONE] } : null;
});

const heroBase = computed(() => {
  const request = detail.value;
  if (!request) return null;
  const pendingText = formatUsd(request.outstandingCents);
  const people = `${request.people.length} ${request.people.length === 1 ? 'persona' : 'personas'}`;
  switch (request.status) {
    case 'DRAFT':
      return canCreate.value
        ? { tone: 'todo', title: 'Falta enviarla', text: `Esta solicitud pide ${formatUsd(request.requestedCents)} para ${people}. Revisa que estén bien las personas y los montos; luego pulsa «Enviar al Receptor».` }
        : { tone: 'wait', title: 'Todavía se está preparando', text: 'El Generador aún no la ha enviado.' };
    case 'SUBMITTED':
      return canDecide.value
        ? { tone: 'todo', title: 'Espera tu respuesta', text: `Piden ${formatUsd(request.requestedCents)} para ${people}. Revisa la lista de abajo y elige si la apruebas o la rechazas.` }
        : { tone: 'wait', title: 'Esperando al Receptor', text: 'Ya la enviaste. No tienes que hacer nada más: el Receptor la va a aprobar o rechazar.' };
    case 'APPROVED':
      if (readyToClose.value) {
        return canRegister.value
          ? { tone: 'todo', title: 'Ya se entregó todo el dinero', text: 'Solo falta cerrar la solicitud para terminarla.' }
          : { tone: 'wait', title: 'Ya se entregó todo el dinero', text: 'Falta que el Receptor cierre la solicitud.' };
      }
      return canRegister.value
        ? { tone: 'todo', title: `Falta entregar ${pendingText}`, text: 'Escribe abajo cuánto le entregas a cada persona. Puedes entregar menos de lo que se le debe: lo que falte queda pendiente.' }
        : { tone: 'wait', title: 'El Receptor está entregando el dinero', text: `Todavía faltan ${pendingText} por entregar.` };
    case 'REJECTED':
      return { tone: 'bad', title: 'Fue rechazada', text: `${request.decisionNote ?? 'Sin motivo.'} La deuda quedó libre para pedirla otra vez.` };
    case 'CANCELLED':
      return { tone: 'bad', title: 'Fue retirada', text: 'La deuda quedó libre para pedirla otra vez.' };
    case 'CLOSED':
      return {
        tone: 'ok',
        title: 'Solicitud terminada',
        text:
          request.outstandingCents > 0
            ? `Se cerró con ${pendingText} sin entregar${request.closingNote ? `: ${request.closingNote}` : ''}. Ese dinero sigue como deuda y se puede pedir en otra solicitud.`
            : 'Se entregó todo el dinero. No hay nada más que hacer.',
      };
  }
  return null;
});

const paymentsTable = ref<HTMLElement | null>(null);
function goToPayments() {
  paymentsTable.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  paymentsTable.value?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
}

const detailErrorEl = ref<HTMLElement | null>(null);
watch(detailError, async (value) => {
  if (!value || dialog.value) return;
  await nextTick();
  detailErrorEl.value?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

onMounted(async () => {
  await load();
  await loadDetail(detailId.value);
});
</script>

<template>
  <!-- Pedir dinero -->
  <AppModal :open="formOpen" title="Pedir dinero para un proyecto" @close="formOpen = false">
    <form class="form-grid" @submit.prevent="save">
      <p class="hint">
        Se pide todo lo que se les debe a las personas del proyecto y que todavía no esté en otra solicitud. Primero queda como borrador: tú
        decides cuándo enviarla.
      </p>
      <label class="field">
        Proyecto
        <select v-model.number="form.projectId" required>
          <option :value="0" disabled>Elige un proyecto</option>
          <option
            v-for="project in projectsWithDebt"
            :key="project.id"
            :value="project.id"
            :disabled="availableOf(project.id) !== undefined && availableOf(project.id) <= 0"
          >
            {{ project.code }} · {{ project.name }}
            <template v-if="availableOf(project.id) !== undefined">
              {{ availableOf(project.id) > 0 ? ` — se pueden pedir ${formatUsd(availableOf(project.id))}` : ' — nada por pedir' }}
            </template>
          </option>
        </select>
      </label>
      <p v-if="askedAmount !== undefined && form.projectId" class="amount-preview">
        <template v-if="askedAmount > 0">
          Se pedirán <strong>{{ formatUsd(askedAmount) }}</strong>
        </template>
        <template v-else>Este proyecto no tiene nada por pedir ahora. Elige otro.</template>
      </p>
      <label class="field">
        Nota para el Receptor (opcional)
        <input v-model="form.notes" maxlength="500" placeholder="Ej.: Pago de la quincena de octubre" />
      </label>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="confirm-actions">
        <button type="button" class="button" @click="formOpen = false">Volver</button>
        <button type="submit" class="button button-primary" :disabled="saving || (askedAmount !== undefined && askedAmount <= 0)">
          {{ saving ? 'Un momento…' : 'Crear solicitud' }}
        </button>
      </div>
    </form>
  </AppModal>

  <!-- DETALLE -->
  <template v-if="detail && hero">
    <nav aria-label="Ruta">
      <ol class="crumbs">
        <li>
          <RouterLink :to="{ name: 'payment-requests', query: listQuery }"><AppIcon name="back" :size="14" /> Solicitudes de pago</RouterLink>
        </li>
        <li><span aria-current="page">#{{ detail.id }}</span></li>
      </ol>
    </nav>

    <div class="detail-head">
      <div>
        <h1>
          Solicitud #{{ detail.id }}
          <StatusBadge :label="statusLabel(detail)" :tone="REQUEST_STATUS_TONES[detail.status]" />
        </h1>
        <p class="hint">
          {{ detail.project.code }} · {{ detail.project.name }} · creada por {{ detail.createdBy?.name }}
          <template v-if="detail.notes"> · Nota: {{ detail.notes }}</template>
        </p>
      </div>
      <a v-if="canReport" class="button" :href="paymentRequestPdfUrl(detail.id)" target="_blank" rel="noopener">
        <AppIcon name="file" :size="16" /> Resumen en PDF
      </a>
    </div>

    <section class="next-step" :class="hero.tone && `next-step-${hero.tone}`" aria-live="polite">
      <div class="next-step-text">
        <span class="eyebrow">{{ hero.eyebrow }}</span>
        <strong>{{ hero.title }}</strong>
        <span class="next-step-detail">{{ hero.text }}</span>
      </div>
      <div class="actions">
        <button v-if="canCreate && detail.status === 'DRAFT'" type="button" class="button button-primary" :disabled="busy" @click="dialog = { kind: 'send', text: '' }">
          <AppIcon name="send" :size="16" /> Enviar al Receptor
        </button>
        <template v-if="canDecide && detail.status === 'SUBMITTED'">
          <button type="button" class="button" :disabled="busy" @click="dialog = { kind: 'reject', text: '' }">Rechazar</button>
          <button type="button" class="button button-primary" :disabled="busy" @click="dialog = { kind: 'approve', text: '' }">Aprobar</button>
        </template>
        <button v-if="canPay" type="button" class="button button-primary" @click="goToPayments">Entregar dinero</button>
        <button v-if="canRegister && readyToClose" type="button" class="button button-primary" :disabled="busy" @click="dialog = { kind: 'close', text: '' }">
          Cerrar solicitud
        </button>
      </div>
    </section>

    <section class="card" aria-label="Avance de la solicitud">
      <ol class="steps">
        <li v-for="(step, index) in steps" :key="step.label" class="step" :class="`step-${step.state}`" :aria-current="step.state === 'current' ? 'step' : undefined">
          <span class="step-bullet" aria-hidden="true">
            <AppIcon v-if="step.state === 'done'" name="check" :size="14" />
            <AppIcon v-else-if="step.state === 'failed'" name="close" :size="14" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <strong>{{ step.label }}</strong>
          <span>{{ step.when || '—' }}</span>
        </li>
      </ol>
      <dl class="summary-grid section-gap">
        <div>
          <dt>Se pidió</dt>
          <dd>{{ formatUsd(detail.requestedCents) }}</dd>
        </div>
        <div>
          <dt>Ya se entregó</dt>
          <dd>{{ formatUsd(detail.paidCents) }}</dd>
        </div>
        <div>
          <dt>Falta entregar</dt>
          <dd>{{ formatUsd(detail.outstandingCents) }}</dd>
        </div>
      </dl>
    </section>

    <p v-if="detail.decisionNote && detail.status !== 'REJECTED'" class="hint">Nota de la decisión: {{ detail.decisionNote }}</p>
    <p v-if="detailError && !dialog" ref="detailErrorEl" class="error section-gap" role="alert">{{ detailError }}</p>

    <!-- Personas / entrega de dinero -->
    <section ref="paymentsTable" class="card">
      <div class="page-header">
        <h2>{{ canPay ? 'Entrega del dinero' : 'Personas' }}</h2>
        <div v-if="canPay" class="actions">
          <button type="button" class="button" @click="fillEveryone">Llenar con lo que se debe</button>
          <button type="button" class="button" :disabled="plannedTotal === 0" @click="clearAmounts">Borrar</button>
        </div>
      </div>
      <p v-if="canPay" class="hint">
        Escribe cuánto le entregas a cada persona, o pulsa «Todo». Puede ser menos de lo que se le debe. Si dejas un campo vacío, a esa persona no
        se le entrega nada ahora.
      </p>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col" class="num">Se pidió</th>
              <th scope="col" class="num">Ya recibió</th>
              <th scope="col" class="num">Se le debe</th>
              <th v-if="canPay" scope="col">Entregar ahora (USD)</th>
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
              <td v-if="canPay">
                <div v-if="entry.outstandingCents > 0" class="pay-cell">
                  <div class="pay-cell-row">
                    <span class="money-input">
                      <span aria-hidden="true">USD</span>
                      <input
                        v-model="paymentForm.amounts[entry.person.id]"
                        inputmode="decimal"
                        autocomplete="off"
                        placeholder="0,00"
                        :aria-label="`Cuánto se le entrega a ${entry.person.name}`"
                        :aria-invalid="Boolean(rowErrors[entry.person.id])"
                        @input="delete rowErrors[entry.person.id]"
                      />
                    </span>
                    <button type="button" class="button" @click="fillAll(entry.person.id, entry.outstandingCents)">Todo</button>
                  </div>
                  <p v-if="rowErrors[entry.person.id]" class="row-error" role="alert">{{ rowErrors[entry.person.id] }}</p>
                </div>
                <StatusBadge v-else label="Ya recibió todo" tone="success" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="canPay" class="form-row section-gap">
        <label class="field">
          Fecha de entrega
          <input v-model="paymentForm.paidOn" type="date" required :max="today" />
        </label>
        <label class="field">
          Referencia (opcional)
          <input v-model="paymentForm.reference" maxlength="120" placeholder="Ej.: Efectivo, transferencia" />
        </label>
      </div>
      <div v-if="canPay" class="deliver-bar">
        <p class="deliver-total">
          Vas a entregar <strong>{{ formatUsd(plannedTotal) }}</strong>
          <span v-if="planned.length" class="hint"> a {{ planned.length }} {{ planned.length === 1 ? 'persona' : 'personas' }}</span>
        </p>
        <button type="button" class="button button-primary" :disabled="busy || plannedTotal === 0" @click="askToDeliver">Registrar entrega…</button>
      </div>
    </section>

    <!-- Recibos -->
    <section class="card">
      <h2>Recibos de lo entregado</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Recibo</th>
              <th scope="col">Persona</th>
              <th scope="col">Fecha</th>
              <th scope="col" class="num">Monto</th>
              <th scope="col">Referencia</th>
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
              <td>
                <StatusBadge :label="payment.annulledAt ? 'Anulado' : 'Vigente'" :tone="payment.annulledAt ? 'danger' : 'success'" />
                <span v-if="payment.annulmentReason" class="permission-code">Motivo: {{ payment.annulmentReason }}</span>
              </td>
              <td v-if="canRegister || canReport">
                <div class="table-actions">
                  <a v-if="canReport" class="button" :href="receiptPdfUrl(payment.id)" target="_blank" rel="noopener">Recibo PDF</a>
                  <button v-if="canRegister && !payment.annulledAt" type="button" class="button" @click="dialog = { kind: 'annul', payment, text: '' }">Anular</button>
                </div>
              </td>
            </tr>
            <tr v-if="detail.payments.length === 0">
              <td :colspan="canRegister || canReport ? 7 : 6">Todavía no se ha entregado dinero en esta solicitud.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Acciones menos frecuentes, lejos del botón principal -->
    <section v-if="(canCreate && ['DRAFT', 'SUBMITTED'].includes(detail.status)) || (canRegister && detail.status === 'APPROVED' && !readyToClose)" class="more-actions">
      <h2>Otras opciones</h2>
      <div class="actions">
        <button v-if="canCreate && ['DRAFT', 'SUBMITTED'].includes(detail.status)" type="button" class="button button-danger" :disabled="busy" @click="dialog = { kind: 'cancel', text: '' }">
          Retirar esta solicitud
        </button>
        <button v-if="canRegister && detail.status === 'APPROVED' && !readyToClose" type="button" class="button button-danger" :disabled="busy" @click="dialog = { kind: 'close', text: '' }">
          Cerrar aunque falte dinero por entregar
        </button>
      </div>
      <p v-if="canRegister && detail.status === 'APPROVED' && !readyToClose" class="hint">
        Si ya no vas a entregar el resto, puedes cerrarla. Lo que falta sigue como deuda y se podrá pedir en otra solicitud.
      </p>
    </section>

    <details class="card fold">
      <summary>
        <AppIcon name="chevron" />
        Detalle por período
        <span class="hint">{{ detail.items.length }} {{ detail.items.length === 1 ? 'renglón' : 'renglones' }} · primero lo más antiguo</span>
      </summary>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col">Período</th>
              <th scope="col">Días trabajados</th>
              <th scope="col" class="num">Se pidió</th>
              <th scope="col" class="num">Ya recibió</th>
              <th scope="col" class="num">Se le debe</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in detail.items" :key="item.id">
              <td>{{ item.person.name }}</td>
              <td class="nowrap">{{ formatRange(item.period.startDate, item.period.endDate) }}</td>
              <td class="nowrap">{{ item.activeDays }} de {{ item.periodDays }}</td>
              <td class="num">{{ formatUsd(item.requestedCents) }}</td>
              <td class="num">{{ formatUsd(item.paidCents) }}</td>
              <td class="num">{{ formatUsd(item.outstandingCents) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    <!-- Confirmaciones -->
    <ConfirmDialog
      :open="Boolean(dialog)"
      :title="dialogTitle"
      :confirm-label="dialogConfirm"
      :danger="dialogDanger"
      :busy="busy"
      :error="dialog ? detailError : ''"
      :reason-label="dialogReason?.label"
      :reason-hint="dialogReason?.hint"
      :reason-required="dialogReason?.required"
      :reason="dialog?.text ?? ''"
      @update:reason="(value: string) => dialog && (dialog.text = value)"
      @close="dialog = null"
      @confirm="confirmDialog"
    >
      <template v-if="dialog">
        <template v-if="dialog.kind === 'send'">
          <p>Se enviarán <strong>{{ formatUsd(detail.requestedCents) }}</strong> para {{ detail.people.length }} {{ detail.people.length === 1 ? 'persona' : 'personas' }} del proyecto {{ detail.project.code }} al Receptor.</p>
          <p>Después de enviarla <strong>ya no podrás cambiarla</strong>; solo podrás retirarla mientras el Receptor no responda.</p>
        </template>
        <template v-else-if="dialog.kind === 'approve'">
          <p>Vas a aprobar <strong>{{ formatUsd(detail.requestedCents) }}</strong> para {{ detail.people.length }} {{ detail.people.length === 1 ? 'persona' : 'personas' }}.</p>
          <p>Después podrás entregar el dinero, completo o por partes.</p>
        </template>
        <template v-else-if="dialog.kind === 'reject'">
          <p>La solicitud no se pagará y la deuda quedará libre para pedirla otra vez. El Generador verá tu motivo.</p>
        </template>
        <template v-else-if="dialog.kind === 'cancel'">
          <p>La deuda de {{ detail.project.code }} ({{ formatUsd(detail.requestedCents) }}) quedará libre para incluirla en otra solicitud.</p>
        </template>
        <template v-else-if="dialog.kind === 'close'">
          <p v-if="closeNeedsReason">
            Faltan <strong>{{ formatUsd(detail.outstandingCents) }}</strong> por entregar. Si cierras ahora, ese dinero <strong>no se entrega en esta solicitud</strong>: sigue como
            deuda y podrás pedirlo en otra.
          </p>
          <p v-else>Ya se entregó todo el dinero. Al cerrarla, la solicitud queda terminada.</p>
        </template>
        <template v-else-if="dialog.kind === 'annul'">
          <p>
            El recibo #{{ dialog.payment.id }} de <strong>{{ formatUsd(dialog.payment.amountCents) }}</strong> para {{ dialog.payment.person.name }} quedará anulado.
          </p>
          <p>No se borra: queda marcado como anulado con tu motivo, y esos {{ formatUsd(dialog.payment.amountCents) }} <strong>vuelven a estar pendientes</strong>.</p>
        </template>
        <template v-else-if="dialog.kind === 'deliver'">
          <p>Vas a registrar que se entregó este dinero el {{ formatDate(paymentForm.paidOn) }}:</p>
          <ul class="deliver-summary">
            <li v-for="row in planned" :key="row.personId">
              <span>{{ row.name }}</span>
              <strong>{{ formatUsd(row.amountCents) }}</strong>
              <span v-if="row.amountCents < row.outstandingCents" class="hint">(le quedan {{ formatUsd(row.outstandingCents - row.amountCents) }} por recibir)</span>
            </li>
            <li class="deliver-summary-total">
              <span>Total</span>
              <strong>{{ formatUsd(plannedTotal) }}</strong>
            </li>
          </ul>
          <p class="hint">Se genera un recibo por cada persona. Si te equivocas, puedes anularlo con un motivo.</p>
        </template>
      </template>
    </ConfirmDialog>
  </template>

  <!-- LISTA -->
  <template v-else>
    <div class="page-header">
      <h1>Solicitudes de pago</h1>
      <button v-if="canCreate" type="button" class="button button-primary" @click="openCreate">Pedir dinero para un proyecto</button>
    </div>
    <p class="hint">
      <template v-if="canDecide">Aquí revisas lo que piden, apruebas y entregas el dinero a las personas.</template>
      <template v-else>Aquí le pides dinero al Receptor para pagarle a las personas de un proyecto, y ves cómo va cada pedido.</template>
    </p>

    <div class="filter-bar">
      <div class="chips" role="group" aria-label="Qué solicitudes ver">
        <button
          v-for="key in visibleTabs"
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
            <th scope="col">Qué pasa ahora</th>
            <th scope="col">Personas</th>
            <th scope="col" class="num">Solicitado</th>
            <th scope="col" class="num">Falta entregar</th>
            <th scope="col">Creada</th>
            <th scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="request in filteredRequests" :key="request.id">
            <td>
              #{{ request.id }} · {{ request.project.code }}
              <span class="permission-code">{{ request.project.name }}</span>
            </td>
            <td>
              <StatusBadge :label="statusLabel(request)" :tone="REQUEST_STATUS_TONES[request.status]" />
              <span class="permission-code">{{ plain(request).text }}</span>
            </td>
            <td>{{ request.personCount }}</td>
            <td class="num">{{ formatUsd(request.requestedCents) }}</td>
            <td class="num">{{ formatUsd(request.outstandingCents) }}</td>
            <td>
              {{ request.createdBy?.name }}
              <span class="permission-code">{{ formatDateTime(request.createdAt) }}</span>
            </td>
            <td>
              <RouterLink
                class="button"
                :class="{ 'button-primary': plain(request).tone === 'todo' }"
                :to="{ name: 'payment-requests', query: { ...route.query, id: request.id } }"
              >
                {{ plain(request).action }}
              </RouterLink>
            </td>
          </tr>
          <tr v-if="filteredRequests.length === 0">
            <td colspan="7">
              <template v-if="statusFilter === 'mine'">No tienes nada pendiente aquí. Mira la pestaña «En proceso» para ver las que siguen en marcha.</template>
              <template v-else>No hay solicitudes en esta lista.</template>
              <button v-if="statusFilter !== 'open'" type="button" class="button" @click="setStatusFilter('open')">Ver las que están en proceso</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>
