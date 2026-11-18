import { Router } from 'express';
import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dates.js';
import { idParamSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { createProject, listProjects, previewNextCode, SCOPES, updateProject } from './projects.service.js';

const projectFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  areaId: z.number().int().positive(),
  scope: z.enum(SCOPES),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
});

// El código es opcional: si no viene, se genera a partir del área. La interfaz siempre lo deja generar.
const createProjectSchema = projectFieldsSchema.extend({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'El código solo admite letras, números y guiones (2 a 20 caracteres)')
    .optional(),
});

// El código no se edita: identifica al proyecto en solicitudes, recibos y reportes.
const updateProjectSchema = projectFieldsSchema.partial().extend({ active: z.boolean().optional() }).strict();

const nextCodeQuerySchema = z.object({ areaId: z.coerce.number().int().positive() });

const listQuerySchema = z.object({
  areaId: z.coerce.number().int().positive().optional(),
  active: z.stringbool().optional(),
});

export const projectsRouter = Router();

projectsRouter.use(authenticate);

projectsRouter.get('/', requirePermission(PERMISSIONS.PROJECTS_READ), async (req, res) => {
  res.json({ projects: await listProjects(listQuerySchema.parse(req.query)) });
});

projectsRouter.get('/next-code', requirePermission(PERMISSIONS.PROJECTS_MANAGE), async (req, res) => {
  const { areaId } = nextCodeQuerySchema.parse(req.query);
  res.json({ code: await previewNextCode(areaId) });
});

projectsRouter.post('/', requirePermission(PERMISSIONS.PROJECTS_MANAGE), async (req, res) => {
  const project = await createProject(req.user!.id, createProjectSchema.parse(req.body));
  res.status(201).json({ project });
});

projectsRouter.patch('/:id', requirePermission(PERMISSIONS.PROJECTS_MANAGE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const project = await updateProject(req.user!.id, id, updateProjectSchema.parse(req.body));
  res.json({ project });
});
