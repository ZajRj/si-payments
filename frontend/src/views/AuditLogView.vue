<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ACCRUAL_STATUS_LABELS } from '@/api/accruals';
import { listAuditEntries, type AuditAction, type AuditEntry, type AuditPage } from '@/api/audit';
import { errorMessage } from '@/api/http';
import { FREQUENCY_LABELS, type Frequency } from '@/api/payment-groups';
import { REQUEST_STATUS_LABELS } from '@/api/payment-requests';
import { VOUCHER_STATUS_LABELS, monthLabel } from '@/api/petty-cash';
import { listUsers, type User } from '@/api/users';
import AppIcon from '@/components/AppIcon.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { ACTION_TONES, ACTIONS, ENTITY_SINGULAR } from '@/lib/audit-labels';
import { formatDateTime, formatIfDate, formatRange } from '@/lib/dates';
import { formatUsd } from '@/lib/money';
import { ACCRUAL_STATUS_TONES, REQUEST_STATUS_TONES, VOUCHER_STATUS_TONES, activeTone, type Tone } from '@/lib/status';
import { PERMISSIONS } from '@/rbac/permissions';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

const ENTITIES: Record<string, string> = {
  User: 'Usuarios',
  Setting: 'Parámetros',
  Area: 'Áreas',
  PaymentGroup: 'Grupos de pago',
  Period: 'Períodos',
  Person: 'Personas',
  Project: 'Proyectos',
  Assignment: 'Asignaciones',
  Accrual: 'Causaciones',
  AccrualBatch: 'Lotes de causación',
  PaymentRequest: 'Solicitudes de pago',
  Payment: 'Pagos',
  PettyCashFund: 'Cajas chicas',
  PettyCashPeriod: 'Meses de caja chica',
  PettyCashVoucher: 'Vales de caja chica',
};

const SETTING_LABELS: Record<string, string> = {
  'company.name': 'Nombre de la empresa',
  'company.taxId': 'RIF',
  'company.address': 'Dirección',
  'receipts.footer': 'Pie de los recibos',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  code: 'Código',
  email: 'Correo',
  phone: 'Teléfono',
  idNumber: 'Cédula / RIF',
  role: 'Rol',
  roleId: 'Rol',
  active: 'Estado',
  passwordChanged: 'Contraseña',
  key: 'Clave',
  value: 'Valor',
  area: 'Área',
  areaId: 'Área',
  scope: 'Alcance',
  startDate: 'Inicio',
  endDate: 'Fin',
  frequency: 'Frecuencia',
  cutoffDay: 'Día de corte',
  days: 'Días',
  periodDays: 'Días del período',
  activeDays: 'Días activos',
  person: 'Persona',
  personId: 'Persona',
  project: 'Proyecto',
  projectId: 'Proyecto',
  paymentGroup: 'Grupo de pago',
  paymentGroupId: 'Grupo de pago',
  period: 'Período',
  periodId: 'Período',
  batchId: 'Lote',
  accrualId: 'Causación',
  paymentRequestId: 'Solicitud',
  assignmentId: 'Asignación',
  assignmentAmountCents: 'Monto asignado',
  amountCents: 'Monto',
  requestedCents: 'Solicitado',
  paidCents: 'Pagado',
  pendingCents: 'Pendiente',
  outstandingCents: 'Pendiente',
  openingBalanceCents: 'Saldo inicial',
  replenishmentCents: 'Reposición',
  closingBalanceCents: 'Saldo al cierre',
  fundsCents: 'Fondos del mes',
  spentCents: 'Gastado',
  disbursedCents: 'Desembolsado',
  reservedCents: 'Reservado',
  cashCents: 'En caja',
  availableCents: 'Disponible',
  returnedCents: 'Vuelto',
  status: 'Estado',
  notes: 'Notas',
  decisionNote: 'Nota de decisión',
  closingNote: 'Nota de cierre',
  annulmentReason: 'Motivo de anulación',
  rejectionReason: 'Motivo de rechazo',
  concept: 'Concepto',
  beneficiary: 'Beneficiario',
  reference: 'Referencia',
  receiptReference: 'Factura / recibo',
  receiptDate: 'Fecha de factura',
  paidOn: 'Fecha de entrega',
  year: 'Año',
  month: 'Mes',
  personCount: 'Personas',
  voucherCount: 'Vales',
  pendingVoucherCount: 'Vales en curso',
  fund: 'Caja chica',
  fundId: 'Caja chica',
  createdBy: 'Creado por',
  createdById: 'Creado por',
  submittedAt: 'Enviado el',
  decidedAt: 'Decidido el',
  decidedBy: 'Decidido por',
  decidedById: 'Decidido por',
  closedAt: 'Cerrado el',
  closedBy: 'Cerrado por',
  closedById: 'Cerrado por',
  cancelledAt: 'Cancelado el',
  annulledAt: 'Anulado el',
  annulledBy: 'Anulado por',
  annulledById: 'Anulado por',
  openedAt: 'Abierto el',
  openedBy: 'Abierto por',
  openedById: 'Abierto por',
  requestedAt: 'Solicitado el',
  requestedBy: 'Solicitado por',
  requestedById: 'Solicitado por',
  disbursedAt: 'Desembolsado el',
  disbursedBy: 'Desembolsado por',
  disbursedById: 'Desembolsado por',
  settledAt: 'Rendido el',
  settledBy: 'Rendido por',
  settledById: 'Rendido por',
  accruals: 'Causaciones',
  items: 'Partidas',
  allocations: 'Aplicaciones',
};

