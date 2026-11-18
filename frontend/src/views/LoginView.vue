<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import AppIcon from '@/components/AppIcon.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);

// El ?redirect= puede venir de la sesión de otro usuario: solo se respeta si quien entra puede ver esa página.
function redirectTarget() {
  const redirect = route.query.redirect;
  if (typeof redirect !== 'string' || !redirect.startsWith('/')) return { name: 'dashboard' };
  const target = router.resolve(redirect);
  const permission = target.meta.permission;
  if (target.name === 'forbidden' || target.meta.public || (permission && !auth.can(permission))) return { name: 'dashboard' };
  return target.fullPath;
}

async function submit() {
  error.value = '';
  submitting.value = true;
  try {
    await auth.login(email.value, password.value);
    await router.push(redirectTarget());
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login">
    <aside class="login-aside">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><AppIcon name="coins" :size="18" /></span>
        <span>
          <span class="brand-name">Control de Pagos</span>
          <span class="brand-sub">y Asignaciones</span>
        </span>
      </div>
      <div>
        <h2>Cuánto se causó, cuánto se pagó y cuánto se debe.</h2>
        <ul class="login-points">
          <li><AppIcon name="calculator" :size="16" />Causación por período con prorrateo exacto</li>
          <li><AppIcon name="send" :size="16" />Solicitudes con aprobación y pagos FIFO</li>
          <li><AppIcon name="history" :size="16" />Registros inmutables y auditoría completa</li>
        </ul>
      </div>
      <p class="login-footer">Universidad de Carabobo · Sistemas de Información</p>
    </aside>

    <main class="login-main">
      <form class="card login-card" @submit.prevent="submit">
        <h1>Iniciar sesión</h1>
        <p class="hint">Usa el correo y la contraseña de tu cuenta.</p>
        <label class="field">
          Correo electrónico
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
  </div>
</template>
