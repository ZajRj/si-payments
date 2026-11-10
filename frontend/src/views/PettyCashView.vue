<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
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
import StatusBadge from '@/components/StatusBadge.vue';
import { formatUsd, parseUsd } from '@/lib/money';
import { VOUCHER_STATUS_TONES, activeTone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/lib/dates';

const auth = useAuthStore();
const canManage = computed(() => auth.can(PERMISSIONS.PETTY_CASH_MANAGE));
const canRequest = computed(() => auth.can(PERMISSIONS.PETTY_CASH_REQUEST));

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
const detailEl = ref<HTMLElement | null>(null);

// Abre una caja desde la lista y lleva la vista al detalle, que queda arriba de la lista.
async function openFund(id: number) {
  await selectFund(id);
  await nextTick();
  detailEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
    await selectFund(selected.value.id, viewedPeriodId.value || undefined);
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
  const fundId = Number(route.query.fund);
  if (fundId) await openFund(fundId);
});
</script>

<template>
  <div class="page-header">
    <h1>Cajas chicas</h1>
    <button v-if="canManage" type="button" class="button button-primary" @click="openForm(null)">Nueva caja</button>
  </div>
  <p class="hint">
    Cada caja se asigna a un proyecto y funciona por meses: apertura, vales (solicitud, aprobación, desembolso y rendición
    con comprobante) y cierre. El saldo final pasa al mes siguiente.
  </p>

  <form v-if="formOpen" class="card form-grid section-gap" @submit.prevent="saveFund">
    <h2>{{ editing ? `Editar ${editing.name}` : 'Nueva caja chica' }}</h2>
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
      <button type="submit" class="button button-primary" :disabled="saving">Guardar</button>
      <button type="button" class="button" @click="formOpen = false">Cancelar</button>
    </div>
  </form>

  <section v-if="selected" ref="detailEl" class="card section-gap">
    <div class="page-header">
      <h2>{{ selected.name }} · {{ selected.project.code }}</h2>
      <button type="button" class="button" @click="selected = null; confirmingClose = false">Cerrar detalle</button>
    </div>

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
        <template v-if="canManage && !confirmingClose">
          <button type="button" class="button" :disabled="busy" @click="confirmingClose = true">Cerrar mes</button>
        </template>
        <template v-else-if="canManage">
          <span class="hint">El mes {{ monthLabel(selected.openPeriod) }} se cierra y su saldo pasa al mes siguiente. No se puede deshacer.</span>
          <button
            type="button"
            class="button button-primary"
            :disabled="busy"
            @click="confirmingClose = false; run(() => closePeriod(selected!.openPeriod!.id))"
          >
            Sí, cerrar mes
          </button>
          <button type="button" class="button" @click="confirmingClose = false">No</button>
        </template>
      </div>
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

    <form v-if="voucherFormOpen" class="form-grid section-gap" @submit.prevent="submitVoucher">
      <h2>Solicitar vale</h2>
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
      <div class="actions">
        <button type="submit" class="button button-primary" :disabled="busy">Solicitar</button>
        <button type="button" class="button" @click="voucherFormOpen = false">Cancelar</button>
      </div>
    </form>

    <form v-if="voucherAction" class="form-grid section-gap" @submit.prevent="submitVoucherAction">
      <h2>
        {{ voucherAction.type === 'reject' ? 'Rechazar' : 'Rendir' }} vale #{{ voucherAction.voucher.id }} ·
        {{ voucherAction.voucher.concept }}
      </h2>
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
      <div class="actions">
        <button type="submit" class="button button-primary" :disabled="busy">Confirmar</button>
        <button type="button" class="button" @click="voucherAction = null">Cancelar</button>
      </div>
    </form>

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
                  <button v-if="canManage" type="button" class="button" :disabled="busy" @click="run(() => approveVoucher(voucher.id))">
                    Aprobar
                  </button>
                  <button v-if="canManage" type="button" class="button" @click="openVoucherAction('reject', voucher)">
                    Rechazar
                  </button>
                  <button v-if="canRequest" type="button" class="button" :disabled="busy" @click="run(() => cancelVoucher(voucher.id))">
                    Cancelar
                  </button>
                </template>
                <button
                  v-if="voucher.status === 'APPROVED' && canManage"
                  type="button"
                  class="button"
                  :disabled="busy"
                  @click="run(() => disburseVoucher(voucher.id))"
                >
                  Desembolsar
                </button>
                <button
                  v-if="voucher.status === 'DISBURSED' && canRequest"
                  type="button"
                  class="button"
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
              <button type="button" class="button" @click="openFund(fund.id)">Ver</button>
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
