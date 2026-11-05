import { http } from './http';

export type Setting = {
  key: string;
  label: string;
  description: string;
  value: string;
  updatedAt: string | null;
};

export async function listSettings() {
  const { settings } = await http<{ settings: Setting[] }>('/settings');
  return settings;
}

export function updateSetting(key: string, value: string) {
  return http<{ setting: { key: string; value: string } }>(`/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: { value },
  });
}
