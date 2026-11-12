<script setup lang="ts">
import { computed } from 'vue';
import { formatUsd } from '@/lib/money';

const props = defineProps<{ accruedCents: number; paidCents: number; owedCents: number; accrualCount: number }>();

const paidPct = computed(() => (props.accruedCents > 0 ? Math.min(100, (props.paidCents / props.accruedCents) * 100) : 0));
</script>

<template>
  <section class="summary" aria-label="Resumen del período">
    <div class="summary-figures">
      <div class="fig">
        <span class="fig-label">Causado</span>
        <span class="fig-value">{{ formatUsd(accruedCents) }}</span>
        <span class="fig-note">{{ accrualCount }} causaciones vigentes</span>
      </div>
      <div class="fig">
        <span class="fig-label"><i class="dot dot-paid" />Pagado</span>
        <span class="fig-value">{{ formatUsd(paidCents) }}</span>
        <span class="fig-note">{{ Math.round(paidPct) }}% de lo causado</span>
      </div>
      <div class="fig fig-owed" :class="{ 'is-zero': owedCents === 0 }">
        <span class="fig-label"><i class="dot dot-owed" />Adeudado</span>
        <span class="fig-value">{{ formatUsd(owedCents) }}</span>
        <span class="fig-note">{{ owedCents === 0 ? 'Todo al día' : 'Pendiente de pago' }}</span>
      </div>
    </div>
    <div class="meter" role="img" :aria-label="`Pagado ${Math.round(paidPct)}% de lo causado`">
      <span class="meter-paid" :style="{ width: paidPct + '%' }" />
    </div>
  </section>
</template>

<style scoped>
.summary {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem 1.5rem 1.1rem;
  box-shadow: var(--shadow);
}
.summary-figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.5rem;
}
.fig {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.fig + .fig {
  border-left: 1px solid var(--border);
  padding-left: 1.5rem;
}
.fig-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.fig-value {
  font-size: 1.75rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
}
.fig-owed .fig-value {
  color: var(--danger);
}
.fig-owed.is-zero .fig-value {
  color: var(--text);
}
.fig-note {
  font-size: 0.82rem;
  color: var(--muted);
}
.dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  display: inline-block;
}
.dot-paid {
  background: var(--accent);
}
.dot-owed {
  background: #e4a39c;
}
.meter {
  margin-top: 1rem;
  height: 0.5rem;
  border-radius: 999px;
  background: #f1d6d2;
  overflow: hidden;
}
.meter-paid {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
  transition: width 400ms ease;
}
@media (max-width: 720px) {
  .summary-figures {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .fig + .fig {
    border-left: 0;
    padding-left: 0;
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
  }
}
</style>