const STATUS_VALUE_LABELS: Record<string, string> = {
  ...REQUEST_STATUS_LABELS,
  ...ACCRUAL_STATUS_LABELS,
  ...VOUCHER_STATUS_LABELS,
  OPEN: 'Abierto',
  CLOSED: 'Cerrado',
};

const STATUS_VALUE_TONES: Record<string, Tone> = {
  ...REQUEST_STATUS_TONES,
  ...ACCRUAL_STATUS_TONES,
  ...VOUCHER_STATUS_TONES,
  OPEN: 'info',
  CLOSED: 'neutral',
};

const SCOPE_LABELS: Record<string, string> = {
  INTERNAL: 'Interno',
  EXTERNAL: 'Externo',
};

// Campos internos o calculados que no aportan valor en la bitácora.
const IGNORED_FIELDS = new Set([
  'id',
  'updatedAt',
  'createdAt',
  'fundsCents',
  'disbursedCents',
  'reservedCents',
  'cashCents',
  'availableCents',
  'voucherCount',
  'pendingVoucherCount',
]);

// Si el registro ya trae el objeto anidado (por ejemplo `fund`), se omite su clave foránea (`fundId`).
const RELATION_ID_TO_OBJECT: Record<string, string> = {
  fundId: 'fund',
  periodId: 'period',
  projectId: 'project',
  personId: 'person',
  paymentGroupId: 'paymentGroup',
  areaId: 'area',
  roleId: 'role',
  createdById: 'createdBy',
  decidedById: 'decidedBy',
  closedById: 'closedBy',
  annulledById: 'annulledBy',
  openedById: 'openedBy',
  requestedById: 'requestedBy',
  disbursedById: 'disbursedBy',
  settledById: 'settledBy',
};

type BadgeInfo = { label: string; tone: Tone };

type AuditFieldRow = {
  key: string;
  label: string;
  beforeText: string;
  afterText: string;
  beforeBadge: BadgeInfo | null;
  afterBadge: BadgeInfo | null;
  hadBefore: boolean;
  hadAfter: boolean;
  changed: boolean;
};

