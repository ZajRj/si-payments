<script setup lang="ts">
import AppModal from './AppModal.vue';

// Pregunta de confirmación en lenguaje llano: resume qué va a pasar y pide un "Sí" explícito.
// Si pide un motivo, el botón queda apagado hasta que se escriba.
const props = defineProps<{
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  reasonLabel?: string;
  reasonHint?: string;
  reasonRequired?: boolean;
}>();

const reason = defineModel<string>('reason', { default: '' });

const emit = defineEmits<{ confirm: []; close: [] }>();

function submit() {
  if (props.reasonRequired && reason.value.trim().length < 3) return;
  emit('confirm');
}
</script>

<template>
  <AppModal :open="open" :title="title" @close="emit('close')">
    <form class="confirm" @submit.prevent="submit">
      <div class="confirm-body"><slot /></div>
      <label v-if="reasonLabel" class="field">
        {{ reasonLabel }}
        <input v-model="reason" maxlength="500" :placeholder="reasonHint" autocomplete="off" />
        <span v-if="reasonRequired && reason.trim().length < 3" class="hint">Escribe al menos unas palabras para poder continuar.</span>
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="confirm-actions">
        <button type="button" class="button" @click="emit('close')">{{ cancelLabel ?? 'No, volver' }}</button>
        <button
          type="submit"
          class="button"
          :class="danger ? 'button-danger-solid' : 'button-primary'"
          :disabled="busy || (reasonRequired && reason.trim().length < 3)"
        >
          {{ busy ? 'Un momento…' : confirmLabel }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
