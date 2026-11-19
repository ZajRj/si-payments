<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorMessage } from '@/api/http';
import {
  approveVoucher,
  cancelVoucher,
  closePeriod,
  createFund,
  disburseVoucher,
  listFundPeriods,
  listFunds,
  listVouchers,
  openPeriod,
  rejectVoucher,
  requestVoucher,
  settleVoucher,
  updateFund,
  type PettyCashFund,
  type PettyCashPeriod,
  type Voucher,
} from '@/api/petty-cash';
import { listProjects, type Project } from '@/api/projects';
import AppIcon from '@/components/AppIcon.vue';
import AppModal from '@/components/AppModal.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatDate } from '@/lib/dates';
import { centsToInput, formatUsd, MONEY_EXAMPLE, parseUsd } from '@/lib/money';
import { activeTone } from '@/lib/status';
import { notify } from '@/lib/toast';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { usePendingStore } from '@/stores/pending';

const auth = useAuthStore();
const pending = usePendingStore();
const canManage = computed(() => auth.can(PERMISSIONS.PETTY_CASH_MANAGE));
const canRequest = computed(() => auth.can(PERMISSIONS.PETTY_CASH_REQUEST));
// Cancelar y rendir son solo de quien pidió el vale.
const isOwnVoucher = (voucher: Voucher) => canRequest.value && voucher.requestedBy?.id === auth.user?.id;

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = ({ year, month }: { year: number; month: number }) => `${MONTHS[month - 1]} de ${year}`;

const funds = ref<PettyCashFund[]>([]);
const projects = ref<Project[]>([]);
const loading = ref(true);
const error = ref('');

const today = new Date().toLocaleDateString('sv-SE');
const activeProjects = computed(() => projects.value.filter((project) => project.active));