const users = ref<User[]>([]);
const filters = reactive({
  entity: '',
  action: '' as '' | AuditAction,
  userId: 0,
  entityId: '',
  from: '',
  to: '',
});
const result = ref<AuditPage | null>(null);
const loading = ref(true);
const error = ref('');
const expandedIds = ref<Set<number>>(new Set());

const hasFilters = computed(
  () =>
    Boolean(filters.entity || filters.action || filters.userId || filters.entityId.trim() || filters.from || filters.to),
);

const allExpanded = computed(() => {
  const entries = result.value?.entries ?? [];
  return entries.length > 0 && entries.every((entry) => expandedIds.value.has(entry.id));
});

function isExpanded(id: number) {
  return expandedIds.value.has(id);
}

function toggleRow(id: number) {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
}

function toggleAll() {
  const entries = result.value?.entries ?? [];
  if (allExpanded.value) {
    expandedIds.value = new Set();
  } else {
    expandedIds.value = new Set(entries.map((entry) => entry.id));
  }
}

function clearFilters() {
  Object.assign(filters, { entity: '', action: '', userId: 0, entityId: '', from: '', to: '' });
}

let loadSeq = 0;

async function load(page = 1) {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const cleanEntityId = filters.entityId.trim().replace(/^#/, '');
    const pageData = await listAuditEntries({
      entity: filters.entity || undefined,
      action: filters.action || undefined,
      userId: filters.userId || undefined,
      entityId: cleanEntityId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      page,
    });
    if (seq !== loadSeq) return;
    result.value = pageData;
    expandedIds.value = new Set();
  } catch (e) {
    if (seq === loadSeq) error.value = errorMessage(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(filters, () => void load(1));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function badgeForField(key: string, value: unknown): BadgeInfo | null {
  if (key === 'status' && typeof value === 'string' && value in STATUS_VALUE_LABELS) {
    return {
      label: STATUS_VALUE_LABELS[value]!,
      tone: STATUS_VALUE_TONES[value] ?? 'neutral',
    };
  }
  if (key === 'active' && typeof value === 'boolean') {
    return {
      label: value ? 'Activo' : 'Inactivo',
      tone: activeTone(value),
    };
  }
  return null;
}

function formatObject(key: string, obj: Record<string, unknown>): string {
  if (typeof obj.startDate === 'string' && typeof obj.endDate === 'string') {
    const range = formatRange(obj.startDate, obj.endDate);
    const group = isRecord(obj.paymentGroup) && typeof obj.paymentGroup.name === 'string' ? ` · ${obj.paymentGroup.name}` : '';
    return `${range}${group}`;
  }
  if (typeof obj.year === 'number' && typeof obj.month === 'number') {
    return monthLabel({ year: obj.year, month: obj.month });
  }
  if (typeof obj.name === 'string' && isRecord(obj.project) && typeof obj.project.code === 'string') {
    return `${obj.name} (${obj.project.code})`;
  }
  if (typeof obj.code === 'string' && typeof obj.name === 'string') {
    return key === 'role' ? obj.name : `${obj.code} · ${obj.name}`;
  }
  if (typeof obj.name === 'string' && typeof obj.idNumber === 'string') {
    return `${obj.name} (${obj.idNumber})`;
  }
  if (typeof obj.name === 'string') {
    return obj.name;
  }
  return JSON.stringify(obj, (_k, inner) => (typeof inner === 'string' ? formatIfDate(inner) : inner));
}

function formatArray(items: unknown[]): string {
  if (items.length === 0) return 'Ninguno';
  let totalCents = 0;
  let hasMoney = false;
  for (const item of items) {
    if (isRecord(item)) {
      const cents =
        typeof item.amountCents === 'number'
          ? item.amountCents
          : typeof item.requestedCents === 'number'
            ? item.requestedCents
            : null;
      if (cents !== null) {
        totalCents += cents;
        hasMoney = true;
      }
    }
  }
  const noun = items.length === 1 ? 'registro' : 'registros';
  return hasMoney ? `${items.length} ${noun} (${formatUsd(totalCents)})` : `${items.length} ${noun}`;
}

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'active' && typeof value === 'boolean') return value ? 'Activo' : 'Inactivo';
  if (key === 'passwordChanged' && typeof value === 'boolean') return value ? 'Actualizada' : 'Sin cambios';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (key.endsWith('Cents') && typeof value === 'number') return formatUsd(value);
  if (key === 'month' && typeof value === 'number') return String(value).padStart(2, '0');
  if (
    (key.endsWith('Id') || key === 'batchId' || key === 'accrualId' || key === 'paymentRequestId') &&
    typeof value === 'number'
  ) {
    return `#${value}`;
  }
  if (typeof value === 'string') {
    if (key === 'status' && value in STATUS_VALUE_LABELS) return STATUS_VALUE_LABELS[value]!;
    if (key === 'frequency' && value in FREQUENCY_LABELS) return FREQUENCY_LABELS[value as Frequency];
    if (key === 'scope' && value in SCOPE_LABELS) return SCOPE_LABELS[value]!;
    return formatIfDate(value);
  }
  if (Array.isArray(value)) return formatArray(value);
  if (isRecord(value)) return formatObject(key, value);
  return String(value);
}

function recordSummary(entry: AuditEntry): string {
  const snap = entry.after ?? entry.before;
  if (!snap) return '';
  if (entry.entity === 'Setting') return SETTING_LABELS[entry.entityId] ?? '';
  if (typeof snap.code === 'string' && typeof snap.name === 'string') return `${snap.code} · ${snap.name}`;
  if (typeof snap.name === 'string' && typeof snap.idNumber === 'string') return `${snap.name} (${snap.idNumber})`;
  if (typeof snap.name === 'string' && typeof snap.email === 'string' && entry.entity === 'User') {
    return `${snap.name} (${snap.email})`;
  }
  if (typeof snap.name === 'string') return snap.name;
  if (typeof snap.concept === 'string') return snap.concept;
  if (typeof snap.startDate === 'string' && typeof snap.endDate === 'string') {
    return formatRange(snap.startDate, snap.endDate);
  }
  if (typeof snap.year === 'number' && typeof snap.month === 'number') {
    return monthLabel({ year: snap.year, month: snap.month });
  }
  if (isRecord(snap.person) && typeof snap.person.name === 'string') {
    const project = isRecord(snap.project) && typeof snap.project.code === 'string' ? ` · ${snap.project.code}` : '';
    return `${snap.person.name}${project}`;
  }
  if (isRecord(snap.project) && typeof snap.project.code === 'string') return snap.project.code;
  return '';
}

const PRIORITY_KEYS = ['status', 'active', 'amountCents', 'requestedCents', 'paidCents', 'spentCents', 'value', 'name', 'code', 'concept'];

function fieldPriority(key: string): number {
  const idx = PRIORITY_KEYS.indexOf(key);
  return idx === -1 ? PRIORITY_KEYS.length : idx;
}

function inspectEntry(entry: AuditEntry): AuditFieldRow[] {
  const before: Record<string, unknown> = entry.before ?? {};
  const after: Record<string, unknown> = entry.after ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  return [...keys]
    .filter((key) => !IGNORED_FIELDS.has(key))
    .filter((key) => !(entry.entity === 'Setting' && key === 'key'))
    .filter((key) => {
      const relObj = RELATION_ID_TO_OBJECT[key];
      return !relObj || !(relObj in before || relObj in after);
    })
    .filter((key) => {
      const bVal = before[key];
      const aVal = after[key];
      const bEmpty = bVal === null || bVal === undefined || bVal === '';
      const aEmpty = aVal === null || aVal === undefined || aVal === '';
      if (bEmpty && aEmpty) return false;
      if ((key === 'paidCents' || key === 'spentCents') && (bVal ?? 0) === 0 && (aVal ?? 0) === 0) return false;
      return true;
    })
    .map((key) => {
      const beforeText = key in before ? formatFieldValue(key, before[key]) : '—';
      const afterText = key in after ? formatFieldValue(key, after[key]) : '—';
      const hadBefore = beforeText !== '—';
      const hadAfter = afterText !== '—';
      const changed = entry.action !== 'UPDATE' || beforeText !== afterText;
      return {
        key,
        label: FIELD_LABELS[key] ?? key,
        beforeText,
        afterText,
        beforeBadge: badgeForField(key, before[key]),
        afterBadge: badgeForField(key, after[key]),
        hadBefore,
        hadAfter,
        changed,
      };
    })
    .sort((a, b) => {
      if (a.changed !== b.changed) return a.changed ? -1 : 1;
      return fieldPriority(a.key) - fieldPriority(b.key);
    });
}

function primaryChanges(entry: AuditEntry): AuditFieldRow[] {
  const all = inspectEntry(entry);
  return entry.action === 'UPDATE' ? all.filter((f) => f.changed) : all;
}

function contextFields(entry: AuditEntry): AuditFieldRow[] {
  if (entry.action !== 'UPDATE') return [];
  return inspectEntry(entry).filter((f) => !f.changed);
}

const MAX_PREVIEW_CHIPS = 3;

function previewChanges(entry: AuditEntry): AuditFieldRow[] {
  return primaryChanges(entry).slice(0, MAX_PREVIEW_CHIPS);
}

function remainingChangesCount(entry: AuditEntry): number {
  return Math.max(0, primaryChanges(entry).length - MAX_PREVIEW_CHIPS);
}

onMounted(async () => {
  if (auth.can(PERMISSIONS.USERS_READ)) {
    try {
      users.value = await listUsers();
    } catch {
      // Si falla la lista de usuarios, la tabla de auditoría igual se muestra.
    }
  }
  await load();
});
</script>

<template>
  <div class="page-header">
    <h1>Auditoría</h1>
    <div class="actions">
      <button v-if="result && result.entries.length > 0" type="button" class="button" @click="toggleAll">
        {{ allExpanded ? 'Contraer todo' : 'Expandir todo' }}
      </button>
      <button v-if="hasFilters" type="button" class="button" @click="clearFilters">Limpiar filtros</button>
    </div>
  </div>
  <p class="hint">
    Haz clic en cualquier fila para desplegar la comparación visual entre el estado anterior y el estado nuevo del registro.
  </p>

  <form class="card form-grid section-gap" @submit.prevent>
    <label class="field">
      Entidad
      <select v-model="filters.entity">
        <option value="">Todas</option>
        <option v-for="(label, value) in ENTITIES" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
    <label class="field">
      Acción
      <select v-model="filters.action">
        <option value="">Todas</option>
        <option v-for="(label, value) in ACTIONS" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
    <label v-if="users.length > 0" class="field">
      Usuario
      <select v-model.number="filters.userId">
        <option :value="0">Todos</option>
        <option v-for="user in users" :key="user.id" :value="user.id">{{ user.name }}</option>
      </select>
    </label>
    <label class="field">
      ID de registro
      <input v-model="filters.entityId" placeholder="Ej. 14" maxlength="60" />
    </label>
    <label class="field">
      Desde
      <input v-model="filters.from" type="date" :max="filters.to || undefined" />
    </label>
    <label class="field">
      Hasta
      <input v-model="filters.to" type="date" :min="filters.from || undefined" />
    </label>
  </form>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <template v-else-if="result">
    <div class="table-wrapper">
      <table class="audit-table">
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Usuario</th>
            <th scope="col">Acción</th>
            <th scope="col">Registro</th>
            <th scope="col">Vista previa de cambios</th>
            <th scope="col" class="audit-col-toggle"><span class="sr-only">Detalle</span></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="entry in result.entries" :key="entry.id">
            <tr
              class="audit-row"
              :class="{ 'is-expanded': isExpanded(entry.id) }"
              tabindex="0"
              role="button"
              :aria-expanded="isExpanded(entry.id)"
              @click="toggleRow(entry.id)"
              @keydown.enter.prevent="toggleRow(entry.id)"
              @keydown.space.prevent="toggleRow(entry.id)"
            >
              <td class="nowrap">{{ formatDateTime(entry.createdAt) }}</td>
              <td>
                {{ entry.user?.name ?? 'Sistema' }}
                <span v-if="entry.user?.email" class="permission-code">{{ entry.user.email }}</span>
              </td>
              <td class="nowrap">
                <StatusBadge :label="ACTIONS[entry.action]" :tone="ACTION_TONES[entry.action]" />
              </td>
              <td class="nowrap">
                <template v-if="entry.entity === 'Setting'">
                  {{ ENTITY_SINGULAR[entry.entity] }}
                  <span class="permission-code">{{ SETTING_LABELS[entry.entityId] ?? entry.entityId }}</span>
                </template>
                <template v-else>
                  {{ ENTITY_SINGULAR[entry.entity] ?? entry.entity }} #{{ entry.entityId }}
                  <span v-if="recordSummary(entry)" class="permission-code">{{ recordSummary(entry) }}</span>
                </template>
              </td>
              <td>
                <div class="audit-chips">
                  <span v-for="change in previewChanges(entry)" :key="change.key" class="audit-chip">
                    <span class="audit-chip-label">{{ change.label }}:</span>
                    <template v-if="entry.action === 'UPDATE' && change.hadBefore">
                      <StatusBadge v-if="change.beforeBadge" :label="change.beforeBadge.label" :tone="change.beforeBadge.tone" />
                      <span v-else class="old-value">{{ change.beforeText }}</span>
                      <span class="change-arrow" aria-hidden="true">→</span>
                      <StatusBadge v-if="change.afterBadge" :label="change.afterBadge.label" :tone="change.afterBadge.tone" />
                      <strong v-else class="new-value">{{ change.afterText }}</strong>
                    </template>
                    <template v-else-if="entry.action === 'DELETE'">
                      <StatusBadge v-if="change.beforeBadge" :label="change.beforeBadge.label" :tone="change.beforeBadge.tone" />
                      <span v-else class="old-value">{{ change.beforeText }}</span>
                    </template>
                    <template v-else>
                      <StatusBadge v-if="change.afterBadge" :label="change.afterBadge.label" :tone="change.afterBadge.tone" />
                      <strong v-else class="new-value">{{ change.afterText }}</strong>
                    </template>
                  </span>
                  <span v-if="remainingChangesCount(entry) > 0" class="audit-chip audit-chip-more">
                    +{{ remainingChangesCount(entry) }} más
                  </span>
                </div>
              </td>
              <td class="audit-col-toggle">
                <span class="audit-chevron" :class="{ 'is-open': isExpanded(entry.id) }" aria-hidden="true">
                  <AppIcon name="chevron" :size="16" />
                </span>
              </td>
            </tr>

            <tr v-if="isExpanded(entry.id)" class="audit-detail-row">
              <td colspan="6" class="audit-detail-cell">
                <div class="audit-compare">
                  <!-- Tarjeta izquierda: Estado anterior -->
                  <section class="audit-pane audit-pane-before">
                    <header class="audit-pane-header">
                      <span class="audit-pane-title">Estado anterior</span>
                      <StatusBadge
                        :label="entry.action === 'CREATE' ? 'No existía' : 'Antes del cambio'"
                        tone="neutral"
                      />
                    </header>

                    <p v-if="entry.action === 'CREATE'" class="audit-empty-state">
                      Registro nuevo — no existía un estado previo.
                    </p>
                    <div v-else class="audit-field-grid">
                      <div
                        v-for="field in primaryChanges(entry)"
                        :key="`before-${field.key}`"
                        class="audit-field-card"
                        :class="{ 'is-changed-before': entry.action === 'UPDATE' }"
                      >
                        <span class="audit-field-name">{{ field.label }}</span>
                        <div class="audit-field-val">
                          <StatusBadge
                            v-if="field.beforeBadge"
                            :label="field.beforeBadge.label"
                            :tone="field.beforeBadge.tone"
                          />
                          <span v-else-if="!field.hadBefore" class="audit-null-val">Sin asignar</span>
                          <span v-else :class="{ 'old-value': entry.action === 'UPDATE' }">{{ field.beforeText }}</span>
                        </div>
                      </div>
                    </div>

                    <template v-if="contextFields(entry).length > 0">
                      <div class="audit-context-divider">Contexto sin cambios</div>
                      <div class="audit-field-grid audit-field-grid-context">
                        <div v-for="field in contextFields(entry)" :key="`ctx-before-${field.key}`" class="audit-field-card">
                          <span class="audit-field-name">{{ field.label }}</span>
                          <div class="audit-field-val">
                            <StatusBadge
                              v-if="field.beforeBadge"
                              :label="field.beforeBadge.label"
                              :tone="field.beforeBadge.tone"
                            />
                            <span v-else>{{ field.beforeText }}</span>
                          </div>
                        </div>
                      </div>
                    </template>
                  </section>

                  <!-- Flecha central -->
                  <div class="audit-compare-arrow" aria-hidden="true">
                    <AppIcon name="arrow" :size="18" />
                  </div>

                  <!-- Tarjeta derecha: Estado nuevo -->
                  <section class="audit-pane audit-pane-after">
                    <header class="audit-pane-header">
                      <span class="audit-pane-title">Estado nuevo</span>
                      <StatusBadge
                        :label="
                          entry.action === 'CREATE'
                            ? 'Registro creado'
                            : entry.action === 'DELETE'
                              ? 'Eliminado'
                              : 'Después del cambio'
                        "
                        :tone="ACTION_TONES[entry.action]"
                      />
                    </header>

                    <p v-if="entry.action === 'DELETE'" class="audit-empty-state">
                      El registro fue eliminado del sistema.
                    </p>
                    <div v-else class="audit-field-grid">
                      <div
                        v-for="field in primaryChanges(entry)"
                        :key="`after-${field.key}`"
                        class="audit-field-card"
                        :class="{ 'is-changed-after': entry.action === 'UPDATE' }"
                      >
                        <span class="audit-field-name">{{ field.label }}</span>
                        <div class="audit-field-val">
                          <StatusBadge
                            v-if="field.afterBadge"
                            :label="field.afterBadge.label"
                            :tone="field.afterBadge.tone"
                          />
                          <span v-else-if="!field.hadAfter" class="audit-null-val">Sin asignar</span>
                          <strong v-else>{{ field.afterText }}</strong>
                        </div>
                      </div>
                    </div>

                    <template v-if="contextFields(entry).length > 0">
                      <div class="audit-context-divider">Contexto sin cambios</div>
                      <div class="audit-field-grid audit-field-grid-context">
                        <div v-for="field in contextFields(entry)" :key="`ctx-after-${field.key}`" class="audit-field-card">
                          <span class="audit-field-name">{{ field.label }}</span>
                          <div class="audit-field-val">
                            <StatusBadge
                              v-if="field.afterBadge"
                              :label="field.afterBadge.label"
                              :tone="field.afterBadge.tone"
                            />
                            <span v-else>{{ field.afterText }}</span>
                          </div>
                        </div>
                      </div>
                    </template>
                  </section>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="result.entries.length === 0">
            <td colspan="6">No hay registros con esos filtros.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <PaginationBar
      :page="result.page"
      :page-count="result.pageCount"
      :total="result.total"
      noun="registros"
      @change="load"
    />
  </template>
</template>
