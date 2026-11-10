// Compara nombres de catálogo sin distinguir mayúsculas, acentos ni espacios repetidos:
// "Física" y "fisica" son el mismo, y también "Caja  chica" y "caja chica".
const collapseSpaces = (value: string) => value.trim().replace(/\s+/g, ' ');

export function sameName(a: string, b: string): boolean {
  return collapseSpaces(a).localeCompare(collapseSpaces(b), 'es', { sensitivity: 'base' }) === 0;
}
