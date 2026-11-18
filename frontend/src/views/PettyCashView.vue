<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  monthLabel,
  openPeriod,
  rejectVoucher,
  requestVoucher,
  settleVoucher,
  updateFund,
  VOUCHER_STATUS_LABELS,
  type PettyCashFund,
  type PettyCashPeriod,
  type Voucher,
} from '@/api/petty-cash';
import { listProjects, type Project } from '@/api/projects';
import AppIcon from '@/components/AppIcon.vue';
import AppModal from '@/components/AppModal.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { formatUsd, parseUsd } from '@/lib/money';
import { VOUCHER_STATUS_TONES, activeTone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { usePendingStore } from '@/stores/pending';
import { formatDate } from '@/lib/dates';

const auth = useAuthStore();
const pending = usePendingStore();
const canManage = computed(() => auth.can(PERMISSIONS.PETTY_CASH_MANAGE));
const canRequest = computed(() => auth.can(PERMISSIONS.PETTY_CASH_REQUEST));
// Cancelar y rendir son solo de quien pidió el vale.
const isOwnVoucher = (voucher: Voucher) => canRequest.value && voucher.requestedBy?.id === auth.user?.id;

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

// Crear o editar una caja.
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
    formError.value = 'Selecciona el proyecto';
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await updateFund(editing.value.id, { name: form.name, projectId: form.projectId, active: form.active });
    } else {
      await createFund({ name: form.name, projectId: form.projectId });
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

// Caja seleccionada: meses y vales.
const selected = ref<PettyCashFund | null>(null);
const periods = ref<PettyCashPeriod[]>([]);
const viewedPeriodId = ref(0);
const vouchers = ref<Voucher[]>([]);
const detailError = ref('');
const busy = ref(false);
// Cerrar el mes no se puede deshacer: pide confirmación en la misma pantalla.
const confirmingClose = ref(false);

const viewedPeriod = computed(() => periods.value.find((period) => period.id === viewedPeriodId.value) ?? null);

async function loadVouchers() {
  vouchers.value = viewedPeriodId.value ? await listVouchers({ periodId: viewedPeriodId.value }) : [];
}

async function selectFund(id: number, periodId?: number) {
  detailError.value = '';
  // La confirmación de cierre es de una caja concreta: no debe pasar a otra al cambiar de caja.
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
const router = useRouter();

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

async function run(action: () => Promise<unknown>) {
  if (!selected.value) return;
  detailError.value = '';
  busy.value = true;
  try {
    await action();
    voucherAction.value = null;
    voucherConfirm.value = null;
    await selectFund(selected.value.id, viewedPeriodId.value || undefined);
    void pending.refresh();
  } catch (e) {
    detailError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

// Apertura del mes.
const openMonthForm = reactive({ month: today.slice(0, 7), amount: '' });

function submitOpen() {
  const fund = selected.value;
  if (!fund) return;
  const replenishmentCents = openMonthForm.amount.trim() ? parseUsd(openMonthForm.amount) : 0;
  if (replenishmentCents === null) {
    detailError.value = 'Escribe un monto válido, por ejemplo 500 o 500.00';
    return;
  }
  // El primer mes se elige; los siguientes son consecutivos y los decide el servidor.
  const first = periods.value.length === 0;
  const [year, month] = openMonthForm.month.split('-').map(Number);
  return run(() => openPeriod(fund.id, first ? { year, month, replenishmentCents } : { replenishmentCents }));
}

// Solicitud de vale.
const voucherFormOpen = ref(false);
const voucherForm = reactive({ concept: '', beneficiary: '', amount: '' });

function openVoucherForm() {
  Object.assign(voucherForm, { concept: '', beneficiary: '', amount: '' });
  voucherFormOpen.value = true;
}

async function submitVoucher() {
  const fund = selected.value;
  if (!fund) return;
  const amountCents = parseUsd(voucherForm.amount);
  if (amountCents === null || amountCents === 0) {
    detailError.value = 'Escribe un monto válido, por ejemplo 150 o 150.50';
    return;
  }
  await run(() => requestVoucher(fund.id, { concept: voucherForm.concept, beneficiary: voucherForm.beneficiary, amountCents }));
  if (!detailError.value) voucherFormOpen.value = false;
}

// Aprobar, desembolsar y cancelar un vale se confirman antes: desembolsar entrega dinero.
type VoucherConfirm = { kind: 'approve' | 'disburse' | 'cancel'; voucher: Voucher };
const voucherConfirm = ref<VoucherConfirm | null>(null);

const VOUCHER_CONFIRM_TEXT: Record<VoucherConfirm['kind'], { title: string; button: string }> = {
  approve: { title: 'Aprobar vale', button: 'Aprobar vale' },
  disburse: { title: 'Desembolsar vale', button: 'Confirmar entrega' },
  cancel: { title: 'Cancelar vale', button: 'Cancelar vale' },
};

function confirmVoucher() {
  const current = voucherConfirm.value;
  if (!current) return;
  const id = current.voucher.id;
  if (current.kind === 'approve') return run(() => approveVoucher(id));
  if (current.kind === 'disburse') return run(() => disburseVoucher(id));
  return run(() => cancelVoucher(id));
}

// Rechazo y rendición de un vale.
const voucherAction = ref<{ type: 'reject' | 'settle'; voucher: Voucher } | null>(null);
const actionForm = reactive({ reason: '', spent: '', receiptReference: '', receiptDate: today });

function openVoucherAction(type: 'reject' | 'settle', voucher: Voucher) {
  voucherAction.value = { type, voucher };
  Object.assign(actionForm, {
    reason: '',
    spent: (voucher.amountCents / 100).toFixed(2),
    receiptReference: '',
    receiptDate: today,
  });
}

function submitVoucherAction() {
  const current = voucherAction.value;
  if (!current) return;
  if (current.type === 'reject') {
    return run(() => rejectVoucher(current.voucher.id, actionForm.reason));
  }
  const spentCents = parseUsd(actionForm.spent);
  if (spentCents === null) {
    detailError.value = 'Escribe un monto válido, por ejemplo 150 o 150.50';
    return;
  }
  return run(() =>
    settleVoucher(current.voucher.id, {
      spentCents,
      receiptReference: actionForm.receiptReference,
      receiptDate: actionForm.receiptDate,
    }),
  );
}

onMounted(async () => {
  await load();
  await showFund(fundId.value);
});
</script>

<template>
  <template v-if="!selected">
    <div class="page-header">
      <h1>Cajas chicas</h1>
      <button v-if="canManage" type="button" class="button button-primary" @click="openForm(null)">Nueva caja</button>
    </div>
    <p class="hint">
      Cada caja se asigna a un proyecto y funciona por meses: apertura, vales (solicitud, aprobación, desembolso y rendición
      con comprobante) y cierre. El saldo final pasa al mes siguiente.
    </p>
  </template>

  <AppModal
    :open="formOpen"
    :title="editing ? `Editar ${editing.name}` : 'Nueva caja chica'"
    @close="formOpen = false"
  >
    <form class="form-grid" @submit.prevent="saveFund">
      <label class="field">
        Nombre
        <input v-model="form.name" required maxlength="80" />
      </label>
      <label class="field">
        Proyecto
        <select v-model.number="form.projectId" required>
          <option :value="0" disabled>Selecciona un proyecto</option>
          <option v-for="project in activeProjects" :key="project.id" :value="project.id">
            {{ project.code }} · {{ project.name }}
          </option>
        </select>
      </label>
      <label v-if="editing" class="checkbox">
        <input v-model="form.active" type="checkbox" />
        Activa
      </label>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="actions">
        <button type="button" class="button" @click="formOpen = false">Cancelar</button>
        <button type="submit" class="button button-primary" :disabled="saving">Guardar</button>
      </div>
    </form>
  </AppModal>

  <template v-if="selected">
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
          <StatusBadge :label="selected.active ? 'Activa' : 'Inactiva'" :tone="activeTone(selected.active)" />
        </h1>
        <p class="hint">{{ selected.project.code }} · {{ selected.project.name }}</p>
      </div>
      <button v-if="canManage" type="button" class="button" @click="openForm(selected)">Editar caja</button>
    </div>
  <section class="card">

    <template v-if="selected.openPeriod">
      <p>
        Mes abierto <strong>{{ monthLabel(selected.openPeriod) }}</strong> · Saldo inicial
        {{ formatUsd(selected.openPeriod.openingBalanceCents) }} · Reposición
        {{ formatUsd(selected.openPeriod.replenishmentCents) }}
      </p>
      <p class="hint">
        Gastado {{ formatUsd(selected.openPeriod.spentCents) }} · Desembolsado sin rendir
        {{ formatUsd(selected.openPeriod.disbursedCents) }} · Aprobado sin desembolsar
        {{ formatUsd(selected.openPeriod.reservedCents) }} · Efectivo en caja {{ formatUsd(selected.openPeriod.cashCents) }}
        · Disponible <strong>{{ formatUsd(selected.openPeriod.availableCents) }}</strong>
      </p>
      <div class="actions">
        <button v-if="canRequest && selected.active" type="button" class="button button-primary" @click="openVoucherForm">
          Solicitar vale
        </button>
        <button v-if="canManage" type="button" class="button button-danger" :disabled="busy" @click="confirmingClose = true">
          Cerrar mes
        </button>
      </div>

      <AppModal
        :open="confirmingClose"
        :title="`Cerrar mes ${monthLabel(selected.openPeriod)}`"
        @close="confirmingClose = false"
      >
        <div class="form-grid">
          <p class="hint">
            El mes <strong>{{ monthLabel(selected.openPeriod) }}</strong> se cerrará con un saldo final de
            <strong>{{ formatUsd(selected.openPeriod.cashCents) }}</strong>, que pasará al mes siguiente. Esta acción no se
            puede deshacer.
          </p>
          <div class="actions">
            <button type="button" class="button" @click="confirmingClose = false">Cancelar</button>
            <button
              type="button"
              class="button button-danger-solid"
              :disabled="busy"
              @click="confirmingClose = false; run(() => closePeriod(selected!.openPeriod!.id))"
            >
              Sí, cerrar mes
            </button>
          </div>
        </div>
      </AppModal>
    </template>
    <template v-else>
      <p class="hint">La caja no tiene un mes abierto.</p>
      <form v-if="canManage && selected.active" class="form-grid" @submit.prevent="submitOpen">
        <label v-if="periods.length === 0" class="field">
          Mes
          <input v-model="openMonthForm.month" type="month" required :max="today.slice(0, 7)" />
        </label>
        <p v-else class="hint">
          Se abre el mes siguiente al último cerrado, con su saldo final ({{ formatUsd(periods[0]?.closingBalanceCents ?? 0) }})
          como saldo inicial.
        </p>
        <label class="field">
          Reposición (USD)
          <input v-model="openMonthForm.amount" inputmode="decimal" :required="periods.length === 0" placeholder="0.00" />
        </label>
        <div class="actions">
          <button type="submit" class="button button-primary" :disabled="busy">Abrir mes</button>
        </div>
      </form>
    </template>

    <AppModal :open="voucherFormOpen" title="Solicitar vale" @close="voucherFormOpen = false">
      <form class="form-grid" @submit.prevent="submitVoucher">
        <label class="field">
          Concepto
          <input v-model="voucherForm.concept" required minlength="3" maxlength="200" />
        </label>
        <label class="field">
          Beneficiario
          <input v-model="voucherForm.beneficiary" required maxlength="120" />
        </label>
        <label class="field">
          Monto (USD)
          <input v-model="voucherForm.amount" inputmode="decimal" required placeholder="50.00" />
        </label>
        <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
        <div class="actions">
          <button type="button" class="button" @click="voucherFormOpen = false">Cancelar</button>
          <button type="submit" class="button button-primary" :disabled="busy">Solicitar</button>
        </div>
      </form>
    </AppModal>

    <AppModal
      :open="Boolean(voucherAction)"
      :title="
        voucherAction
          ? `${voucherAction.type === 'reject' ? 'Rechazar' : 'Rendir'} vale #${voucherAction.voucher.id} · ${voucherAction.voucher.concept}`
          : ''
      "
      @close="voucherAction = null"
    >
      <form v-if="voucherAction" class="form-grid" @submit.prevent="submitVoucherAction">
        <label v-if="voucherAction.type === 'reject'" class="field">
          Motivo
          <input v-model="actionForm.reason" required minlength="5" maxlength="500" />
        </label>
        <template v-else>
          <label class="field">
            Gastado (USD)
            <input v-model="actionForm.spent" inputmode="decimal" required />
            <span class="hint">Desembolsado: {{ formatUsd(voucherAction.voucher.amountCents) }}. Lo no gastado vuelve a la caja.</span>
          </label>
          <label class="field">
            Número de comprobante
            <input v-model="actionForm.receiptReference" required maxlength="120" />
          </label>
          <label class="field">
            Fecha del comprobante
            <input v-model="actionForm.receiptDate" type="date" required :max="today" />
          </label>
        </template>
        <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
        <div class="actions">
          <button type="button" class="button" @click="voucherAction = null">Volver</button>
          <button
            type="submit"
            class="button"
            :class="voucherAction.type === 'reject' ? 'button-danger-solid' : 'button-primary'"
            :disabled="busy"
          >
            {{ voucherAction.type === 'reject' ? 'Rechazar vale' : 'Rendir vale' }}
          </button>
        </div>
      </form>
    </AppModal>

    <AppModal
      :open="Boolean(voucherConfirm)"
      :title="voucherConfirm ? `${VOUCHER_CONFIRM_TEXT[voucherConfirm.kind].title} #${voucherConfirm.voucher.id}` : ''"
      @close="voucherConfirm = null"
    >
      <div v-if="voucherConfirm" class="form-grid">
        <p class="hint">
          {{ voucherConfirm.voucher.concept }} · {{ voucherConfirm.voucher.beneficiary }} ·
          <strong>{{ formatUsd(voucherConfirm.voucher.amountCents) }}</strong>
        </p>
        <p v-if="voucherConfirm.kind === 'approve'" class="hint">El monto queda reservado en la caja hasta que se desembolse.</p>
        <p v-else-if="voucherConfirm.kind === 'disburse'" class="hint">
          Confirma que entregaste {{ formatUsd(voucherConfirm.voucher.amountCents) }} a {{ voucherConfirm.voucher.beneficiary }}.
          Después deberá rendirlo con un comprobante.
        </p>
        <p v-else class="hint">El vale deja de estar pendiente y no se puede reactivar.</p>
        <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
        <div class="actions">
          <button type="button" class="button" @click="voucherConfirm = null">Volver</button>
          <button
            type="button"
            class="button"
            :class="voucherConfirm.kind === 'cancel' ? 'button-danger-solid' : 'button-primary'"
            :disabled="busy"
            @click="confirmVoucher"
          >
            {{ VOUCHER_CONFIRM_TEXT[voucherConfirm.kind].button }}
          </button>
        </div>
      </div>
    </AppModal>

    <p v-if="detailError" class="error section-gap" role="alert">{{ detailError }}</p>

    <h2 class="section-gap">
      Vales<template v-if="viewedPeriod"> de {{ monthLabel(viewedPeriod) }}</template>
    </h2>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Vale</th>
            <th scope="col">Concepto</th>
            <th scope="col">Beneficiario</th>
            <th scope="col" class="num">Monto</th>
            <th scope="col">Estado</th>
            <th scope="col">Rendición</th>
            <th scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="voucher in vouchers" :key="voucher.id">
            <td class="nowrap">#{{ voucher.id }}</td>
            <td>
              {{ voucher.concept }}
              <span class="permission-code">Solicitado por {{ voucher.requestedBy?.name }}</span>
            </td>
            <td>{{ voucher.beneficiary }}</td>
            <td class="num">{{ formatUsd(voucher.amountCents) }}</td>
            <td>
              <StatusBadge :label="VOUCHER_STATUS_LABELS[voucher.status]" :tone="VOUCHER_STATUS_TONES[voucher.status]" />
              <span v-if="voucher.rejectionReason" class="permission-code">{{ voucher.rejectionReason }}</span>
            </td>
            <td>
              <template v-if="voucher.status === 'SETTLED'">
                Gastado {{ formatUsd(voucher.spentCents ?? 0) }}
                <span class="permission-code">
                  Devuelto {{ formatUsd(voucher.returnedCents ?? 0) }} · Comprobante {{ voucher.receiptReference }} del
                  {{ formatDate(voucher.receiptDate) }}
                </span>
              </template>
            </td>
            <td>
              <div class="actions">
                <template v-if="voucher.status === 'REQUESTED'">
                  <button v-if="canManage" type="button" class="button button-danger" @click="openVoucherAction('reject', voucher)">
                    Rechazar
                  </button>
                  <button v-if="canManage" type="button" class="button button-primary" :disabled="busy" @click="voucherConfirm = { kind: 'approve', voucher }">
                    Aprobar
                  </button>
                  <button v-if="isOwnVoucher(voucher)" type="button" class="button button-danger" :disabled="busy" @click="voucherConfirm = { kind: 'cancel', voucher }">
                    Cancelar
                  </button>
                </template>
                <button
                  v-if="voucher.status === 'APPROVED' && canManage"
                  type="button"
                  class="button button-primary"
                  :disabled="busy"
                  @click="voucherConfirm = { kind: 'disburse', voucher }"
                >
                  Desembolsar
                </button>
                <button
                  v-if="voucher.status === 'DISBURSED' && isOwnVoucher(voucher)"
                  type="button"
                  class="button button-primary"
                  @click="openVoucherAction('settle', voucher)"
                >
                  Rendir
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="vouchers.length === 0">
            <td colspan="7">No hay vales en este mes.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 class="section-gap">Meses</h2>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col">Estado</th>
            <th scope="col" class="num">Saldo inicial</th>
            <th scope="col" class="num">Reposición</th>
            <th scope="col" class="num">Gastado</th>
            <th scope="col" class="num">Saldo final</th>
            <th scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="period in periods" :key="period.id">
            <td class="nowrap">{{ monthLabel(period) }}</td>
            <td><StatusBadge :label="period.status === 'OPEN' ? 'Abierto' : 'Cerrado'" :tone="period.status === 'OPEN' ? 'success' : 'neutral'" /></td>
            <td class="num">{{ formatUsd(period.openingBalanceCents) }}</td>
            <td class="num">{{ formatUsd(period.replenishmentCents) }}</td>
            <td class="num">{{ formatUsd(period.spentCents) }}</td>
            <td class="num">{{ period.closingBalanceCents === null ? '' : formatUsd(period.closingBalanceCents) }}</td>
            <td>
              <button v-if="period.id !== viewedPeriodId" type="button" class="button" @click="viewPeriod(period.id)">
                Ver vales
              </button>
            </td>
          </tr>
          <tr v-if="periods.length === 0">
            <td colspan="7">La caja todavía no tiene meses.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  </template>

  <template v-if="!selected">
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
          <th scope="col">Estado</th>
          <th scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fund in funds" :key="fund.id">
          <td>{{ fund.name }}</td>
          <td class="nowrap" :title="fund.project.name">{{ fund.project.code }}</td>
          <td class="nowrap">{{ fund.openPeriod ? monthLabel(fund.openPeriod) : 'Ninguno' }}</td>
          <td class="num">{{ fund.openPeriod ? formatUsd(fund.openPeriod.availableCents) : '' }}</td>
          <td><StatusBadge :label="fund.active ? 'Activa' : 'Inactiva'" :tone="activeTone(fund.active)" /></td>
          <td>
            <div class="actions">
              <RouterLink class="button" :to="{ name: 'petty-cash', query: { fund: fund.id } }">Ver</RouterLink>
              <button v-if="canManage" type="button" class="button" @click="openForm(fund)">Editar</button>
            </div>
          </td>
        </tr>
        <tr v-if="funds.length === 0">
          <td colspan="6">No hay cajas chicas.</td>
        </tr>
      </tbody>
    </table>
  </div>
  </template>
</template>
