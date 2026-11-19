<script setup lang="ts">
import { computed } from 'vue';
import { formatUsd } from '@/lib/money';

const props = defineProps<{ accruedCents: number; paidCents: number; owedCents: number; accrualCount: number }>();

const paidPct = computed(() => (props.accruedCents > 0 ? Math.min(100, (props.paidCents / props.accruedCents) * 100) : 0));
</script>

<template>
  <section class="card" aria-label="Resumen">
    <dl class="summary-grid">
      <div>
        <dt>Total calculado</dt>
        <dd>{{ formatUsd(accruedCents) }} <span class="hint">{{ accrualCount }} cálculos</span></dd>
      </div>
      <div>
        <dt>Ya pagado</dt>
        <dd>{{ formatUsd(paidCents) }} <span class="hint">{{ Math.round(paidPct) }}%</span></dd>
      </div>
      <div>
        <dt>Falta pagar</dt>
        <dd :class="{ owed: owedCents > 0 }">{{ formatUsd(owedCents) }} <span class="hint">{{ owedCents === 0 ? 'Todo al día' : '' }}</span></dd>
      </div>
    </dl>
    <div class="meter" role="img" :aria-label="`Pagado ${Math.round(paidPct)}% de lo calculado`">
      <span class="meter-paid" :style="{ width: paidPct + '%' }" />
    </div>
  </section>
</template>

<style scoped>
.summary-grid dd .hint {
  font-size: 0.8125rem;
  font-weight: 400;
}
.owed {
  color: var(--danger);
}
.meter {
  height: 6px;
  margin-top: 0.875rem;
  overflow: hidden;
  background: #f3d9d5;
  border-radius: 999px;
}
.meter-paid {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
}
</style>
