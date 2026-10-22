import request from 'supertest';
import app from '../app.js';
import prisma from '../config/prisma.js';
import jwt from 'jsonwebtoken';

describe('Saved Items and Collections API', () => {
  let user: any;
  let token: string;
  let authCookie: string;
  let conversation: any;
  let message: any;

  beforeAll(async () => {
    user = await prisma.user.create({
      data: {
        name: 'Test Saved User',
        email: `saved_${Date.now()}@example.com`,
        role: 'member'
      }
    });

    const secret = process.env.JWT_ACCESS_SECRET || 'access-secret';
    token = jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: '1h' });
    authCookie = `accessToken=${token}`;

    conversation = await prisma.conversation.create({
      data: {
        type: 'direct',
        participants: {
          create: {
            userId: user.id
          }
        }
      }
    });

    message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        content: 'Important reference message',
        seq: 1
      }
    });
  });

  afterAll(async () => {
    await prisma.savedItem.deleteMany({ where: { userId: user.id } });
    await prisma.savedCollection.deleteMany({ where: { userId: user.id } });
    await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: conversation.id } });
    await prisma.conversation.deleteMany({ where: { id: conversation.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it('should reject unauthenticated access', async () => {
    const res = await request(app).get('/api/saved-items');
    expect(res.status).toBe(401);
  });

  it('should create a personal collection', async () => {
    const res = await request(app)
      .post('/api/saved-items/collections')
      .set('Cookie', [authCookie])
      .send({
        name: 'Work References',
        description: 'Crucial messages and notes',
        color: '#ff5733'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Work References');
  });

  it('should prevent duplicate collection names for the same user', async () => {
    const res = await request(app)
      .post('/api/saved-items/collections')
      .set('Cookie', [authCookie])
      .send({
        name: 'work references'
      });

    expect(res.status).toBe(409);
  });

  it('should save a message and enrich content', async () => {
    const collectionsRes = await request(app)
      .get('/api/saved-items/collections')
      .set('Cookie', [authCookie]);

    const collectionId = collectionsRes.body.data[0].id;

    const res = await request(app)
      .post('/api/saved-items')
      .set('Cookie', [authCookie])
      .send({
        itemType: 'MESSAGE',
        itemId: message.id,
        note: 'Keep for project kick-off',
        collectionId
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.itemType).toBe('MESSAGE');
    expect(res.body.data.itemId).toBe(message.id);
  });

  it('should retrieve saved items with enriched data and filters', async () => {
    const res = await request(app)
      .get('/api/saved-items?itemType=MESSAGE')
      .set('Cookie', [authCookie]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items[0].content.content).toBe('Important reference message');
    expect(res.body.data.items[0].isAccessible).toBe(true);
  });

  it('should update a saved item note and collection', async () => {
    const listRes = await request(app)
      .get('/api/saved-items')
      .set('Cookie', [authCookie]);

    const savedId = listRes.body.data.items[0].id;

    const res = await request(app)
      .patch(`/api/saved-items/${savedId}`)
      .set('Cookie', [authCookie])
      .send({
        note: 'Updated note for team reference'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.note).toBe('Updated note for team reference');
  });

  it('should remove a saved item', async () => {
    const listRes = await request(app)
      .get('/api/saved-items')
      .set('Cookie', [authCookie]);

    const savedId = listRes.body.data.items[0].id;

    const res = await request(app)
      .delete(`/api/saved-items/${savedId}`)
      .set('Cookie', [authCookie]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
