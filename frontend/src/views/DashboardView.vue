<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
</script>

<template>
  <h1>Hola, {{ auth.user?.name }}</h1>
  <p>Tu rol es <strong>{{ auth.user?.role.name }}</strong>.</p>
  <section class="card">
    <h2>Tus permisos</h2>
    <ul class="tags">
      <li v-for="permission in auth.user?.permissions" :key="permission">
        <code>{{ permission }}</code>
      </li>
    </ul>
  </section>
</template>
