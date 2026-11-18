<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  annulAssignment,
  changeAssignmentAmount,
  createAssignment,
  listAssignments,
  updateAssignmentEndDate,
  type Assignment,
} from '@/api/assignments';
import { errorMessage } from '@/api/http';
import { listPaymentGroups, type PaymentGroup } from '@/api/payment-groups';
import { listPeople, type Person } from '@/api/people';
import { listProjects, type Project } from '@/api/projects';
import AppModal from '@/components/AppModal.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { centsToInput, formatUsd, parseUsd } from '@/lib/money';
import type { Tone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';
import { formatDate, formatDateTime, formatRange } from '@/lib/dates';

const auth = useAuthStore();
const route = useRoute();
const canManage = computed(() => auth.can(PERMISSIONS.ASSIGNMENTS_MANAGE));

const assignments = ref<Assignment[]>([]);
const people = ref<Person[]>([]);
const projects = ref<Project[]>([]);
const groups = ref<PaymentGroup[]>([]);
const loading = ref(true);
const error = ref('');

const initialProject = Number(route.query.projectId);
const filters = reactive({
  projectId: Number.isInteger(initialProject) && initialProject > 0 ? initialProject : 0,
  personId: 0,
  openOnly: true,
});

// Fecha local en formato AAAA-MM-DD, para comparar con las fechas de la API.
const today = new Date().toLocaleDateString('sv-SE');

watch(filters, () => void loadAssignments());

function nextDay(date: string) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// El cambio de monto debe aplicar al menos un día después del inicio y antes del fin.
function canChangeAmount(assignment: Assignment) {
  return nextDay(assignment.startDate) <= assignment.effectiveEndDate;
}

type AssignmentStatus = 'Futura' | 'Finalizada' | 'Vigente' | 'Anulada';

const STATUS_TONES: Record<AssignmentStatus, Tone> = {
  Futura: 'info',
  Finalizada: 'neutral',
  Vigente: 'success',
  Anulada: 'danger',
};

// La fecha de fin solo se cambia mientras la asignación y su proyecto siguen en curso:
// lo ya terminado (asignación finalizada o anulada, proyecto vencido o inactivo) no muestra la acción.
function canChangeEnd(assignment: Assignment) {
  if (status(assignment) === 'Finalizada' || status(assignment) === 'Anulada') return false;
  if (assignment.project.endDate < today) return false;
  const project = projects.value.find((p) => p.id === assignment.project.id);
  return project?.active ?? true;
}

function status(assignment: Assignment): AssignmentStatus {
  if (assignment.annulledAt) return 'Anulada';
  if (assignment.startDate > today) return 'Futura';
  if (assignment.effectiveEndDate < today) return 'Finalizada';
  return 'Vigente';
}

const activePeople = computed(() => people.value.filter((person) => person.active));
const activeProjects = computed(() => projects.value.filter((project) => project.active));
const activeGroups = computed(() => groups.value.filter((group) => group.active));

// Si cambian los filtros mientras hay una consulta en vuelo, solo la última actualiza la lista.
let loadSeq = 0;

async function loadAssignments() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const result = await listAssignments({
      projectId: filters.projectId || undefined,
      personId: filters.personId || undefined,
      openOnly: filters.openOnly || undefined,
    });
    if (seq !== loadSeq) return;
    assignments.value = result;
  } catch (e) {
    if (seq === loadSeq) error.value = errorMessage(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

async function load() {
  try {
    [people.value, projects.value, groups.value] = await Promise.all([
      listPeople(),
      listProjects(),
      listPaymentGroups(),
    ]);
  } catch (e) {
    error.value = errorMessage(e);
  }
  await loadAssignments();
}

// Nueva asignación.
const formOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const form = reactive({ personId: 0, projectId: 0, paymentGroupId: 0, amount: '', startDate: '', endDate: '' });

const selectedProject = computed(() => projects.value.find((project) => project.id === form.projectId));

function openCreate() {
  Object.assign(form, {
    personId: 0,
    // Solo se preselecciona el proyecto del filtro si admite asignaciones nuevas.
    projectId: activeProjects.value.some((project) => project.id === filters.projectId) ? filters.projectId : 0,
    paymentGroupId: 0,
    amount: '',
    startDate: '',
    endDate: '',
  });
  formError.value = '';
  formOpen.value = true;
}

async function save() {
  formError.value = '';
  // Las opciones "Selecciona…" tienen valor 0 y el navegador las acepta como elegidas.
  if (!form.personId || !form.projectId || !form.paymentGroupId) {
    formError.value = 'Selecciona la persona, el proyecto y el grupo de pago';
    return;
  }
  const amountCents = parseUsd(form.amount);
  if (amountCents === null || amountCents === 0) {
    formError.value = 'Escribe un monto válido, por ejemplo 150 o 150.50';
    return;
  }
  saving.value = true;
  try {
    await createAssignment({
      personId: form.personId,
      projectId: form.projectId,
      paymentGroupId: form.paymentGroupId,
      amountCents,
      startDate: form.startDate,
      endDate: form.endDate || null,
    });
    formOpen.value = false;
    await load();
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// Acciones sobre una asignación existente: cambiar la fecha de fin o el monto.
const action = ref<{ type: 'end' | 'amount'; assignment: Assignment } | null>(null);
const actionSaving = ref(false);
const actionError = ref('');
const actionForm = reactive({ endDate: '', effectiveDate: '', amount: '' });

function openAction(type: 'end' | 'amount', assignment: Assignment) {
  action.value = { type, assignment };
  Object.assign(actionForm, {
    endDate: assignment.endDate ?? '',
    effectiveDate: '',
    amount: centsToInput(assignment.amountCents),
  });
  actionError.value = '';
}

async function saveAction() {
  if (!action.value) return;
  const { type, assignment } = action.value;
  actionError.value = '';

  const amountCents = parseUsd(actionForm.amount);
  if (type === 'amount' && (amountCents === null || amountCents === 0)) {
    actionError.value = 'Escribe un monto válido, por ejemplo 150 o 150.50';
    return;
  }

  actionSaving.value = true;
  try {
    if (type === 'end') {
      await updateAssignmentEndDate(assignment.id, actionForm.endDate || null);
    } else {
      await changeAssignmentAmount(assignment.id, { effectiveDate: actionForm.effectiveDate, amountCents: amountCents! });
    }
    action.value = null;
    await loadAssignments();
  } catch (e) {
    actionError.value = errorMessage(e);
  } finally {
    actionSaving.value = false;
  }
}

// Anulación: la asignación no se borra, queda anulada con motivo y deja de contar.
const annulTarget = ref<Assignment | null>(null);
const annulReason = ref('');
const annulSaving = ref(false);
const annulError = ref('');

function openAnnul(assignment: Assignment) {
  annulTarget.value = assignment;
  annulReason.value = '';
  annulError.value = '';
}

async function saveAnnul() {
  if (!annulTarget.value) return;
  annulSaving.value = true;
  annulError.value = '';
  try {
    await annulAssignment(annulTarget.value.id, annulReason.value);
    annulTarget.value = null;
    await loadAssignments();
  } catch (e) {
    annulError.value = errorMessage(e);
  } finally {
    annulSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Asignaciones</h1>
    <div class="actions">
      <button v-if="canManage" type="button" class="button button-primary" @click="openCreate">
        Nueva asignación
      </button>
    </div>
  </div>
  <p class="hint">
    Monto en USD que cobra una persona por cada período completo de su grupo de pago en un proyecto. Los grupos se configuran
    en <RouterLink :to="{ name: 'payment-groups' }">Grupos de pago</RouterLink>.
  </p>

  <AppModal :open="formOpen" title="Nueva asignación" @close="formOpen = false">
    <form class="form-grid" @submit.prevent="save">
      <label class="field">
        Persona
        <select v-model.number="form.personId" required>
          <option :value="0" disabled>Selecciona una persona</option>
          <option v-for="person in activePeople" :key="person.id" :value="person.id">
            {{ person.name }} ({{ person.idNumber }})
          </option>
        </select>
      </label>
      <label class="field">
        Proyecto
        <select v-model.number="form.projectId" required>
          <option :value="0" disabled>Selecciona un proyecto</option>
          <option v-for="project in activeProjects" :key="project.id" :value="project.id">
            {{ project.code }} · {{ project.name }}
          </option>
        </select>
        <span v-if="selectedProject" class="hint">
          Vigencia: {{ formatRange(selectedProject.startDate, selectedProject.endDate) }}
        </span>
      </label>
      <label class="field">
        Grupo de pago
        <select v-model.number="form.paymentGroupId" required>
          <option :value="0" disabled>Selecciona un grupo</option>
          <option v-for="group in activeGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
        </select>
      </label>
      <label class="field">
        Monto por período (USD)
        <input v-model="form.amount" inputmode="decimal" required placeholder="150.00" />
        <span class="hint">Lo que cobra por cada período completo del grupo.</span>
      </label>
      <p class="notice field-wide">
        <strong>Desde y hasta</strong> son los días en que la persona trabaja en el proyecto y gana su asignación. Los
        <strong>períodos</strong> del grupo de pago son el calendario de corte y pago. Si la persona trabaja solo una parte de
        un período, cobra la proporción de días (prorrateo).
      </p>
      <label class="field">
        Desde (primer día que cobra)
        <input
          v-model="form.startDate"
          type="date"
          required
          :min="selectedProject?.startDate"
          :max="selectedProject?.endDate"
        />
      </label>
      <label class="field">
        Hasta (último día que cobra, opcional)
        <input v-model="form.endDate" type="date" :min="form.startDate" :max="selectedProject?.endDate" />
        <span class="hint">Vacío: cobra hasta el fin de la vigencia del proyecto.</span>
      </label>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="actions">
        <button type="button" class="button" @click="formOpen = false">Cancelar</button>
        <button type="submit" class="button button-primary" :disabled="saving">Guardar</button>
      </div>
    </form>
  </AppModal>

  <AppModal
    :open="Boolean(action)"
    :title="
      action
        ? `${action.type === 'end' ? 'Cambiar fecha de fin' : 'Cambiar monto'} · ${action.assignment.person.name} (${action.assignment.project.code})`
        : ''
    "
    @close="action = null"
  >
    <form v-if="action" class="form-grid" @submit.prevent="saveAction">
      <template v-if="action.type === 'end'">
        <p class="hint">
          Es el último día en que {{ action.assignment.person.name }} gana esta asignación en el proyecto. Desde el día
          siguiente ya no se le causa nada; si el fin cae a mitad de un período, ese período se paga en proporción a los
          días trabajados. No se puede mover a una fecha que cambie días de un período ya causado.
        </p>
        <label class="field">
          Último día que cobra
          <input
            v-model="actionForm.endDate"
            type="date"
            :min="action.assignment.startDate"
            :max="action.assignment.project.endDate"
          />
          <span class="hint">Vacío: cobra hasta el fin de la vigencia del proyecto.</span>
        </label>
      </template>
      <template v-else>
        <label class="field">
          Nuevo monto por período (USD)
          <input v-model="actionForm.amount" inputmode="decimal" required />
        </label>
        <label class="field">
          Aplica desde
          <input
            v-model="actionForm.effectiveDate"
            type="date"
            required
            :min="nextDay(action.assignment.startDate)"
            :max="action.assignment.effectiveEndDate"
          />
        </label>
        <p class="hint">
          La asignación actual se cierra el día anterior y se crea una nueva con el nuevo monto, para conservar el historial.
        </p>
      </template>
      <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      <div class="actions">
        <button type="button" class="button" @click="action = null">Cancelar</button>
        <button type="submit" class="button button-primary" :disabled="actionSaving">Guardar</button>
      </div>
    </form>
  </AppModal>

  <AppModal
    :open="Boolean(annulTarget)"
    :title="annulTarget ? `Anular asignación · ${annulTarget.person.name} (${annulTarget.project.code})` : ''"
    @close="annulTarget = null"
  >
    <form v-if="annulTarget" class="form-grid" @submit.prevent="saveAnnul">
      <p class="hint">
        {{ annulTarget.person.name }} · {{ annulTarget.paymentGroup.name }} · {{ formatUsd(annulTarget.amountCents) }} por período,
        del {{ formatDate(annulTarget.startDate) }} al {{ formatDate(annulTarget.effectiveEndDate) }}.
      </p>
      <p class="hint">
        La asignación no se borra: queda registrada como anulada, con tu nombre y el motivo, y deja de causarse. No se puede
        deshacer. Si ya tiene causaciones vigentes, primero hay que anularlas en Causación.
      </p>
      <label class="field field-wide">
        Motivo
        <input v-model="annulReason" required minlength="5" maxlength="500" />
      </label>
      <p v-if="annulError" class="error" role="alert">{{ annulError }}</p>
      <div class="actions">
        <button type="button" class="button" @click="annulTarget = null">Volver</button>
        <button type="submit" class="button button-danger-solid" :disabled="annulSaving">Anular asignación</button>
      </div>
    </form>
  </AppModal>

  <form class="card form-grid section-gap" @submit.prevent>
    <label class="field">
      Proyecto
      <select v-model.number="filters.projectId">
        <option :value="0">Todos</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }} · {{ project.name }}</option>
      </select>
    </label>
    <label class="field">
      Persona
      <select v-model.number="filters.personId">
        <option :value="0">Todas</option>
        <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }}</option>
      </select>
    </label>
    <label class="switch">
      <input v-model="filters.openOnly" type="checkbox" role="switch" />
      <span class="switch-slider"></span>
      Solo vigentes o futuras
    </label>
  </form>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Persona</th>
          <th scope="col">Proyecto</th>
          <th scope="col">Grupo de pago</th>
          <th scope="col" class="num">Monto por período</th>
          <th scope="col" title="Primer día que cobra">Desde</th>
          <th scope="col" title="Último día que cobra">Hasta</th>
          <th scope="col">Estado</th>
          <th v-if="canManage" scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="assignment in assignments" :key="assignment.id">
          <td>
            {{ assignment.person.name }}
            <span class="permission-code">{{ assignment.person.idNumber }}</span>
          </td>
          <td class="nowrap" :title="assignment.project.name">{{ assignment.project.code }}</td>
          <td>{{ assignment.paymentGroup.name }}</td>
          <td class="num">{{ formatUsd(assignment.amountCents) }}</td>
          <td class="nowrap">{{ formatDate(assignment.startDate) }}</td>
          <td class="nowrap">
            {{ formatDate(assignment.effectiveEndDate) }}
            <span v-if="assignment.endDate === null" class="permission-code">fin del proyecto</span>
          </td>
          <td>
            <StatusBadge :label="status(assignment)" :tone="STATUS_TONES[status(assignment)]" />
            <span v-if="assignment.annulmentReason" class="permission-code">{{ assignment.annulmentReason }}</span>
            <span v-if="assignment.annulledBy" class="permission-code">
              Por {{ assignment.annulledBy.name }}, {{ formatDateTime(assignment.annulledAt!) }}
            </span>
          </td>
          <td v-if="canManage">
            <div v-if="!assignment.annulledAt" class="actions">
              <button
                v-if="status(assignment) !== 'Finalizada' && canChangeAmount(assignment)"
                type="button"
                class="button"
                @click="openAction('amount', assignment)"
              >
                Monto
              </button>
              <button v-if="canChangeEnd(assignment)" type="button" class="button" @click="openAction('end', assignment)">
                Fecha de fin
              </button>
              <button type="button" class="button button-danger" @click="openAnnul(assignment)">Anular</button>
            </div>
          </td>
        </tr>
        <tr v-if="assignments.length === 0">
          <td :colspan="canManage ? 8 : 7">No hay asignaciones con esos filtros.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
