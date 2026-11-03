// Parámetros del sistema. El seed crea los que falten con su valor por defecto,
// sin sobrescribir los que el administrador ya cambió.
export const SETTINGS = {
  'company.name': {
    label: 'Nombre de la empresa',
    description: 'Aparece en el encabezado de recibos y solicitudes.',
    defaultValue: 'Laboratorios Científicos Demo, C.A.',
  },
  'company.taxId': {
    label: 'RIF',
    description: 'Identificación fiscal que aparece en los documentos.',
    defaultValue: 'J-00000000-0',
  },
  'company.address': {
    label: 'Dirección',
    description: 'Dirección que aparece en los documentos.',
    defaultValue: 'Valencia, Carabobo, Venezuela',
  },
  'receipts.footer': {
    label: 'Pie de los recibos',
    description: 'Texto de conformidad al pie de cada recibo individual.',
    defaultValue: 'Recibí conforme la cantidad indicada en dólares de los Estados Unidos (USD).',
  },
} as const satisfies Record<string, { label: string; description: string; defaultValue: string }>;

export type SettingKey = keyof typeof SETTINGS;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}
