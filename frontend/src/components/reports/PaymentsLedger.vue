<script setup lang="ts">
import { computed, ref } from 'vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { receiptPdfUrl, type PaymentsReport, type ReportPayment } from '@/api/reports';
import { formatDate } from '@/lib/dates';
import { formatUsd } from '@/lib/money';

const props = defineProps<{ report: PaymentsReport }>();

type Show = 'all' | 'active' | 'annulled';
const show = ref<Show>('all');
const search = ref('');

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  return props.report.payments.filter((p) => {
    if (show.value === 'active' && p.annulledAt) return false;
    if (show.value === 'annulled' && !p.annulledAt) return false;
    if (!term) return true;
    return `${p.person.name} ${p.person.idNumber} ${p.project.code} ${p.reference ?? ''} ${p.id}`.toLowerCase().includes(term);
  });
});

function exportCsv() {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ['Fecha', 'Recibo', 'Persona', 'Cédula', 'Proyecto', 'Solicitud', 'Monto USD', 'Referencia', 'Estado', 'Motivo anulación'];
  const lines = [
    header.map(esc).join(','),
    ...filtered.value.map((p) =>
      [
        p.paidOn,
        p.id,
        p.person.name,
        p.person.idNumber,
        p.project.code,
        p.requestId,
        (p.amountCents / 100).toFixed(2),
        p.reference ?? '',
        p.annulledAt ? 'Anulado' : 'Vigente',
        p.annulmentReason ?? '',
      ]
        .map(esc)
        .join(','),
    ),
  ];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pagos.csv';
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="filter-bar">
    <label class="field">
      Buscar
      <input v-model="search" type="search" placeholder="Persona, proyecto, referencia o recibo" />
    </label>
    <div class="chips" role="group" aria-label="Estado del pago">
      <button type="button" class="chip" :aria-pressed="show === 'all'" @click="show = 'all'">Todos</button>
      <button type="button" class="chip" :aria-pressed="show === 'active'" @click="show = 'active'">Vigentes</button>
      <button type="button" class="chip" :aria-pressed="show === 'annulled'" @click="show = 'annulled'">Anulados</button>
    </div>
    <button type="button" class="button" :disabled="!filtered.length" @click="exportCsv">Descargar en Excel (CSV)</button>
  </div>
  <p class="hint">
    {{ formatUsd(report.totals.amountCents) }} pagados · {{ report.totals.paymentCount }} pagos vigentes · {{ report.totals.annulledCount }} anulados
  </p>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Fecha</th>
          <th scope="col">Persona</th>
          <th scope="col">Proyecto y solicitud</th>
          <th scope="col">Referencia</th>
          <th scope="col" class="num">Monto</th>
          <th scope="col">Estado</th>
          <th scope="col"><span class="sr-only">Recibo</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in filtered" :key="p.id">
          <td class="nowrap">{{ formatDate(p.paidOn) }}</td>
          <td>
            {{ p.person.name }}
            <span class="permission-code">{{ p.person.idNumber }}</span>
          </td>
          <td>
            {{ p.project.code }}
            <span class="permission-code">Solicitud #{{ p.requestId }}</span>
          </td>
          <td>{{ p.reference }}</td>
          <td class="num">{{ formatUsd(p.amountCents) }}</td>
          <td>
            <StatusBadge :label="p.annulledAt ? 'Anulado' : 'Vigente'" :tone="p.annulledAt ? 'danger' : 'success'" />
            <span v-if="p.annulmentReason" class="permission-code">Motivo: {{ p.annulmentReason }}</span>
          </td>
          <td>
            <a class="button" :href="receiptPdfUrl(p.id)" target="_blank" rel="noopener">Recibo #{{ p.id }}</a>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="7">No hay pagos con esos filtros.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
