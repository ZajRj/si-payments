<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);

async function submit() {
  error.value = '';
  submitting.value = true;
  try {
    await auth.login(email.value, password.value);
    const redirect = route.query.redirect;
    await router.push(typeof redirect === 'string' ? redirect : { name: 'dashboard' });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="login">
    <form class="card login-card" @submit.prevent="submit">
      <h1>Control de Pagos y Asignaciones</h1>
      <label class="field">
        Email
        <input v-model="email" type="email" autocomplete="username" required autofocus />
      </label>
      <label class="field">
        Contraseña
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" class="button button-primary" :disabled="submitting">
        {{ submitting ? 'Entrando…' : 'Entrar' }}
      </button>
    </form>
  </main>
</template>
