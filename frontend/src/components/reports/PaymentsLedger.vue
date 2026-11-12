<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
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

// Agrupa por día de entrega para leer el libro como una línea de tiempo.
const days = computed(() => {
  const map = new Map<string, ReportPayment[]>();
  for (const p of filtered.value) {
    const list = map.get(p.paidOn) ?? [];
    list.push(p);
    map.set(p.paidOn, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({
      date,
      items,
      total: items.reduce((sum, p) => sum + (p.annulledAt ? 0 : p.amountCents), 0),
    }));
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
  <div class="ledger">
    <div class="tools">
      <div class="totals">
        <span><strong>{{ formatUsd(report.totals.amountCents) }}</strong> pagados</span>
        <span class="sep">·</span>
        <span>{{ report.totals.paymentCount }} vigentes</span>
        <span class="sep">·</span>
        <span>{{ report.totals.annulledCount }} anulados</span>
      </div>
      <div class="controls">
        <input v-model="search" type="search" placeholder="Persona, proyecto, referencia o recibo" aria-label="Buscar pagos" />
        <div class="seg" role="group" aria-label="Estado del pago">
          <button type="button" :class="{ on: show === 'all' }" @click="show = 'all'">Todos</button>
          <button type="button" :class="{ on: show === 'active' }" @click="show = 'active'">Vigentes</button>
          <button type="button" :class="{ on: show === 'annulled' }" @click="show = 'annulled'">Anulados</button>
        </div>
        <button type="button" class="btn" :disabled="!filtered.length" @click="exportCsv">Exportar CSV</button>
      </div>
    </div>

    <section v-for="day in days" :key="day.date" class="day">
      <header class="day-head">
        <h3>{{ formatDate(day.date) }}</h3>
        <span class="day-total">{{ formatUsd(day.total) }}</span>
      </header>
      <ul>
        <li v-for="p in day.items" :key="p.id" class="pay" :class="{ annulled: p.annulledAt }">
          <div class="pay-who">
            <span class="pay-name">{{ p.person.name }}</span>
            <span class="pay-sub">
              {{ p.person.idNumber }} · {{ p.project.code }} · Solicitud #{{ p.requestId }}
              <template v-if="p.reference"> · Ref. {{ p.reference }}</template>
            </span>
            <span v-if="p.annulmentReason" class="pay-sub">Anulado: {{ p.annulmentReason }}</span>
          </div>
          <StatusBadge :label="p.annulledAt ? 'Anulado' : 'Vigente'" :tone="p.annulledAt ? 'danger' : 'success'" />
          <span class="pay-amount">{{ formatUsd(p.amountCents) }}</span>
          <a class="pdf" :href="receiptPdfUrl(p.id)" target="_blank" rel="noopener" :aria-label="`Recibo PDF #${p.id}`">
            <AppIcon name="file" :size="15" /> #{{ p.id }}
          </a>
        </li>
      </ul>
    </section>
    <p v-if="!days.length" class="empty">No hay pagos con esos filtros.</p>
  </div>
</template>

<style scoped>
.tools {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.totals {
  font-size: 0.9rem;
  color: var(--muted);
}
.totals strong {
  color: var(--text);
  font-size: 1.05rem;
}
.sep {
  margin: 0 0.25rem;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.controls input {
  font: inherit;
  width: 17rem;
  max-width: 100%;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
}
.seg button {
  font: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.75rem;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.seg button + button {
  border-left: 1px solid var(--border-strong);
}
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 650;
}
.btn {
  font: inherit;
  font-size: 0.875rem;
  padding: 0.45rem 0.8rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: var(--surface-alt);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.day {
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.day-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.55rem 1rem;
  background: var(--surface-alt);
  border-bottom: 1px solid var(--border);
}
.day-head h3 {
  margin: 0;
  font-size: 0.9rem;
}
.day-total {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.pay {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 7rem 4.5rem;
  align-items: center;
  gap: 1rem;
  padding: 0.7rem 1rem;
}
.pay + .pay {
  border-top: 1px solid var(--border);
}
.pay.annulled .pay-name,
.pay.annulled .pay-amount {
  text-decoration: line-through;
  color: var(--muted);
}
.pay-who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.pay-name {
  font-weight: 600;
}
.pay-sub {
  font-size: 0.8rem;
  color: var(--muted);
}
.pay-amount {
  text-align: right;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.pdf {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.82rem;
  font-weight: 600;
  text-decoration: none;
}
.pdf:hover {
  text-decoration: underline;
}
.empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--muted);
}
@media (max-width: 720px) {
  .pay {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .pay-amount {
    text-align: left;
  }
}
</style>
