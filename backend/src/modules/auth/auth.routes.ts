import { Router, type CookieOptions } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { emailSchema } from '../../lib/validation.js';
import { authenticate, SESSION_COOKIE } from '../../middleware/authenticate.js';
import { login, signSessionToken } from './auth.service.js';

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: env.COOKIE_SECURE,
  path: '/api',
};

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Demasiados intentos. Inténtalo más tarde.' } },
});

export const authRouter = Router();

authRouter.post('/login', loginRateLimit, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await login(email, password);

  res.cookie(SESSION_COOKIE, signSessionToken(user.id), {
    ...cookieOptions,
    maxAge: env.JWT_EXPIRES_IN_HOURS * 60 * 60 * 1000,
  });
  res.json({ user });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
  res.status(204).end();
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});
