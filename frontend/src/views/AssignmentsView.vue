<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
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
import { centsToInput, formatUsd, parseUsd } from '@/lib/money';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

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
  openOnly: false,
});

// Fecha local en formato AAAA-MM-DD, para comparar con las fechas de la API.
const today = new Date().toLocaleDateString('sv-SE');

function status(assignment: Assignment) {
  if (assignment.startDate > today) return 'Futura';
  if (assignment.effectiveEndDate < today) return 'Finalizada';
  return 'Vigente';
}

const activePeople = computed(() => people.value.filter((person) => person.active));
const activeProjects = computed(() => projects.value.filter((project) => project.active));
const activeGroups = computed(() => groups.value.filter((group) => group.active));

async function loadAssignments() {
  loading.value = true;
  error.value = '';
  try {
    assignments.value = await listAssignments({
      projectId: filters.projectId || undefined,
      personId: filters.personId || undefined,
      openOnly: filters.openOnly || undefined,
    });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
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
    projectId: filters.projectId,
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

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Asignaciones</h1>
    <button v-if="canManage" type="button" class="button button-primary" @click="openCreate">
      Nueva asignación
    </button>
  </div>
  <p class="hint">Monto en USD que cobra una persona por cada período completo de su grupo de pago en un proyecto.</p>

  <form v-if="formOpen" class="card form-grid section-gap" @submit.prevent="save">
    <h2>Nueva asignación</h2>
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
        Vigencia: {{ selectedProject.startDate }} al {{ selectedProject.endDate }}
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
    </label>
    <label class="field">
      Desde
      <input
        v-model="form.startDate"
        type="date"
        required
        :min="selectedProject?.startDate"
        :max="selectedProject?.endDate"
      />
    </label>
    <label class="field">
      Hasta (opcional)
      <input v-model="form.endDate" type="date" :min="form.startDate" :max="selectedProject?.endDate" />
      <span class="hint">Vacío: hasta el fin de la vigencia del proyecto.</span>
    </label>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
    <div class="actions">
      <button type="submit" class="button button-primary" :disabled="saving">Guardar</button>
      <button type="button" class="button" @click="formOpen = false">Cancelar</button>
    </div>
  </form>

  <form v-if="action" class="card form-grid section-gap" @submit.prevent="saveAction">
    <h2>
      {{ action.type === 'end' ? 'Cambiar fecha de fin' : 'Cambiar monto' }} ·
      {{ action.assignment.person.name }}, {{ action.assignment.project.code }}
    </h2>
    <template v-if="action.type === 'end'">
      <label class="field">
        Hasta
        <input v-model="actionForm.endDate" type="date" :min="action.assignment.startDate" />
        <span class="hint">Vacío: hasta el fin de la vigencia del proyecto.</span>
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
          :min="action.assignment.startDate"
          :max="action.assignment.effectiveEndDate"
        />
      </label>
      <p class="hint">
        La asignación actual se cierra el día anterior y se crea una nueva con el nuevo monto, para conservar el historial.
      </p>
    </template>
    <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
    <div class="actions">
      <button type="submit" class="button button-primary" :disabled="actionSaving">Guardar</button>
      <button type="button" class="button" @click="action = null">Cancelar</button>
    </div>
  </form>

  <form class="card form-grid section-gap" @submit.prevent="loadAssignments">
    <label class="field">
      Proyecto
      <select v-model.number="filters.projectId">
        <option :value="0">Todos</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.code }}</option>
      </select>
    </label>
    <label class="field">
      Persona
      <select v-model.number="filters.personId">
        <option :value="0">Todas</option>
        <option v-for="person in people" :key="person.id" :value="person.id">{{ person.name }}</option>
      </select>
    </label>
    <label class="checkbox">
      <input v-model="filters.openOnly" type="checkbox" />
      Solo vigentes o futuras
    </label>
    <div class="actions">
      <button type="submit" class="button">Filtrar</button>
    </div>
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
          <th scope="col">Monto por período</th>
          <th scope="col">Desde</th>
          <th scope="col">Hasta</th>
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
          <td class="nowrap">{{ formatUsd(assignment.amountCents) }}</td>
          <td class="nowrap">{{ assignment.startDate }}</td>
          <td class="nowrap">
            {{ assignment.effectiveEndDate }}
            <span v-if="assignment.endDate === null" class="permission-code">fin del proyecto</span>
          </td>
          <td>{{ status(assignment) }}</td>
          <td v-if="canManage">
            <div v-if="status(assignment) !== 'Finalizada'" class="actions">
              <button type="button" class="button" @click="openAction('amount', assignment)">Monto</button>
              <button type="button" class="button" @click="openAction('end', assignment)">Fecha de fin</button>
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