async function loadFunds() {
  loading.value = true;
  error.value = '';
  try {
    funds.value = await listFunds();
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
  await loadFunds();
}

// ---------- Crear o editar una caja ----------
const editing = ref<PettyCashFund | null>(null);
const formOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const form = reactive({ name: '', projectId: 0, active: true });

function openForm(fund: PettyCashFund | null) {
  editing.value = fund;
  Object.assign(form, fund ? { name: fund.name, projectId: fund.project.id, active: fund.active } : { name: '', projectId: 0, active: true });
  formError.value = '';
  formOpen.value = true;
}

async function saveFund() {
  formError.value = '';
  if (!form.projectId) {
    formError.value = 'Elige el proyecto al que pertenece la caja.';
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await updateFund(editing.value.id, { name: form.name, projectId: form.projectId, active: form.active });
      notify(`Listo: se guardaron los cambios de «${form.name}».`);
    } else {
      await createFund({ name: form.name, projectId: form.projectId });
      notify(`Listo: se creó la caja «${form.name}». Ahora hay que abrir su primer mes.`);
    }
    formOpen.value = false;
    await loadFunds();
    if (selected.value) await selectFund(selected.value.id);
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// ---------- Caja seleccionada: meses y vales ----------
const selected = ref<PettyCashFund | null>(null);
const periods = ref<PettyCashPeriod[]>([]);
const viewedPeriodId = ref(0);
const vouchers = ref<Voucher[]>([]);
const detailError = ref('');
const busy = ref(false);
const confirmingClose = ref(false);

const viewedPeriod = computed(() => periods.value.find((period) => period.id === viewedPeriodId.value) ?? null);
const open = computed(() => selected.value?.openPeriod ?? null);

async function loadVouchers() {
  vouchers.value = viewedPeriodId.value ? await listVouchers({ periodId: viewedPeriodId.value }) : [];
}

async function selectFund(id: number, periodId?: number) {
  detailError.value = '';
  if (selected.value?.id !== id) confirmingClose.value = false;
  try {
    funds.value = await listFunds();
    selected.value = funds.value.find((fund) => fund.id === id) ?? null;
    periods.value = await listFundPeriods(id);
    viewedPeriodId.value = periodId ?? selected.value?.openPeriod?.id ?? periods.value[0]?.id ?? 0;
    await loadVouchers();
  } catch (e) {
    detailError.value = errorMessage(e);
  }
}

const route = useRoute();

// La caja abierta va en la URL (?fund=): Atrás vuelve a la lista y el enlace se puede compartir.
const fundId = computed(() => {
  const id = Number(route.query.fund);
  return Number.isInteger(id) && id > 0 ? id : null;
});

async function showFund(id: number | null) {
  confirmingClose.value = false;
  if (id === null) {
    selected.value = null;
    return;
  }
  await selectFund(id);
  window.scrollTo({ top: 0 });
}

watch(fundId, (id) => void showFund(id));

async function viewPeriod(id: number) {
  viewedPeriodId.value = id;
  try {
    await loadVouchers();
  } catch (e) {
    detailError.value = errorMessage(e);
  }
}

async function run(action: () => Promise<unknown>, success?: string) {
  if (!selected.value) return;
  detailError.value = '';
  busy.value = true;
  try {
    await action();
    voucherAction.value = null;
    voucherConfirm.value = null;
    confirmingClose.value = false;
    await selectFund(selected.value.id, viewedPeriodId.value || undefined);
    void pending.refresh();
    if (success) notify(success);
  } catch (e) {
    detailError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

// ---------- Apertura del mes ----------
const openMonthForm = reactive({ month: today.slice(0, 7), amount: '' });
const thisMonth = today.slice(0, 7);

// El mes que se va a abrir: el primero lo elige quien abre; los siguientes son consecutivos al último cerrado.
const nextMonth = computed(() => {
  const last = periods.value[0];
  if (!last) return null;
  const month = last.month === 12 ? 1 : last.month + 1;
  const year = last.month === 12 ? last.year + 1 : last.year;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
});
const nextMonthIsFuture = computed(() => Boolean(nextMonth.value && nextMonth.value.key > thisMonth));

function submitOpen() {
  const fund = selected.value;
  if (!fund) return;
  const replenishmentCents = openMonthForm.amount.trim() ? parseUsd(openMonthForm.amount) : 0;
  if (replenishmentCents === null) {
    detailError.value = `Escribe el dinero solo con números. ${MONEY_EXAMPLE}.`;
    return;
  }
  const first = periods.value.length === 0;
  const [year, month] = openMonthForm.month.split('-').map(Number);
  const label = first ? monthName({ year, month }) : monthName(nextMonth.value!);
  return run(
    () => openPeriod(fund.id, first ? { year, month, replenishmentCents } : { replenishmentCents }),
    `Listo: se abrió ${label}. Ya se pueden pedir vales.`,
  );
}

// ---------- Pedir un vale ----------
const voucherFormOpen = ref(false);
const voucherForm = reactive({ concept: '', beneficiary: '', amount: '' });

function openVoucherForm() {
  Object.assign(voucherForm, { concept: '', beneficiary: '', amount: '' });
  detailError.value = '';
  voucherFormOpen.value = true;
}

async function submitVoucher() {
  const fund = selected.value;
  if (!fund) return;
  const amountCents = parseUsd(voucherForm.amount);
  if (amountCents === null || amountCents === 0) {
    detailError.value = `Escribe cuánto dinero necesitas, solo con números. ${MONEY_EXAMPLE}.`;
    return;
  }
  const available = open.value?.availableCents ?? 0;
  if (amountCents > available) {
    detailError.value = `En la caja solo hay ${formatUsd(available)} disponibles. Pide ese monto o uno menor.`;
    return;
  }
  await run(
    () => requestVoucher(fund.id, { concept: voucherForm.concept, beneficiary: voucherForm.beneficiary, amountCents }),
    `Listo: pediste ${formatUsd(amountCents)}. Ahora el Receptor debe aprobarlo.`,
  );
  if (!detailError.value) voucherFormOpen.value = false;
}

// ---------- Aprobar, entregar, cancelar, rechazar ----------
type VoucherConfirm = { kind: 'approve' | 'disburse' | 'cancel'; voucher: Voucher };
const voucherConfirm = ref<VoucherConfirm | null>(null);

const CONFIRM_TEXT: Record<VoucherConfirm['kind'], { title: string; button: string; done: string }> = {
  approve: { title: '¿Aprobar este vale?', button: 'Sí, aprobar', done: 'Listo: aprobaste el vale. Ahora falta entregar el dinero.' },
  disburse: { title: '¿Ya entregaste el dinero?', button: 'Sí, ya lo entregué', done: 'Listo: quedó registrada la entrega del dinero. Ahora hay que esperar el comprobante.' },
  cancel: { title: '¿Cancelar este pedido?', button: 'Sí, cancelar pedido', done: 'Se canceló el pedido de dinero.' },
};

function confirmVoucher() {
  const current = voucherConfirm.value;
  if (!current) return;
  const id = current.voucher.id;
  const done = CONFIRM_TEXT[current.kind].done;
  if (current.kind === 'approve') return run(() => approveVoucher(id), done);
  if (current.kind === 'disburse') return run(() => disburseVoucher(id), done);
  return run(() => cancelVoucher(id), done);
}

const voucherAction = ref<{ type: 'reject' | 'settle'; voucher: Voucher } | null>(null);
const actionForm = reactive({ reason: '', spent: '', receiptReference: '', receiptDate: today });

function openVoucherAction(type: 'reject' | 'settle', voucher: Voucher) {
  voucherAction.value = { type, voucher };
  detailError.value = '';
  Object.assign(actionForm, { reason: '', spent: centsToInput(voucher.amountCents), receiptReference: '', receiptDate: today });
}

function submitVoucherAction() {
  const current = voucherAction.value;
  if (!current) return;
  if (current.type === 'reject') {
    return run(() => rejectVoucher(current.voucher.id, actionForm.reason), 'Se rechazó el vale. Quien lo pidió verá tu motivo.');
  }
  const spentCents = parseUsd(actionForm.spent);
  if (spentCents === null) {
    detailError.value = `Escribe cuánto se gastó, solo con números. ${MONEY_EXAMPLE}.`;
    return;
  }
  if (spentCents > current.voucher.amountCents) {
    detailError.value = `No se puede gastar más de lo que se recibió (${formatUsd(current.voucher.amountCents)}).`;
    return;
  }
  const back = current.voucher.amountCents - spentCents;
  return run(
    () => settleVoucher(current.voucher.id, { spentCents, receiptReference: actionForm.receiptReference, receiptDate: actionForm.receiptDate }),
    back > 0 ? `Listo: comprobante entregado. ${formatUsd(back)} volvieron a la caja.` : 'Listo: comprobante entregado. El vale quedó terminado.',
  );
}

// Qué le pasa a cada vale y qué le toca hacer a quien mira.
function plain(voucher: Voucher): { tone: 'todo' | 'wait' | 'ok' | 'bad'; text: string } {
  switch (voucher.status) {
    case 'REQUESTED':
      return canManage.value
        ? { tone: 'todo', text: 'Espera tu respuesta: apruébalo o recházalo.' }
        : { tone: 'wait', text: 'Esperando que el Receptor lo apruebe.' };
    case 'APPROVED':
      return canManage.value
        ? { tone: 'todo', text: `Aprobado. Falta entregarle el dinero a ${voucher.beneficiary}.` }
        : { tone: 'wait', text: 'Aprobado. Falta que el Receptor entregue el dinero.' };
    case 'DISBURSED':
      return isOwnVoucher(voucher)
        ? { tone: 'todo', text: 'Ya tienes el dinero. Falta entregar el comprobante del gasto.' }
        : { tone: 'wait', text: `El dinero ya se entregó. Falta que ${voucher.requestedBy?.name ?? 'quien lo pidió'} entregue el comprobante.` };
    case 'SETTLED':
      return {
        tone: 'ok',
        text: `Terminado: se gastó ${formatUsd(voucher.spentCents ?? 0)} y volvieron ${formatUsd(voucher.returnedCents ?? 0)} a la caja. Comprobante ${voucher.receiptReference} del ${formatDate(voucher.receiptDate)}.`,
      };
    case 'REJECTED':
      return { tone: 'bad', text: `Rechazado: ${voucher.rejectionReason ?? 'sin motivo'}` };
    case 'CANCELLED':
      return { tone: 'bad', text: 'El pedido fue cancelado.' };
  }
}

const PLAIN_STATUS: Record<string, string> = {
  REQUESTED: 'Esperando aprobación',
  APPROVED: 'Falta entregar el dinero',
  DISBURSED: 'Falta el comprobante',
  SETTLED: 'Terminado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Cancelado',
};
const PLAIN_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  REQUESTED: 'warning',
  APPROVED: 'info',
  DISBURSED: 'info',
  SETTLED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

onMounted(async () => {
  await load();
  await showFund(fundId.value);
});
</script>

<template>
  <!-- Nueva / editar caja -->
  <AppModal :open="formOpen" :title="editing ? `Editar «${editing.name}»` : 'Crear una caja chica'" @close="formOpen = false">
    <form class="form-grid" @submit.prevent="saveFund">
      <label class="field">
        Nombre de la caja
        <input v-model="form.name" required maxlength="80" placeholder="Ej.: Caja chica de Física" />
      </label>
      <label class="field">
        ¿De qué proyecto es?
        <select v-model.number="form.projectId" required>
          <option :value="0" disabled>Elige un proyecto</option>
          <option v-for="project in activeProjects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
        </select>
      </label>
      <label v-if="editing" class="checkbox">
        <input v-model="form.active" type="checkbox" />
        La caja está en uso
      </label>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="confirm-actions">
        <button type="button" class="button" @click="formOpen = false">Volver</button>
        <button type="submit" class="button button-primary" :disabled="saving">{{ saving ? 'Un momento…' : 'Guardar' }}</button>
      </div>
    </form>
  </AppModal>

  <!-- LISTA DE CAJAS -->
  <template v-if="!selected">
    <div class="page-header">
      <h1>Cajas chicas</h1>
      <button v-if="canManage" type="button" class="button button-primary" @click="openForm(null)">Crear una caja chica</button>
    </div>
    <p class="hint">
      Una caja chica es un dinero en efectivo guardado para gastos pequeños de un proyecto. Cada mes se abre; quien necesita dinero pide un
      <strong>vale</strong>; cuando lo gasta, entrega el comprobante; y al final del mes se cierra.
    </p>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="loading">Cargando…</p>
    <div v-else class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Caja</th>
            <th scope="col">Proyecto</th>
            <th scope="col">Mes abierto</th>
            <th scope="col" class="num">Disponible</th>
            <th scope="col">Vales en trámite</th>
            <th scope="col">Estado</th>
            <th scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="fund in funds" :key="fund.id">
            <td>{{ fund.name }}</td>
            <td class="nowrap" :title="fund.project.name">
              {{ fund.project.code }}
              <span class="permission-code">{{ fund.project.name }}</span>
            </td>
            <td class="nowrap">
              <template v-if="fund.openPeriod">{{ monthName(fund.openPeriod) }}</template>
              <template v-else>
                Ninguno
                <span class="permission-code">Hay que abrir el mes para usarla</span>
              </template>
            </td>
            <td class="num">{{ fund.openPeriod ? formatUsd(fund.openPeriod.availableCents) : '' }}</td>
            <td>{{ fund.openPeriod ? fund.openPeriod.pendingVoucherCount : '' }}</td>
            <td><StatusBadge :label="fund.active ? 'En uso' : 'Fuera de uso'" :tone="activeTone(fund.active)" /></td>
            <td>
              <div class="table-actions">
                <RouterLink class="button" :class="{ 'button-primary': fund.openPeriod?.pendingVoucherCount }" :to="{ name: 'petty-cash', query: { fund: fund.id } }">Entrar</RouterLink>
                <button v-if="canManage" type="button" class="button" @click="openForm(fund)">Editar</button>
              </div>
            </td>
          </tr>
          <tr v-if="funds.length === 0">
            <td colspan="7">Todavía no hay cajas chicas.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>

  <!-- DETALLE DE UNA CAJA -->
  <template v-else>
    <nav aria-label="Ruta">
      <ol class="crumbs">
        <li>
          <RouterLink :to="{ name: 'petty-cash' }"><AppIcon name="back" :size="14" /> Cajas chicas</RouterLink>
        </li>
        <li><span aria-current="page">{{ selected.name }}</span></li>
      </ol>
    </nav>
    <div class="detail-head">
      <div>
        <h1>
          {{ selected.name }}
          <StatusBadge :label="selected.active ? 'En uso' : 'Fuera de uso'" :tone="activeTone(selected.active)" />
        </h1>
        <p class="hint">{{ selected.project.code }} · {{ selected.project.name }}</p>
      </div>
      <button v-if="canManage" type="button" class="button" @click="openForm(selected)">Editar caja</button>
    </div>

    <p v-if="detailError && !voucherFormOpen && !voucherAction && !voucherConfirm && !confirmingClose" class="error section-gap" role="alert">{{ detailError }}</p>

    <!-- Hay un mes abierto -->
    <template v-if="open">
      <section class="next-step" :class="{ 'next-step-waiting': !(canRequest && selected.active) }">
        <div class="next-step-text">
          <span class="eyebrow">Mes abierto</span>
          <strong>{{ monthName(open) }}</strong>
          <span class="next-step-detail">
            Hay {{ formatUsd(open.cashCents) }} de dinero en la caja y se pueden pedir vales hasta por {{ formatUsd(open.availableCents) }}.
          </span>
        </div>
        <div class="actions">
          <button v-if="canRequest && selected.active" type="button" class="button button-primary" @click="openVoucherForm">Pedir dinero de la caja (vale)</button>
        </div>
      </section>

      <section class="card" aria-label="Resumen">
        <dl class="summary-grid">
          <div>
            <dt>Dinero en la caja</dt>
            <dd>{{ formatUsd(open.cashCents) }}</dd>
          </div>
          <div>
            <dt>Se puede pedir hasta</dt>
            <dd>{{ formatUsd(open.availableCents) }}</dd>
          </div>
          <div>
            <dt>Vales en trámite</dt>
            <dd>{{ open.pendingVoucherCount }}</dd>
          </div>
        </dl>
        <details class="more-filters">
          <summary>¿De dónde salen estos números?</summary>
          <ul class="plain-list">
            <li><span>Con lo que empezó el mes</span><strong>{{ formatUsd(open.openingBalanceCents) }}</strong></li>
            <li><span>Dinero que se agregó este mes</span><strong>{{ formatUsd(open.replenishmentCents) }}</strong></li>
            <li><span>Ya gastado, con comprobante</span><strong>{{ formatUsd(open.spentCents) }}</strong></li>
            <li><span>Entregado, falta el comprobante</span><strong>{{ formatUsd(open.disbursedCents) }}</strong></li>
            <li><span>Aprobado, falta entregar el dinero</span><strong>{{ formatUsd(open.reservedCents) }}</strong></li>
          </ul>
        </details>
      </section>
    </template>

    <!-- No hay mes abierto -->
    <section v-else class="card">
      <h2>Esta caja no tiene un mes abierto</h2>
      <p class="hint">
        <template v-if="canManage && selected.active">Para que se puedan pedir vales hay que abrir el mes.</template>
        <template v-else>Hay que esperar a que el Receptor abra el mes para poder pedir vales.</template>
      </p>
      <form v-if="canManage && selected.active" class="open-month" @submit.prevent="submitOpen">
        <label v-if="periods.length === 0" class="field">
          ¿Qué mes se abre?
          <input v-model="openMonthForm.month" type="month" required :max="thisMonth" />
        </label>
        <p v-else-if="nextMonth" class="hint">
          Se abrirá <strong>{{ monthName(nextMonth) }}</strong>, empezando con lo que sobró del mes anterior ({{ formatUsd(periods[0]?.closingBalanceCents ?? 0) }}).
        </p>
        <label class="field">
          Dinero que se agrega a la caja este mes (USD)
          <input v-model="openMonthForm.amount" inputmode="decimal" :required="periods.length === 0" placeholder="0,00" />
          <span class="hint">{{ periods.length === 0 ? 'Es el dinero con el que empieza la caja.' : 'Si no se agrega dinero nuevo, déjalo vacío.' }}</span>
        </label>
        <p v-if="nextMonthIsFuture && nextMonth" class="error" role="alert">
          Todavía no se puede abrir {{ monthName(nextMonth) }}: se podrá desde el 01/{{ String(nextMonth.month).padStart(2, '0') }}/{{ nextMonth.year }}.
        </p>
        <div class="actions">
          <button type="submit" class="button button-primary" :disabled="busy || nextMonthIsFuture">Abrir el mes</button>
        </div>
      </form>
    </section>

    <!-- Vales -->
    <section class="card">
      <div class="page-header">
        <h2>Vales<template v-if="viewedPeriod"> de {{ monthName(viewedPeriod) }}</template></h2>
        <label v-if="periods.length > 1" class="field field-inline">
          Ver otro mes
          <select :value="viewedPeriodId" @change="viewPeriod(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="period in periods" :key="period.id" :value="period.id">{{ monthName(period) }} {{ period.status === 'OPEN' ? '(abierto)' : '(cerrado)' }}</option>
          </select>
        </label>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Vale</th>
              <th scope="col">Para qué y para quién</th>
              <th scope="col" class="num">Monto</th>
              <th scope="col">Qué pasa ahora</th>
              <th scope="col"><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="voucher in vouchers" :key="voucher.id">
              <td class="nowrap">#{{ voucher.id }}</td>
              <td>
                {{ voucher.concept }}
                <span class="permission-code">Para {{ voucher.beneficiary }} · pedido por {{ voucher.requestedBy?.name }}</span>
              </td>
              <td class="num">{{ formatUsd(voucher.amountCents) }}</td>
              <td>
                <StatusBadge :label="PLAIN_STATUS[voucher.status]" :tone="PLAIN_TONE[voucher.status]" />
                <span class="permission-code">{{ plain(voucher).text }}</span>
              </td>
              <td>
                <div class="table-actions">
                  <template v-if="voucher.status === 'REQUESTED' && canManage">
                    <button type="button" class="button" @click="openVoucherAction('reject', voucher)">Rechazar</button>
                    <button type="button" class="button button-primary" :disabled="busy" @click="voucherConfirm = { kind: 'approve', voucher }">Aprobar</button>
                  </template>
                  <button v-if="voucher.status === 'REQUESTED' && isOwnVoucher(voucher)" type="button" class="button" :disabled="busy" @click="voucherConfirm = { kind: 'cancel', voucher }">
                    Cancelar pedido
                  </button>
                  <button v-if="voucher.status === 'APPROVED' && canManage" type="button" class="button button-primary" :disabled="busy" @click="voucherConfirm = { kind: 'disburse', voucher }">
                    Entregar el dinero
                  </button>
                  <button v-if="voucher.status === 'DISBURSED' && isOwnVoucher(voucher)" type="button" class="button button-primary" @click="openVoucherAction('settle', voucher)">
                    Entregar comprobante
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="vouchers.length === 0">
              <td colspan="5">No hay vales en este mes.<template v-if="open && canRequest && selected.active"> Cuando necesites dinero de la caja, pulsa «Pedir dinero de la caja».</template></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Cerrar el mes y meses anteriores -->
    <section v-if="open && canManage" class="more-actions">
      <h2>Otras opciones</h2>
      <button type="button" class="button button-danger" :disabled="busy" @click="confirmingClose = true">Cerrar el mes</button>
      <p class="hint">Se cierra al terminar el mes, cuando todos los vales ya están terminados. El dinero que sobre pasa al mes siguiente.</p>
    </section>

    <details class="card fold">
      <summary>
        <AppIcon name="chevron" />
        Historial de meses
        <span class="hint">{{ periods.length }} {{ periods.length === 1 ? 'mes' : 'meses' }}</span>
      </summary>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Mes</th>
              <th scope="col">Situación</th>
              <th scope="col" class="num">Empezó con</th>
              <th scope="col" class="num">Se agregó</th>
              <th scope="col" class="num">Se gastó</th>
              <th scope="col" class="num">Terminó con</th>
              <th scope="col"><span class="sr-only">Opciones</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="period in periods" :key="period.id">
              <td class="nowrap">{{ monthName(period) }}</td>
              <td><StatusBadge :label="period.status === 'OPEN' ? 'Abierto' : 'Cerrado'" :tone="period.status === 'OPEN' ? 'success' : 'neutral'" /></td>
              <td class="num">{{ formatUsd(period.openingBalanceCents) }}</td>
              <td class="num">{{ formatUsd(period.replenishmentCents) }}</td>
              <td class="num">{{ formatUsd(period.spentCents) }}</td>
              <td class="num">{{ period.closingBalanceCents === null ? '' : formatUsd(period.closingBalanceCents) }}</td>
              <td>
                <button v-if="period.id !== viewedPeriodId" type="button" class="button" @click="viewPeriod(period.id)">Ver sus vales</button>
              </td>
            </tr>
            <tr v-if="periods.length === 0">
              <td colspan="7">La caja todavía no tiene meses.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    <!-- Pedir vale -->
    <AppModal :open="voucherFormOpen" title="Pedir dinero de la caja (vale)" @close="voucherFormOpen = false">
      <form class="form-grid" @submit.prevent="submitVoucher">
        <p v-if="open" class="amount-preview">En la caja se puede pedir hasta <strong>{{ formatUsd(open.availableCents) }}</strong>.</p>
        <label class="field">
          ¿Para qué es el dinero?
          <input v-model="voucherForm.concept" required minlength="3" maxlength="200" placeholder="Ej.: Compra de papelería" />
        </label>
        <label class="field">
          ¿Quién va a recibir el dinero?
          <input v-model="voucherForm.beneficiary" required maxlength="120" placeholder="Nombre de la persona" />
        </label>
        <label class="field">
          ¿Cuánto necesitas? (USD)
          <input v-model="voucherForm.amount" inputmode="decimal" required placeholder="Ej.: 50,00" />
        </label>
        <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
        <div class="confirm-actions">
          <button type="button" class="button" @click="voucherFormOpen = false">Volver</button>
          <button type="submit" class="button button-primary" :disabled="busy">{{ busy ? 'Un momento…' : 'Pedir el dinero' }}</button>
        </div>
      </form>
    </AppModal>

    <!-- Entregar comprobante -->
    <AppModal :open="voucherAction?.type === 'settle'" title="Entregar el comprobante del gasto" @close="voucherAction = null">
      <form v-if="voucherAction?.type === 'settle'" class="form-grid" @submit.prevent="submitVoucherAction">
        <p class="hint">
          Recibiste <strong>{{ formatUsd(voucherAction.voucher.amountCents) }}</strong> para «{{ voucherAction.voucher.concept }}». Cuéntale al sistema cuánto
          gastaste y anota los datos de la factura o el recibo.
        </p>
        <label class="field">
          ¿Cuánto se gastó en total? (USD)
          <input v-model="actionForm.spent" inputmode="decimal" required />
          <span class="hint">Si gastaste menos de lo que recibiste, lo que sobra vuelve a la caja.</span>
        </label>
        <label class="field">
          Número de la factura o del recibo
          <input v-model="actionForm.receiptReference" required maxlength="120" placeholder="Ej.: 000123" />
        </label>
        <label class="field">
          Fecha que dice la factura o el recibo
          <input v-model="actionForm.receiptDate" type="date" required :max="today" />
        </label>
        <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
        <div class="confirm-actions">
          <button type="button" class="button" @click="voucherAction = null">Volver</button>
          <button type="submit" class="button button-primary" :disabled="busy">{{ busy ? 'Un momento…' : 'Entregar comprobante' }}</button>
        </div>
      </form>
    </AppModal>

    <!-- Rechazar -->
    <ConfirmDialog
      :open="voucherAction?.type === 'reject'"
      title="¿Rechazar este vale?"
      confirm-label="Sí, rechazar"
      danger
      :busy="busy"
      :error="voucherAction?.type === 'reject' ? detailError : ''"
      reason-label="¿Por qué lo rechazas? (lo verá quien lo pidió)"
      reason-hint="Ej.: No hay dinero suficiente este mes"
      reason-required
      v-model:reason="actionForm.reason"
      @close="voucherAction = null"
      @confirm="submitVoucherAction"
    >
      <p v-if="voucherAction" class="hint">
        Vale de <strong>{{ formatUsd(voucherAction.voucher.amountCents) }}</strong> para «{{ voucherAction.voucher.concept }}». No se entregará dinero.
      </p>
    </ConfirmDialog>

    <!-- Aprobar / entregar / cancelar -->
    <ConfirmDialog
      :open="Boolean(voucherConfirm)"
      :title="voucherConfirm ? CONFIRM_TEXT[voucherConfirm.kind].title : ''"
      :confirm-label="voucherConfirm ? CONFIRM_TEXT[voucherConfirm.kind].button : ''"
      :danger="voucherConfirm?.kind === 'cancel'"
      :busy="busy"
      :error="voucherConfirm ? detailError : ''"
      @close="voucherConfirm = null"
      @confirm="confirmVoucher"
    >
      <template v-if="voucherConfirm">
        <p class="hint">
          «{{ voucherConfirm.voucher.concept }}» · para {{ voucherConfirm.voucher.beneficiary }} ·
          <strong>{{ formatUsd(voucherConfirm.voucher.amountCents) }}</strong>
        </p>
        <p v-if="voucherConfirm.kind === 'approve'">Ese dinero queda apartado en la caja hasta que se entregue.</p>
        <p v-else-if="voucherConfirm.kind === 'disburse'">
          Confirma que ya le entregaste {{ formatUsd(voucherConfirm.voucher.amountCents) }} en efectivo a {{ voucherConfirm.voucher.beneficiary }}. Después tendrá que
          entregar el comprobante del gasto.
        </p>
        <p v-else>El pedido se cancela y no se puede volver a activar.</p>
      </template>
    </ConfirmDialog>

    <!-- Cerrar mes -->
    <ConfirmDialog
      :open="confirmingClose && Boolean(open)"
      :title="open ? `¿Cerrar ${monthName(open)}?` : ''"
      confirm-label="Sí, cerrar el mes"
      danger
      :busy="busy"
      :error="confirmingClose ? detailError : ''"
      @close="confirmingClose = false"
      @confirm="open && run(() => closePeriod(open!.id), 'Listo: el mes quedó cerrado. Lo que sobró pasa al mes siguiente.')"
    >
      <template v-if="open">
        <p class="hint">
          El mes se cerrará con <strong>{{ formatUsd(open.cashCents) }}</strong> en la caja. Ese dinero pasa al mes siguiente.
        </p>
        <p><strong>Esto no se puede deshacer.</strong> Solo se puede cerrar cuando todos los vales del mes ya están terminados, rechazados o cancelados.</p>
      </template>
    </ConfirmDialog>
  </template>
</template>
