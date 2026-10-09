import prisma from '../config/prisma.js';
import {
  createGroupConversation,
  addGroupParticipants,
  removeGroupParticipant,
  updateGroupConversation,
  getConversationMessages,
  getUserConversations
} from '../services/chatService.js';
import { ApiError } from '../utils/ApiError.js';

describe('Group Chat Features', () => {
  let userA: any;
  let userB: any;
  let userC: any;
  let userD: any;

  beforeAll(async () => {
    userA = await prisma.user.upsert({
      where: { email: 'jest_group_a@quorum.local' },
      update: {},
      create: { email: 'jest_group_a@quorum.local', name: 'Jest User A', role: 'user' }
    });

    userB = await prisma.user.upsert({
      where: { email: 'jest_group_b@quorum.local' },
      update: {},
      create: { email: 'jest_group_b@quorum.local', name: 'Jest User B', role: 'user' }
    });

    userC = await prisma.user.upsert({
      where: { email: 'jest_group_c@quorum.local' },
      update: {},
      create: { email: 'jest_group_c@quorum.local', name: 'Jest User C', role: 'user' }
    });

    userD = await prisma.user.upsert({
      where: { email: 'jest_group_d@quorum.local' },
      update: {},
      create: { email: 'jest_group_d@quorum.local', name: 'Jest User D', role: 'user' }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should create a group conversation with creator as owner and omit participant emails', async () => {
    const group = await createGroupConversation(userA.id, 'Jest Engineering', [userB.id, userC.id]);
    expect(group.type).toBe('group');
    expect(group.name).toBe('Jest Engineering');
    expect(group.ownerId).toBe(userA.id);
    expect(group.participants.length).toBe(3);

    group.participants.forEach((p: any) => {
      expect(p.user).toHaveProperty('id');
      expect(p.user).toHaveProperty('name');
      expect(p.user).not.toHaveProperty('email');
    });
  });

  it('should enforce owner permissions for adding members', async () => {
    const group = await createGroupConversation(userA.id, 'Owner Add Test', [userB.id]);

    await expect(addGroupParticipants(userB.id, group.id, [userC.id])).rejects.toThrow(ApiError);
    await expect(addGroupParticipants(userB.id, group.id, [userC.id])).rejects.toThrow('Only the group owner can add new participants');

    const updated = await addGroupParticipants(userA.id, group.id, [userC.id]);
    expect(updated.participants.length).toBe(3);
  });

  it('should handle duplicate participant insertion gracefully with skipDuplicates', async () => {
    const group = await createGroupConversation(userA.id, 'Duplicate Test', [userB.id]);
    await expect(addGroupParticipants(userA.id, group.id, [userB.id])).rejects.toThrow(ApiError);
  });

  it('should enforce owner permissions for updating group details', async () => {
    const group = await createGroupConversation(userA.id, 'Update Test', [userB.id]);

    await expect(updateGroupConversation(userB.id, group.id, { name: 'Hack Name' })).rejects.toThrow(ApiError);

    const updated = await updateGroupConversation(userA.id, group.id, { name: 'Renamed Group' });
    expect(updated.name).toBe('Renamed Group');
  });

  it('should enforce owner permissions for kicking members, but allow self-leaving', async () => {
    const group = await createGroupConversation(userA.id, 'Kick Test', [userB.id, userC.id]);

    await expect(removeGroupParticipant(userB.id, group.id, userC.id)).rejects.toThrow(ApiError);

    const kickResult = await removeGroupParticipant(userA.id, group.id, userD.id).catch((e) => e);
    expect(kickResult).toBeInstanceOf(ApiError);

    const ownerKickResult = await removeGroupParticipant(userA.id, group.id, userC.id);
    expect(ownerKickResult.success).toBe(true);

    const selfLeaveResult = await removeGroupParticipant(userB.id, group.id, userB.id);
    expect(selfLeaveResult.success).toBe(true);
  });

  it('should update conversation updatedAt timestamp when membership changes', async () => {
    const group = await createGroupConversation(userA.id, 'Timestamp Test', [userB.id]);
    const initialUpdatedAt = group.updatedAt.getTime();

    await new Promise((res) => setTimeout(res, 50));
    const updated = await addGroupParticipants(userA.id, group.id, [userC.id]);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(initialUpdatedAt);
  });

  it('should deny access to group messages after a user is removed', async () => {
    const group = await createGroupConversation(userA.id, 'Access Denied Test', [userB.id]);

    await removeGroupParticipant(userA.id, group.id, userB.id);
    await expect(getConversationMessages(userB.id, group.id)).rejects.toThrow(ApiError);
  });
});
