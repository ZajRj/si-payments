<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import type { BalanceRow, GroupBy } from '@/api/reports';
import { formatUsd } from '@/lib/money';

const props = defineProps<{
  rows: BalanceRow[];
  groupBy: GroupBy;
}>();

const emit = defineEmits<{
  select: [row: BalanceRow];
}>();

type Sort = 'owed' | 'accrued' | 'name';
const sort = ref<Sort>('owed');
const search = ref('');
const onlyOwed = ref(false);

const label = (row: BalanceRow) => (row.person ? row.person.name : `${row.project?.code} · ${row.project?.name}`);
const sub = (row: BalanceRow) => (row.person ? row.person.idNumber : row.project?.area.name);
const rowId = (row: BalanceRow) => row.person?.id ?? row.project?.id ?? 0;

const visible = computed(() => {
  const term = search.value.trim().toLowerCase();
  const list = props.rows.filter((row) => {
    if (onlyOwed.value && row.owedCents <= 0) return false;
    if (!term) return true;
    return `${label(row)} ${sub(row)}`.toLowerCase().includes(term);
  });
  return [...list].sort((a, b) => {
    if (sort.value === 'name') return label(a).localeCompare(label(b), 'es');
    if (sort.value === 'accrued') return b.accruedCents - a.accruedCents;
    return b.owedCents - a.owedCents || b.accruedCents - a.accruedCents;
  });
});

const maxAccrued = computed(() => Math.max(1, ...props.rows.map((r) => r.accruedCents)));
const widthOf = (cents: number) => `${(cents / maxAccrued.value) * 100}%`;
</script>

<template>
  <div class="list-card">
    <div class="list-tools">
      <label class="search">
        <span class="sr-only">Buscar</span>
        <input v-model="search" type="search" :placeholder="groupBy === 'person' ? 'Buscar persona o cédula' : 'Buscar proyecto'" />
      </label>
      <select v-model="sort" aria-label="Ordenar por">
        <option value="owed">Mayor deuda</option>
        <option value="accrued">Mayor causado</option>
        <option value="name">Nombre</option>
      </select>
      <label class="check"><input v-model="onlyOwed" type="checkbox" /> Solo con deuda</label>
    </div>

    <ul v-if="visible.length" class="rows">
      <li v-for="row in visible" :key="rowId(row)">
        <button
          type="button"
          class="row"
          @click="emit('select', row)"
        >
          <span class="row-main">
            <span class="row-name">{{ label(row) }}</span>
            <span class="row-sub">{{ sub(row) }} · {{ row.accrualCount }} causaciones</span>
            <span class="bar" aria-hidden="true">
              <span class="bar-track" :style="{ width: widthOf(row.accruedCents) }">
                <span class="bar-paid" :style="{ width: row.accruedCents ? (row.paidCents / row.accruedCents) * 100 + '%' : '0%' }" />
              </span>
            </span>
          </span>
          <span class="row-nums">
            <span class="owed" :class="{ 'is-zero': row.owedCents === 0 }">
              {{ row.owedCents === 0 ? 'Al día' : formatUsd(row.owedCents) }}
            </span>
            <span class="of">de {{ formatUsd(row.accruedCents) }}</span>
          </span>
          <AppIcon name="chevron" :size="16" class="row-chevron" />
        </button>
      </li>
    </ul>
    <p v-else class="empty">No hay resultados con esos filtros.</p>
  </div>
</template>

<style scoped>
.list-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.list-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface-alt);
}
.search {
  flex: 1 1 12rem;
}
.search input,
.list-tools select {
  width: 100%;
  font: inherit;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
}
.list-tools select {
  width: auto;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  color: var(--muted);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rows li + li {
  border-top: 1px solid var(--border);
}
.row {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--ease);
}
.row:hover {
  background: var(--surface-alt);
}
.row.is-active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
}
.row-main {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.row-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-sub {
  font-size: 0.8rem;
  color: var(--muted);
}
.bar {
  display: block;
  margin-top: 0.4rem;
  height: 0.35rem;
}
.bar-track {
  display: block;
  height: 100%;
  min-width: 0.35rem;
  border-radius: 999px;
  background: #f1d6d2;
  overflow: hidden;
}
.bar-paid {
  display: block;
  height: 100%;
  background: var(--accent);
}
.row-nums {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-variant-numeric: tabular-nums;
}
.owed {
  font-weight: 650;
  color: var(--danger);
}
.owed.is-zero {
  color: var(--tone-success-fg);
}
.of {
  font-size: 0.78rem;
  color: var(--muted);
}
.row-chevron {
  color: var(--muted);
}
.empty {
  margin: 0;
  padding: 2rem 1rem;
  text-align: center;
  color: var(--muted);
}
</style>
