<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ACCRUAL_STATUS_LABELS } from '@/api/accruals';
import { listAreas, type Area } from '@/api/areas';
import { errorMessage } from '@/api/http';
import { listPeople, type Person } from '@/api/people';
import { listProjects, type Project } from '@/api/projects';
import {
  getBalances,
  getPaymentsReport,
  getPersonStatement,
  receiptPdfUrl,
  type BalancesReport,
  type GroupBy,
  type PaymentsReport,
  type PersonStatement,
  type ReportFilters,
} from '@/api/reports';
import { formatUsd } from '@/lib/money';

type Tab = 'balances' | 'payments' | 'statement';

const TABS: { value: Tab; label: string }[] = [
  { value: 'balances', label: 'Saldos' },
  { value: 'payments', label: 'Pagos' },
  { value: 'statement', label: 'Estado de cuenta' },
];

const tab = ref<Tab>('balances');
const projects = ref<Project[]>([]);
const areas = ref<Area[]>([]);
const people = ref<Person[]>([]);
const loading = ref(false);
const error = ref('');

const filters = reactive({ projectId: 0, areaId: 0, personId: 0, from: '', to: '', groupBy: 'person' as GroupBy });

const balances = ref<BalancesReport | null>(null);
const payments = ref<PaymentsReport | null>(null);
const statement = ref<PersonStatement | null>(null);

function currentFilters(): ReportFilters {
  return {
    projectId: filters.projectId || undefined,
    areaId: filters.areaId || undefined,
    personId: filters.personId || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  };
}

