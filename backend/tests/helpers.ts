import request from 'supertest';
import { createApp } from '../src/app.js';
import { testEnv } from './test-env.js';

export const app = createApp();

export async function loginAs(email: string, password = testEnv.SEED_USER_PASSWORD) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}
