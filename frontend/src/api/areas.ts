import { http } from './http';

export type Area = {
  id: number;
  name: string;
  active: boolean;
};

export async function listAreas() {
  const { areas } = await http<{ areas: Area[] }>('/areas');
  return areas;
}

export async function createArea(name: string) {
  const { area } = await http<{ area: Area }>('/areas', { method: 'POST', body: { name } });
  return area;
}

export async function updateArea(id: number, payload: Partial<Omit<Area, 'id'>>) {
  const { area } = await http<{ area: Area }>(`/areas/${id}`, { method: 'PATCH', body: payload });
  return area;
}
