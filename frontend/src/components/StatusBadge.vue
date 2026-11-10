<script setup lang="ts">
import type { Tone } from '@/lib/status';

defineProps<{ label: string; tone: Tone }>();
</script>

<template>
  <span class="badge" :class="`badge-${tone}`">{{ label }}</span>
</template>
