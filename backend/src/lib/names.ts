// Compara nombres de catálogo sin distinguir mayúsculas ni acentos: "Física" y "fisica" son el mismo.
export function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, 'es', { sensitivity: 'base' }) === 0;
}
