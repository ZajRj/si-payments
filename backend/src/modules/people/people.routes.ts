import { Router } from 'express';
import { z } from 'zod';
import { emailSchema, idParamSchema } from '../../lib/validation.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { createPerson, listPeople, updatePerson } from './people.service.js';

// Acepta "v12345678" o "V-12345678" y guarda siempre "V-12345678".
const idNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => value.replace(/^([VE])-?/, '$1-'))
  .pipe(z.string().regex(/^[VE]-\d{6,9}$/, 'Usa el formato V-12345678 o E-12345678'));

const createPersonSchema = z.object({
  idNumber: idNumberSchema,
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  email: emailSchema.nullable().optional(),
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
