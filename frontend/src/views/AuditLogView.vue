<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { listAuditEntries, type AuditEntry, type AuditPage } from '@/api/audit';
import { errorMessage } from '@/api/http';

const ENTITIES: Record<string, string> = {
  User: 'Usuarios',
  Setting: 'Parámetros',
  Area: 'Áreas',
  PaymentGroup: 'Grupos de pago',
  Period: 'Períodos',
  Person: 'Personas',
  Project: 'Proyectos',
  Assignment: 'Asignaciones',
};

const ACTIONS: Record<AuditEntry['action'], string> = {
  CREATE: 'Creación',
  UPDATE: 'Modificación',
  DELETE: 'Eliminación',
};

// Campos que cambian siempre y no aportan al leer el historial.
const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt']);

const filters = reactive({ entity: '', from: '', to: '' });
const result = ref<AuditPage | null>(null);
const loading = ref(true);
const error = ref('');

const totalPages = computed(() => (result.value ? Math.max(1, Math.ceil(result.value.total / result.value.pageSize)) : 1));

async function load(page = 1) {
  loading.value = true;
  error.value = '';
  try {
    result.value = await listAuditEntries({ ...filters, page });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function formatValue(value: unknown) {
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function changes(entry: AuditEntry) {
  const before: Record<string, unknown> = entry.before ?? {};
  const after: Record<string, unknown> = entry.after ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  return [...keys]
    .filter((key) => !IGNORED_FIELDS.has(key))
    .filter((key) => entry.action !== 'UPDATE' || formatValue(before[key]) !== formatValue(after[key]))
    .map((key) => ({
      key,
      before: key in before ? formatValue(before[key]) : null,
      after: key in after ? formatValue(after[key]) : null,
    }));
}

onMounted(() => load());
</script>

<template>
  <h1>Auditoría</h1>

  <form class="card form-grid" @submit.prevent="load()">
    <label class="field">
      Entidad
      <select v-model="filters.entity">
        <option value="">Todas</option>
        <option v-for="(label, value) in ENTITIES" :key="value" :value="value">{{ label }}</option>
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
      <button type="submit" class="button button-primary" :disabled="loading">Filtrar</button>
    </div>
  </form>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <template v-else-if="result">
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Usuario</th>
            <th scope="col">Acción</th>
            <th scope="col">Registro</th>
            <th scope="col">Cambios</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in result.entries" :key="entry.id">
            <td class="nowrap">{{ new Date(entry.createdAt).toLocaleString('es-VE') }}</td>
            <td>{{ entry.user?.name ?? 'Sistema' }}</td>
            <td>{{ ACTIONS[entry.action] }}</td>
            <td class="nowrap">{{ ENTITIES[entry.entity] ?? entry.entity }} #{{ entry.entityId }}</td>
            <td>
              <ul class="changes">
                <li v-for="change in changes(entry)" :key="change.key">
                  <code>{{ change.key }}</code>:
                  <template v-if="entry.action === 'UPDATE'">
                    <span class="old-value">{{ change.before }}</span> → {{ change.after }}
                  </template>
                  <template v-else>{{ change.after ?? change.before }}</template>
                </li>
              </ul>
            </td>
          </tr>
          <tr v-if="result.entries.length === 0">
            <td colspan="5">No hay registros con esos filtros.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="actions section-gap">
      <button type="button" class="button" :disabled="result.page <= 1" @click="load(result.page - 1)">
        Anterior
      </button>
      <span class="hint">Página {{ result.page }} de {{ totalPages }} · {{ result.total }} registros</span>
      <button type="button" class="button" :disabled="result.page >= totalPages" @click="load(result.page + 1)">
        Siguiente
      </button>
    </div>
  </template>
</template>
