<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import { REQUEST_STATUS_LABELS } from '@/api/payment-requests';
import AppIcon, { type IconName } from '@/components/AppIcon.vue';
import { usePendingStore } from '@/stores/pending';

type NavItem = { path: string; label: string; icon?: IconName };
type Option = { group: string; label: string; icon: IconName; to: RouteLocationRaw; meta?: string };

const props = defineProps<{ open: boolean; navItems: NavItem[] }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const pending = usePendingStore();

const query = ref('');
const selected = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

// Compara sin acentos ni mayúsculas: "causacion" encuentra "Causación".
const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const options = computed<Option[]>(() => [
  ...props.navItems.map((item) => ({ group: 'Pantallas', label: item.label, icon: item.icon ?? 'arrow', to: item.path })),
  ...pending.requests.map((request) => ({
    group: 'Solicitudes de pago',
    label: `#${request.id} · ${request.project.code} ${request.project.name}`,
    icon: 'send' as const,
    to: { name: 'payment-requests', query: { id: request.id } },
    meta: REQUEST_STATUS_LABELS[request.status],
  })),
]);

const results = computed(() => {
  const term = normalize(query.value.trim());
  return term ? options.value.filter((option) => normalize(option.label).includes(term)) : options.value;
});

watch(results, () => (selected.value = 0));

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    query.value = '';
    selected.value = 0;
    await nextTick();
    inputEl.value?.focus();
  },
);

function go(option: Option | undefined) {
  if (!option) return;
  emit('close');
  void router.push(option.to);
}

function move(step: number) {
  const count = results.value.length;
  if (count === 0) return;
  selected.value = (selected.value + step + count) % count;
  void nextTick(() => document.getElementById(`palette-option-${selected.value}`)?.scrollIntoView({ block: 'nearest' }));
}

function startsGroup(index: number) {
  return index === 0 || results.value[index - 1].group !== results.value[index].group;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop palette-backdrop" @mousedown.self="emit('close')">
      <div class="palette" role="dialog" aria-modal="true" aria-label="Buscar">
        <div class="palette-input">
          <AppIcon name="search" />
          <input
            ref="inputEl"
            v-model="query"
            placeholder="Busca una pantalla o una solicitud"
            autocomplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            :aria-activedescendant="results.length ? `palette-option-${selected}` : undefined"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="go(results[selected])"
            @keydown.esc.prevent="emit('close')"
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" aria-label="Resultados">
          <template v-for="(option, index) in results" :key="`${option.group}-${option.label}`">
            <li v-if="startsGroup(index)" class="palette-group" role="presentation">{{ option.group }}</li>
            <li
              :id="`palette-option-${index}`"
              class="palette-option"
              role="option"
              :aria-selected="index === selected"
              @mousemove="selected = index"
              @click="go(option)"
            >
              <AppIcon :name="option.icon" :size="16" />
              <span>{{ option.label }}</span>
              <span v-if="option.meta" class="palette-meta">{{ option.meta }}</span>
            </li>
          </template>
          <li v-if="results.length === 0" class="palette-empty">Sin resultados para «{{ query }}».</li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>
