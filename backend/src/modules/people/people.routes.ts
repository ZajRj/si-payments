import { Router } from 'express';
import { z } from 'zod';
import { idParamSchema, nullableEmailSchema, nullableTextSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { createPerson, listPeople, updatePerson } from './people.service.js';

// Acepta "v12345678", "V-12.345.678" o "V-012345678" y guarda siempre "V-12345678",
// para que una misma cédula escrita de dos formas no cree dos personas.
const idNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => value.replace(/[.\s]/g, '').replace(/^([VE])-?0*/, '$1-'))
  .pipe(z.string().regex(/^[VE]-[1-9]\d{5,8}$/, 'Usa el formato V-12345678 o E-12345678'));

const createPersonSchema = z.object({
  idNumber: idNumberSchema,
  name: z.string().trim().min(1).max(120),
  phone: nullableTextSchema(30).optional(),
  email: nullableEmailSchema.optional(),
});

const updatePersonSchema = createPersonSchema.partial().extend({ active: z.boolean().optional() });

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  active: z.stringbool().optional(),
});

export const peopleRouter = Router();

peopleRouter.use(authenticate);

peopleRouter.get('/', requirePermission(PERMISSIONS.PEOPLE_READ), async (req, res) => {
  res.json({ people: await listPeople(listQuerySchema.parse(req.query)) });
});

peopleRouter.post('/', requirePermission(PERMISSIONS.PEOPLE_MANAGE), async (req, res) => {
  const person = await createPerson(req.user!.id, createPersonSchema.parse(req.body));
  res.status(201).json({ person });
});

peopleRouter.patch('/:id', requirePermission(PERMISSIONS.PEOPLE_MANAGE), async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const person = await updatePerson(req.user!.id, id, updatePersonSchema.parse(req.body));
  res.json({ person });
});
