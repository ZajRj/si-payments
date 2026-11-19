import { reactive } from 'vue';

// Avisos breves que confirman lo que acaba de pasar ("Listo, se guardó..."). Se muestran en ToastHost.
export type ToastTone = 'success' | 'info' | 'danger';
export type ToastAction = { label: string; href: string };
export type Toast = { id: number; message: string; tone: ToastTone; action?: ToastAction };

export const toasts = reactive<Toast[]>([]);
let nextId = 1;

export function dismissToast(id: number) {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index >= 0) toasts.splice(index, 1);
}

export function notify(message: string, options: { tone?: ToastTone; action?: ToastAction; seconds?: number } = {}) {
  const id = nextId++;
  toasts.push({ id, message, tone: options.tone ?? 'success', action: options.action });
  setTimeout(() => dismissToast(id), (options.seconds ?? 9) * 1000);
}
