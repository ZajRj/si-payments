<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import { dismissToast, toasts } from '@/lib/toast';
</script>

<template>
  <div class="toast-host" aria-live="polite" role="status">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast-${toast.tone}`">
      <AppIcon :name="toast.tone === 'danger' ? 'close' : 'check'" :size="20" />
      <div class="toast-body">
        <span>{{ toast.message }}</span>
        <a v-if="toast.action" :href="toast.action.href" target="_blank" rel="noopener">{{ toast.action.label }}</a>
      </div>
      <button type="button" class="toast-close" aria-label="Cerrar aviso" @click="dismissToast(toast.id)">
        <AppIcon name="close" :size="16" />
      </button>
    </div>
  </div>
</template>