async function load() {
  error.value = '';
  if (tab.value === 'statement' && !filters.personId) {
    statement.value = null;
    return;
  }
  loading.value = true;
  try {
    const current = currentFilters();
    if (tab.value === 'balances') balances.value = await getBalances(filters.groupBy, current);
    if (tab.value === 'payments') payments.value = await getPaymentsReport(current);
    if (tab.value === 'statement') {
      const { personId, ...rest } = current;
      statement.value = await getPersonStatement(personId!, rest);
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function selectTab(value: Tab) {
  tab.value = value;
  void load();
}

function openStatement(personId: number) {
  filters.personId = personId;
  selectTab('statement');
}

onMounted(async () => {
  try {
    [projects.value, areas.value, people.value] = await Promise.all([listProjects(), listAreas(), listPeople()]);
  } catch (e) {
    error.value = errorMessage(e);
  }
  await load();
});
</script>

<template>
  <div class="page-header">
    <h1>Reportes</h1>
  </div>
  <p class="hint">
    Cuánto se ha causado, cuánto se ha pagado, cuándo, a quién, por qué proyecto y cuánto se le adeuda a cada persona.
  </p>

  <div class="actions section-gap" role="tablist" aria-label="Tipo de reporte">
    <button
      v-for="item in TABS"
      :key="item.value"
      type="button"
      role="tab"
      :aria-selected="tab === item.value"
      class="button"
      :class="{ 'button-primary': tab === item.value }"
      @click="selectTab(item.value)"
    >
      {{ item.label }}
    </button>
  </div>

  <form class="card form-grid section-gap" @submit.prevent="load">
    <label v-if="tab === 'balances'" class="field">
      Agrupar por
      <select v-model="filters.groupBy">
        <option value="person">Persona</option>
        <option value="project">Proyecto</option>
      </select>
    </label>
    <label class="field">
      Persona
      <select v-model.number="filters.personId" :required="tab === 'statement'">
        <option :value="0" :disabled="tab === 'statement'">{{ tab === 'statement' ? 'Selecciona una persona' : 'Todas' }}</option>
        <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }} · {{ person.idNumber }}</option>
      </select>
    </label>
    <label class="field">
      Proyecto
      <select v-model.number="filters.projectId">
        <option :value="0">Todos</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
      </select>
    </label>
    <label v-if="tab !== 'statement'" class="field">
      Área
      <select v-model.number="filters.areaId">
        <option :value="0">Todas</option>
        <option v-for="area in areas" :key="area.id" :value="area.id">{{ area.name }}</option>
      </select>
    </label>
    <label class="field">
      Desde
      <input v-model="filters.from" type="date" />
    </label>
    <label class="field">
      Hasta
      <input v-model="filters.to" type="date" />
    </label>
    <div class="actions">
      <button type="submit" class="button button-primary" :disabled="loading">Consultar</button>
    </div>
    <p class="hint">
      <template v-if="tab === 'payments'">Las fechas filtran por el día de entrega del pago.</template>
      <template v-else>
        Las causaciones se filtran por la fecha de fin de su período. Lo pagado es lo aplicado a esas causaciones, sin
        importar la fecha del pago.
      </template>
    </p>
  </form>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>

  <template v-else-if="tab === 'balances' && balances">
    <p>
      Causado <strong>{{ formatUsd(balances.totals.accruedCents) }}</strong> · Pagado
      <strong>{{ formatUsd(balances.totals.paidCents) }}</strong> · Adeudado
      <strong>{{ formatUsd(balances.totals.owedCents) }}</strong>
    </p>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">{{ balances.groupBy === 'person' ? 'Persona' : 'Proyecto' }}</th>
            <th v-if="balances.groupBy === 'project'" scope="col">Área</th>
            <th scope="col">Causaciones</th>
            <th scope="col">Causado</th>
            <th scope="col">Pagado</th>
            <th scope="col">Adeudado</th>
            <th v-if="balances.groupBy === 'person'" scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in balances.rows" :key="row.person?.id ?? row.project?.id">
            <td v-if="row.person">
              {{ row.person.name }}
              <span class="permission-code">{{ row.person.idNumber }}</span>
            </td>
            <td v-else-if="row.project">
              {{ row.project.code }}
              <span class="permission-code">{{ row.project.name }}</span>
            </td>
            <td v-if="row.project">{{ row.project.area.name }}</td>
            <td>{{ row.accrualCount }}</td>
            <td class="nowrap">{{ formatUsd(row.accruedCents) }}</td>
            <td class="nowrap">{{ formatUsd(row.paidCents) }}</td>
            <td class="nowrap">{{ formatUsd(row.owedCents) }}</td>
            <td v-if="row.person">
              <button type="button" class="button" @click="openStatement(row.person.id)">Estado de cuenta</button>
            </td>
          </tr>
          <tr v-if="balances.rows.length === 0">
            <td colspan="6">No hay causaciones con esos filtros.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>

  <template v-else-if="tab === 'payments' && payments">
    <p>
      {{ payments.totals.paymentCount }} pagos vigentes por <strong>{{ formatUsd(payments.totals.amountCents) }}</strong>
      <template v-if="payments.totals.annulledCount > 0"> · {{ payments.totals.annulledCount }} anulados (no suman)</template>
    </p>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Recibo</th>
            <th scope="col">Persona</th>
            <th scope="col">Proyecto</th>
            <th scope="col">Solicitud</th>
            <th scope="col">Monto</th>
            <th scope="col">Referencia</th>
            <th scope="col">Estado</th>
            <th scope="col"><span class="sr-only">PDF</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="payment in payments.payments" :key="payment.id">
            <td class="nowrap">{{ payment.paidOn }}</td>
            <td class="nowrap">#{{ payment.id }}</td>
            <td>
              {{ payment.person.name }}
              <span class="permission-code">{{ payment.person.idNumber }}</span>
            </td>
            <td class="nowrap" :title="payment.project.name">{{ payment.project.code }}</td>
            <td class="nowrap">#{{ payment.requestId }}</td>
            <td class="nowrap">{{ formatUsd(payment.amountCents) }}</td>
            <td>{{ payment.reference }}</td>
            <td>
              {{ payment.annulledAt ? 'Anulado' : 'Vigente' }}
              <span v-if="payment.annulmentReason" class="permission-code">{{ payment.annulmentReason }}</span>
            </td>
            <td>
              <a class="button" :href="receiptPdfUrl(payment.id)" target="_blank" rel="noopener">Recibo PDF</a>
            </td>
          </tr>
          <tr v-if="payments.payments.length === 0">
            <td colspan="9">No hay pagos con esos filtros.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>

  <template v-else-if="tab === 'statement'">
    <p v-if="!statement" class="hint">Selecciona una persona y pulsa Consultar.</p>
    <template v-else>
      <h2>{{ statement.person.name }} · {{ statement.person.idNumber }}</h2>
      <p>
        Causado <strong>{{ formatUsd(statement.totals.accruedCents) }}</strong> · Pagado
        <strong>{{ formatUsd(statement.totals.paidCents) }}</strong> · Adeudado
        <strong>{{ formatUsd(statement.totals.owedCents) }}</strong>
      </p>

      <h2 class="section-gap">Causaciones</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Período</th>
              <th scope="col">Proyecto</th>
              <th scope="col">Días</th>
              <th scope="col">Causado</th>
              <th scope="col">Pagado</th>
              <th scope="col">Adeudado</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="accrual in statement.accruals" :key="accrual.id">
              <td class="nowrap">
                {{ accrual.period.startDate }} al {{ accrual.period.endDate }}
                <span class="permission-code">{{ accrual.period.paymentGroup.name }} · Causación #{{ accrual.id }}</span>
              </td>
              <td class="nowrap" :title="accrual.project.name">{{ accrual.project.code }}</td>
              <td class="nowrap">{{ accrual.activeDays }} / {{ accrual.periodDays }}</td>
              <td class="nowrap">{{ formatUsd(accrual.amountCents) }}</td>
              <td class="nowrap">{{ formatUsd(accrual.paidCents) }}</td>
              <td class="nowrap">{{ formatUsd(accrual.owedCents) }}</td>
              <td>{{ ACCRUAL_STATUS_LABELS[accrual.status] }}</td>
            </tr>
            <tr v-if="statement.accruals.length === 0">
              <td colspan="7">No hay causaciones con esos filtros.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="section-gap">Pagos</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Recibo</th>
              <th scope="col">Proyecto</th>
              <th scope="col">Monto</th>
              <th scope="col">Estado</th>
              <th scope="col"><span class="sr-only">PDF</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="payment in statement.payments" :key="payment.id">
              <td class="nowrap">{{ payment.paidOn }}</td>
              <td class="nowrap">#{{ payment.id }}</td>
              <td class="nowrap" :title="payment.project.name">{{ payment.project.code }}</td>
              <td class="nowrap">{{ formatUsd(payment.amountCents) }}</td>
              <td>
                {{ payment.annulledAt ? 'Anulado' : 'Vigente' }}
                <span v-if="payment.annulmentReason" class="permission-code">{{ payment.annulmentReason }}</span>
              </td>
              <td>
                <a class="button" :href="receiptPdfUrl(payment.id)" target="_blank" rel="noopener">Recibo PDF</a>
              </td>
            </tr>
            <tr v-if="statement.payments.length === 0">
              <td colspan="6">No hay pagos con esos filtros.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>
</template>
