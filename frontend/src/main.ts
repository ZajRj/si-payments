import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { onUnauthorized } from './api/http';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import './styles.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

// La sesión puede expirar o revocarse mientras la aplicación está abierta.
onUnauthorized(() => {
  useAuthStore().clear();
  void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } });
});

app.mount('#app');
