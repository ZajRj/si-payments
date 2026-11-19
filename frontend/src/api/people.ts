import { http } from './http';

export type Person = {
  id: number;
  idNumber: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
};

export type PersonPayload = Omit<Person, 'id' | 'active'> & { active?: boolean };

export async function listPeople(filters: { search?: string; active?: boolean } = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.active !== undefined) params.set('active', String(filters.active));
  const { people } = await http<{ people: Person[] }>(`/people?${params}`);
  return people;
}

export async function createPerson(payload: PersonPayload) {
  const { person } = await http<{ person: Person }>('/people', { method: 'POST', body: payload });
  return person;
}

export async function updatePerson(id: number, payload: Partial<PersonPayload>) {
  const { person } = await http<{ person: Person }>(`/people/${id}`, { method: 'PATCH', body: payload });
  return person;
}

export async function getPerson(id: number) {
  return (await http<{ person: Person }>(`/people/${id}`)).person;
}
