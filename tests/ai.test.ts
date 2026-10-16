import request from 'supertest';
import app from '../app.js';

describe('AI Routes - Day 1', () => {
  it('should return 401 when calling POST /api/ai/chat unauthenticated', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({ prompt: 'Hello world' });
    expect(res.status).toBe(401);
  });

  it('should return 401 when calling POST /api/v1/ai/chat unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/ai/chat')
      .send({ prompt: 'Hello world' });
    expect(res.status).toBe(401);
  });
});
