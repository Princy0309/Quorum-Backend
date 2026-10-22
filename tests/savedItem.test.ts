import request from 'supertest';
import app from '../app.js';
import prisma from '../config/prisma.js';
import jwt from 'jsonwebtoken';

describe('Saved Items and Collections API', () => {
  let user1: any;
  let user2: any;
  let authCookie1: string;
  let authCookie2: string;
  let conversation: any;
  let textMessage: any;
  let fileMessage: any;

  beforeAll(async () => {
    user1 = await prisma.user.create({
      data: {
        name: 'User One',
        email: `saved_user1_${Date.now()}@example.com`,
        role: 'member'
      }
    });

    user2 = await prisma.user.create({
      data: {
        name: 'User Two',
        email: `saved_user2_${Date.now()}@example.com`,
        role: 'member'
      }
    });

    const secret = process.env.JWT_ACCESS_SECRET || 'access-secret';
    authCookie1 = `accessToken=${jwt.sign({ id: user1.id, email: user1.email, role: user1.role }, secret, { expiresIn: '1h' })}`;
    authCookie2 = `accessToken=${jwt.sign({ id: user2.id, email: user2.email, role: user2.role }, secret, { expiresIn: '1h' })}`;

    conversation = await prisma.conversation.create({
      data: {
        type: 'direct',
        participants: {
          create: [{ userId: user1.id }]
        }
      }
    });

    textMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: user1.id,
        content: 'This is plain text without file attachment',
        seq: 1
      }
    });

    fileMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: user1.id,
        content: 'Here is the project roadmap',
        fileUrl: 'https://storage.googleapis.com/quorum/roadmap.pdf',
        fileName: 'roadmap.pdf',
        fileType: 'document',
        seq: 2
      }
    });
  });

  afterAll(async () => {
    await prisma.savedItem.deleteMany({ where: { userId: { in: [user1.id, user2.id] } } });
    await prisma.savedCollection.deleteMany({ where: { userId: { in: [user1.id, user2.id] } } });
    await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: conversation.id } });
    await prisma.conversation.deleteMany({ where: { id: conversation.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id] } } });
  });

  it('should reject unauthenticated access', async () => {
    const res = await request(app).get('/api/saved-items');
    expect(res.status).toBe(401);
  });

  it('should reject saving a text message as FILE when it lacks fileUrl', async () => {
    const res = await request(app)
      .post('/api/saved-items')
      .set('Cookie', [authCookie1])
      .send({
        itemType: 'FILE',
        itemId: textMessage.id
      });

    expect(res.status).toBe(400);
  });

  it('should save a valid file message as FILE', async () => {
    const res = await request(app)
      .post('/api/saved-items')
      .set('Cookie', [authCookie1])
      .send({
        itemType: 'FILE',
        itemId: fileMessage.id,
        note: 'Quarterly roadmap'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.itemType).toBe('FILE');
  });

  it('should prevent user from saving content they do not have access to', async () => {
    const res = await request(app)
      .post('/api/saved-items')
      .set('Cookie', [authCookie2])
      .send({
        itemType: 'MESSAGE',
        itemId: textMessage.id
      });

    expect(res.status).toBe(400);
  });

  it('should handle concurrent saves atomically without duplicate error', async () => {
    const req1 = request(app)
      .post('/api/saved-items')
      .set('Cookie', [authCookie1])
      .send({ itemType: 'MESSAGE', itemId: textMessage.id, note: 'Save A' });

    const req2 = request(app)
      .post('/api/saved-items')
      .set('Cookie', [authCookie1])
      .send({ itemType: 'MESSAGE', itemId: textMessage.id, note: 'Save B' });

    const [res1, res2] = await Promise.all([req1, req2]);
    expect([200, 201]).toContain(res1.status);
    expect([200, 201]).toContain(res2.status);
  });

  it('should search across personal notes, file names, and message content', async () => {
    const res = await request(app)
      .get('/api/saved-items?search=roadmap')
      .set('Cookie', [authCookie1]);

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items[0].itemId).toBe(fileMessage.id);
  });

  it('should prevent user from updating or deleting another user collection or item', async () => {
    const collectionRes = await request(app)
      .post('/api/saved-items/collections')
      .set('Cookie', [authCookie1])
      .send({ name: 'Private Work' });

    const collectionId = collectionRes.body.data.id;

    const crossUpdateRes = await request(app)
      .patch(`/api/saved-items/collections/${collectionId}`)
      .set('Cookie', [authCookie2])
      .send({ name: 'Hijacked' });

    expect(crossUpdateRes.status).toBe(404);

    const crossDeleteRes = await request(app)
      .delete(`/api/saved-items/collections/${collectionId}`)
      .set('Cookie', [authCookie2]);

    expect(crossDeleteRes.status).toBe(404);
  });

  it('should keep saved items intact when collection is deleted', async () => {
    const collectionRes = await request(app)
      .post('/api/saved-items/collections')
      .set('Cookie', [authCookie1])
      .send({ name: 'Temp Folder' });

    const collectionId = collectionRes.body.data.id;

    const saveRes = await request(app)
      .post('/api/saved-items')
      .set('Cookie', [authCookie1])
      .send({
        itemType: 'MESSAGE',
        itemId: textMessage.id,
        collectionId
      });

    const savedItemId = saveRes.body.data.id;

    await request(app)
      .delete(`/api/saved-items/collections/${collectionId}`)
      .set('Cookie', [authCookie1]);

    const checkRes = await request(app)
      .get('/api/saved-items')
      .set('Cookie', [authCookie1]);

    const item = checkRes.body.data.items.find((i: any) => i.id === savedItemId);
    expect(item).toBeDefined();
    expect(item.collection).toBeNull();
  });

  it('should paginate search results without skipping any matching item', async () => {
    const msg1 = await prisma.message.create({
      data: { conversationId: conversation.id, senderId: user1.id, content: 'KeywordTarget alpha test', seq: 10 }
    });
    const msg2 = await prisma.message.create({
      data: { conversationId: conversation.id, senderId: user1.id, content: 'KeywordTarget beta test', seq: 11 }
    });
    const msg3 = await prisma.message.create({
      data: { conversationId: conversation.id, senderId: user1.id, content: 'KeywordTarget gamma test', seq: 12 }
    });

    await request(app).post('/api/saved-items').set('Cookie', [authCookie1]).send({ itemType: 'MESSAGE', itemId: msg1.id });
    await request(app).post('/api/saved-items').set('Cookie', [authCookie1]).send({ itemType: 'MESSAGE', itemId: msg2.id });
    await request(app).post('/api/saved-items').set('Cookie', [authCookie1]).send({ itemType: 'MESSAGE', itemId: msg3.id });

    const page1 = await request(app)
      .get('/api/saved-items?search=KeywordTarget&limit=2')
      .set('Cookie', [authCookie1]);

    expect(page1.status).toBe(200);
    expect(page1.body.data.items.length).toBe(2);
    expect(page1.body.data.hasNextPage).toBe(true);
    expect(page1.body.data.nextCursor).toBeDefined();

    const page2 = await request(app)
      .get(`/api/saved-items?search=KeywordTarget&limit=2&cursor=${page1.body.data.nextCursor}`)
      .set('Cookie', [authCookie1]);

    expect(page2.status).toBe(200);
    expect(page2.body.data.items.length).toBe(1);

    const allMatchedIds = [
      ...page1.body.data.items.map((i: any) => i.itemId),
      ...page2.body.data.items.map((i: any) => i.itemId)
    ];

    expect(new Set(allMatchedIds).size).toBe(3);
    expect(allMatchedIds).toContain(msg1.id);
    expect(allMatchedIds).toContain(msg2.id);
    expect(allMatchedIds).toContain(msg3.id);
  });
});
