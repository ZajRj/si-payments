<script setup lang="ts">
import { computed } from 'vue';
import { formatUsd } from '@/lib/money';

const props = defineProps<{ accruedCents: number; paidCents: number; owedCents: number; accrualCount?: number }>();

const paidShare = computed(() => (props.accruedCents ? Math.round((props.paidCents / props.accruedCents) * 100) : 0));
</script>

<template>
  <section class="stats" aria-label="Totales">
    <div class="stat">
      <span class="stat-label">Causado</span>
      <span class="stat-value">{{ formatUsd(accruedCents) }}</span>
      <span v-if="accrualCount !== undefined" class="stat-note">{{ accrualCount }} causaciones vigentes</span>
    </div>
    <div class="stat stat-accent">
      <span class="stat-label">Pagado</span>
      <span class="stat-value">{{ formatUsd(paidCents) }}</span>
      <span class="stat-note">{{ paidShare }}% de lo causado</span>
    </div>
    <div class="stat" :class="{ 'stat-danger': owedCents > 0 }">
      <span class="stat-label">Adeudado</span>
      <span class="stat-value">{{ formatUsd(owedCents) }}</span>
      <span class="stat-note">Pendiente de pago</span>
    </div>
  </section>
</template>
