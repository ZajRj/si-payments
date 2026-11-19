import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { onUnauthorized } from './api/http';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import { usePendingStore } from './stores/pending';
import './styles.css';
import './styles-guided.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

// La sesión puede expirar o revocarse mientras la aplicación está abierta.
onUnauthorized(() => {
  useAuthStore().clear();
  void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } });
});

// Al volver a la pestaña (o restaurarla desde el historial) se comprueba que la sesión siga siendo la misma,
// para no mostrar datos de un usuario que ya cerró sesión.
async function checkSession() {
  const auth = useAuthStore();
  if (!auth.isAuthenticated || router.currentRoute.value.meta.public) return;
  if (await auth.revalidate()) return;
  if (!auth.isAuthenticated) {
    usePendingStore().clear();
    await router.replace({ name: 'login' });
  } else {
    window.location.assign('/');
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkSession();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void checkSession();
});

app.mount('#app');
