<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { ACCRUAL_STATUS_LABELS } from '@/api/accruals';
import { receiptPdfUrl, type PersonStatement } from '@/api/reports';
import { formatDate, formatRange } from '@/lib/dates';
import { formatUsd } from '@/lib/money';
import { ACCRUAL_STATUS_TONES } from '@/lib/status';

const props = defineProps<{
  statement: PersonStatement | null;
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{ close: [] }>();

const paidPct = computed(() => {
  const t = props.statement?.totals;
  return t && t.accruedCents ? Math.min(100, (t.paidCents / t.accruedCents) * 100) : 0;
});
</script>

<template>
  <aside class="detail" aria-label="Estado de cuenta">
    <header class="detail-head">
      <div class="who">
        <span class="eyebrow">Estado de cuenta</span>
        <h2 v-if="statement">{{ statement.person.name }}</h2>
        <span v-if="statement" class="cedula">{{ statement.person.idNumber }}</span>
      </div>
      <button type="button" class="close" aria-label="Cerrar estado de cuenta" @click="emit('close')">
        <AppIcon name="close" :size="18" />
      </button>
    </header>

    <p v-if="error" class="state error" role="alert">{{ error }}</p>
    <p v-else-if="loading && !statement" class="state">Cargando…</p>

    <div v-else-if="statement" class="detail-body" :class="{ 'is-stale': loading }">
      <div class="trio">
        <div>
          <span class="t-label">Causado</span>
          <span class="t-value">{{ formatUsd(statement.totals.accruedCents) }}</span>
        </div>
        <div>
          <span class="t-label">Pagado</span>
          <span class="t-value paid">{{ formatUsd(statement.totals.paidCents) }}</span>
        </div>
        <div>
          <span class="t-label">Adeudado</span>
          <span class="t-value" :class="{ owed: statement.totals.owedCents > 0 }">{{ formatUsd(statement.totals.owedCents) }}</span>
        </div>
      </div>
      <div class="meter" aria-hidden="true"><span :style="{ width: paidPct + '%' }" /></div>

      <h3>Causaciones <span class="count">{{ statement.accruals.length }}</span></h3>
      <ul v-if="statement.accruals.length" class="items">
        <li v-for="a in statement.accruals" :key="a.id" class="item">
          <div class="item-top">
            <span class="item-title">{{ a.project.code }}</span>
            <StatusBadge :label="ACCRUAL_STATUS_LABELS[a.status]" :tone="ACCRUAL_STATUS_TONES[a.status]" />
          </div>
          <span class="item-sub">
            {{ formatRange(a.period.startDate, a.period.endDate) }} · {{ a.activeDays }}/{{ a.periodDays }} días
          </span>
          <div class="item-money">
            <span>{{ formatUsd(a.amountCents) }} causado</span>
            <span>{{ formatUsd(a.paidCents) }} pagado</span>
            <strong :class="{ owed: a.owedCents > 0 }">{{ formatUsd(a.owedCents) }} debe</strong>
          </div>
        </li>
      </ul>
      <p v-else class="none">Sin causaciones en este rango.</p>

      <h3>Pagos <span class="count">{{ statement.payments.length }}</span></h3>
      <ul v-if="statement.payments.length" class="items">
        <li v-for="p in statement.payments" :key="p.id" class="item" :class="{ annulled: p.annulledAt }">
          <div class="item-top">
            <span class="item-title amount">{{ formatUsd(p.amountCents) }}</span>
            <StatusBadge :label="p.annulledAt ? 'Anulado' : 'Vigente'" :tone="p.annulledAt ? 'danger' : 'success'" />
          </div>
          <span class="item-sub">{{ formatDate(p.paidOn) }} · {{ p.project.code }} · Recibo #{{ p.id }}</span>
          <span v-if="p.annulmentReason" class="item-sub">Motivo: {{ p.annulmentReason }}</span>
          <a class="pdf" :href="receiptPdfUrl(p.id)" target="_blank" rel="noopener">
            <AppIcon name="file" :size="14" /> Recibo PDF
          </a>
        </li>
      </ul>
      <p v-else class="none">Sin pagos en este rango.</p>
    </div>
  </aside>
</template>

<style scoped>
.detail {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: calc(100vh - 2rem);
}
.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid var(--border);
}
.eyebrow {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.who h2 {
  margin: 0.1rem 0 0;
}
.cedula {
  font-size: 0.85rem;
  color: var(--muted);
}
.close {
  align-self: flex-start;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.close:hover {
  background: var(--surface-alt);
  color: var(--text);
}
.state {
  margin: 0;
  padding: 2rem 1.1rem;
  text-align: center;
  color: var(--muted);
}
.state.error {
  color: var(--danger);
}
.detail-body {
  padding: 1rem 1.1rem 1.25rem;
  overflow-y: auto;
  transition: opacity var(--ease);
}
.detail-body.is-stale {
  opacity: 0.55;
}
.trio {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}
.t-label {
  display: block;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.t-value {
  font-size: 1.1rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.paid {
  color: var(--accent);
}
.owed {
  color: var(--danger);
}
.meter {
  margin: 0.8rem 0 0.25rem;
  height: 0.4rem;
  border-radius: 999px;
  background: #f1d6d2;
  overflow: hidden;
}
.meter span {
  display: block;
  height: 100%;
  background: var(--accent);
}
h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1.4rem 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}
.count {
  padding: 0 0.45rem;
  border-radius: 999px;
  background: var(--tone-neutral-bg);
  font-size: 0.72rem;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-alt);
}
.item.annulled {
  opacity: 0.7;
}
.item.annulled .amount {
  text-decoration: line-through;
}
.item-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.item-title {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.item-sub {
  font-size: 0.82rem;
  color: var(--muted);
}
.item-money {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.9rem;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}
.item-money strong {
  font-weight: 650;
}
.pdf {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.2rem;
  font-size: 0.82rem;
  font-weight: 600;
  text-decoration: none;
}
.pdf:hover {
  text-decoration: underline;
}
.none {
  margin: 0;
  font-size: 0.875rem;
  color: var(--muted);
}
</style>
