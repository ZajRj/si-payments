<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ page: number; pageCount: number; total: number; noun: string }>();
const emit = defineEmits<{ change: [page: number] }>();

const lastPage = computed(() => Math.max(1, props.pageCount));
</script>

<template>
  <div v-if="total > 0" class="actions section-gap" role="navigation" :aria-label="`Paginación de ${noun}`">
    <button type="button" class="button" :disabled="page <= 1" @click="emit('change', page - 1)">Anterior</button>
    <span class="hint">Página {{ page }} de {{ lastPage }} · {{ total }} {{ noun }}</span>
    <button type="button" class="button" :disabled="page >= lastPage" @click="emit('change', page + 1)">Siguiente</button>
  </div>
</template>
