import { http } from './http';

export type Scope = 'INTERNAL' | 'EXTERNAL';

export const SCOPE_LABELS: Record<Scope, string> = {
  INTERNAL: 'Interno',
  EXTERNAL: 'Externo',
};

export type Project = {
  id: number;
  code: string;
  name: string;
  area: { id: number; name: string };
  scope: Scope;
  startDate: string;
  endDate: string;
  active: boolean;
  assignmentCount: number;
};

// El código no se envía: el servidor lo genera al azar con el prefijo del área y no se edita.
export type ProjectPayload = {
  name: string;
  areaId: number;
  scope: Scope;
  startDate: string;
  endDate: string;
  active?: boolean;
};

export async function listProjects(filters: { active?: boolean } = {}) {
  const params = new URLSearchParams();
  if (filters.active !== undefined) params.set('active', String(filters.active));
  const { projects } = await http<{ projects: Project[] }>(`/projects?${params}`);
  return projects;
}

export async function createProject(payload: ProjectPayload) {
  const { project } = await http<{ project: Project }>('/projects', { method: 'POST', body: payload });
  return project;
}

export async function updateProject(id: number, payload: Partial<ProjectPayload>) {
  const { project } = await http<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', body: payload });
  return project;
}

export async function getProject(id: number) {
  return (await http<{ project: Project }>(`/projects/${id}`)).project;
}
