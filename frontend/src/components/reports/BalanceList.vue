<script setup lang="ts">
import { computed, ref } from 'vue';
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
</script>

<template>
  <div class="filter-bar">
    <label class="field">
      Buscar
      <input v-model="search" type="search" :placeholder="groupBy === 'person' ? 'Nombre o cédula' : 'Código o nombre del proyecto'" />
    </label>
    <label class="field">
      Ordenar por
      <select v-model="sort">
        <option value="owed">Lo que más se debe</option>
        <option value="accrued">Lo que más se calculó</option>
        <option value="name">Nombre</option>
      </select>
    </label>
    <label class="checkbox"><input v-model="onlyOwed" type="checkbox" /> Solo los que tienen deuda</label>
  </div>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">{{ groupBy === 'person' ? 'Persona' : 'Proyecto' }}</th>
          <th scope="col">Cálculos</th>
          <th scope="col" class="num">Total calculado</th>
          <th scope="col" class="num">Ya pagado</th>
          <th scope="col" class="num">Se debe</th>
          <th scope="col"><span class="sr-only">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in visible" :key="rowId(row)">
          <td>
            {{ label(row) }}
            <span class="permission-code">{{ sub(row) }}</span>
          </td>
          <td>{{ row.accrualCount }}</td>
          <td class="num">{{ formatUsd(row.accruedCents) }}</td>
          <td class="num">{{ formatUsd(row.paidCents) }}</td>
          <td class="num">
            <strong v-if="row.owedCents > 0" class="owed">{{ formatUsd(row.owedCents) }}</strong>
            <span v-else class="hint">Al día</span>
          </td>
          <td>
            <button type="button" class="button" @click="emit('select', row)">Ver detalle</button>
          </td>
        </tr>
        <tr v-if="visible.length === 0">
          <td colspan="6">No hay resultados con esos filtros.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.owed {
  color: var(--danger);
}
</style>
