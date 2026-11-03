<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { listSettings, updateSetting, type Setting } from '@/api/settings';

const settings = ref<Setting[]>([]);
const values = ref<Record<string, string>>({});
const loading = ref(true);
const error = ref('');
const savingKey = ref<string | null>(null);
const savedKey = ref<string | null>(null);
const saveError = ref<{ key: string; message: string } | null>(null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    settings.value = await listSettings();
    values.value = Object.fromEntries(settings.value.map((setting) => [setting.key, setting.value]));
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

async function save(setting: Setting) {
  savingKey.value = setting.key;
  savedKey.value = null;
  saveError.value = null;
  try {
    await updateSetting(setting.key, values.value[setting.key] ?? '');
    setting.value = values.value[setting.key] ?? '';
    savedKey.value = setting.key;
  } catch (e) {
    saveError.value = { key: setting.key, message: errorMessage(e) };
  } finally {
    savingKey.value = null;
  }
}

onMounted(load);
</script>

<template>
  <h1>Parámetros</h1>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading">Cargando…</p>
  <template v-else>
    <form v-for="setting in settings" :key="setting.key" class="card form-grid" @submit.prevent="save(setting)">
      <label class="field">
        {{ setting.label }}
        <input v-model="values[setting.key]" required maxlength="500" />
        <span class="hint">{{ setting.description }}</span>
      </label>
      <p v-if="saveError?.key === setting.key" class="error" role="alert">{{ saveError.message }}</p>
      <div class="actions">
        <button
          type="submit"
          class="button button-primary"
          :disabled="savingKey === setting.key || values[setting.key] === setting.value"
        >
          Guardar
        </button>
        <span v-if="savedKey === setting.key" class="hint" role="status">Guardado</span>
      </div>
    </form>
  </template>
</template>
