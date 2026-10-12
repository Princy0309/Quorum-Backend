import prisma from '../config/prisma.js';
import {
  createCommunity,
  changeMemberRole,
  transferCommunityOwnership,
  searchUsersToInvite,
  listCommunityMembers,
  createInviteLink,
  revokeInviteLink,
  joinCommunityViaInvite,
  removeCommunityMember,
  leaveCommunity
} from '../services/communityService.js';
import {
  createCommunityPost,
  updateCommunityPost,
  deleteCommunityPost
} from '../services/postService.js';
import {
  createPostComment,
  updatePostComment,
  deletePostComment
} from '../services/commentService.js';

describe('Community Feature Tests', () => {
  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let secondMemberUser: { id: string; email: string };
  let outsiderUser: { id: string; email: string };
  let communityId: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    ownerUser = await prisma.user.create({
      data: {
        name: 'Community Owner',
        email: `owner_${timestamp}@example.com`,
        passwordHash: 'dummyhash'
      }
    });

    memberUser = await prisma.user.create({
      data: {
        name: 'Community Member One',
        email: `member1_${timestamp}@example.com`,
        passwordHash: 'dummyhash'
      }
    });

    secondMemberUser = await prisma.user.create({
      data: {
        name: 'Community Member Two',
        email: `member2_${timestamp}@example.com`,
        passwordHash: 'dummyhash'
      }
    });

    outsiderUser = await prisma.user.create({
      data: {
        name: 'Community Outsider',
        email: `outsider_${timestamp}@example.com`,
        passwordHash: 'dummyhash'
      }
    });
  });

  afterAll(async () => {
    if (communityId) {
      await prisma.community.deleteMany({
        where: { id: communityId }
      });
    }

    await prisma.user.deleteMany({
      where: {
        id: {
          in: [ownerUser.id, memberUser.id, secondMemberUser.id, outsiderUser.id]
        }
      }
    });

    await prisma.$disconnect();
  });

  it('should create a community with creator as OWNER', async () => {
    const community = await createCommunity(ownerUser.id, {
      name: 'Alpha Community',
      description: 'Alpha Description'
    });

    expect(community).toBeDefined();
    expect(community.name).toBe('Alpha Community');
    expect(community.ownerId).toBe(ownerUser.id);
    expect(community.role).toBe('OWNER');
    expect(community.memberCount).toBe(1);

    communityId = community.id;
  });

  it('should generate an invite link by owner and allow a user to join', async () => {
    const invite = await createInviteLink(ownerUser.id, communityId, 7);
    expect(invite.token).toBeDefined();

    const joinResult = await joinCommunityViaInvite(memberUser.id, invite.token);
    expect(joinResult.communityId).toBe(communityId);
    expect(joinResult.role).toBe('MEMBER');
  });

  it('should prevent non-admin/non-owner from creating invite links', async () => {
    await expect(
      createInviteLink(memberUser.id, communityId)
    ).rejects.toThrow('Only community owners and admins can generate invitation links');
  });

  it('should handle duplicate join attempts safely with controlled error', async () => {
    const invite = await createInviteLink(ownerUser.id, communityId, 7);
    await expect(
      joinCommunityViaInvite(memberUser.id, invite.token)
    ).rejects.toThrow('You are already a member of this community');
  });

  it('should reject joining with an expired invite token', async () => {
    const expiredInvite = await prisma.communityInvite.create({
      data: {
        communityId,
        inviterId: ownerUser.id,
        token: `expired_${Date.now()}`,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60)
      }
    });

    await expect(
      joinCommunityViaInvite(secondMemberUser.id, expiredInvite.token)
    ).rejects.toThrow('Invitation link has expired');
  });

  it('should allow owner/admin to revoke invite and reject joining revoked invite', async () => {
    const invite = await createInviteLink(ownerUser.id, communityId, 7);
    const revokeResult = await revokeInviteLink(ownerUser.id, communityId, invite.id);
    expect(revokeResult.success).toBe(true);

    await expect(
      joinCommunityViaInvite(secondMemberUser.id, invite.token)
    ).rejects.toThrow('Invitation link is invalid or has been revoked');
  });

  it('should join second member with fresh invite', async () => {
    const invite = await createInviteLink(ownerUser.id, communityId, 7);
    const joinResult = await joinCommunityViaInvite(secondMemberUser.id, invite.token);
    expect(joinResult.communityId).toBe(communityId);
  });

  it('should promote member to ADMIN and demote back to MEMBER', async () => {
    const promoted = await changeMemberRole(ownerUser.id, communityId, memberUser.id, 'ADMIN');
    expect(promoted.role).toBe('ADMIN');

    const demoted = await changeMemberRole(ownerUser.id, communityId, memberUser.id, 'MEMBER');
    expect(demoted.role).toBe('MEMBER');
  });

  it('should prevent non-owner from changing roles', async () => {
    await expect(
      changeMemberRole(memberUser.id, communityId, secondMemberUser.id, 'ADMIN')
    ).rejects.toThrow('Only the community owner can change member roles');
  });

  it('should prevent user search for ordinary members and exclude emails for authorized users', async () => {
    await expect(
      searchUsersToInvite(memberUser.id, communityId, 'Outsider')
    ).rejects.toThrow('Only community owners and admins can search users to invite');

    const searchResults = await searchUsersToInvite(ownerUser.id, communityId, 'Outsider');
    expect(searchResults.users.length).toBeGreaterThan(0);
    expect((searchResults.users[0] as any).email).toBeUndefined();
    expect(searchResults.users[0].name).toBe('Community Outsider');
  });

  it('should return member list without exposing email addresses', async () => {
    const memberList = await listCommunityMembers(memberUser.id, communityId);
    expect(memberList.members.length).toBeGreaterThanOrEqual(3);
    for (const item of memberList.members) {
      expect((item.user as any).email).toBeUndefined();
      expect(item.user.name).toBeDefined();
      expect(item.id).toBeDefined();
    }
  });

  it('should transfer ownership to member and update roles', async () => {
    const transferResult = await transferCommunityOwnership(ownerUser.id, communityId, memberUser.id);
    expect(transferResult.newOwnerId).toBe(memberUser.id);

    const updatedCommunity = await prisma.community.findUnique({
      where: { id: communityId }
    });
    expect(updatedCommunity?.ownerId).toBe(memberUser.id);

    const oldOwnerMembership = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: ownerUser.id } }
    });
    expect(oldOwnerMembership?.role).toBe('ADMIN');

    const newOwnerMembership = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: memberUser.id } }
    });
    expect(newOwnerMembership?.role).toBe('OWNER');
  });

  it('should block simultaneous conflicting ownership transfers', async () => {
    const firstAttempt = transferCommunityOwnership(memberUser.id, communityId, ownerUser.id);
    const secondAttempt = transferCommunityOwnership(memberUser.id, communityId, secondMemberUser.id);

    const results = await Promise.allSettled([firstAttempt, secondAttempt]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it('should block removed members from editing or deleting posts and comments', async () => {
    const post = await createCommunityPost(secondMemberUser.id, communityId, 'Member post content');
    const comment = await createPostComment(secondMemberUser.id, post.id, 'Member comment content');

    const currentCommunity = await prisma.community.findUnique({
      where: { id: communityId }
    });
    const currentOwnerId = currentCommunity!.ownerId;

    await removeCommunityMember(currentOwnerId, communityId, secondMemberUser.id);

    await expect(
      updateCommunityPost(secondMemberUser.id, post.id, 'Edited post content')
    ).rejects.toThrow('Access denied. You are no longer a member of this community');

    await expect(
      deleteCommunityPost(secondMemberUser.id, post.id)
    ).rejects.toThrow('Access denied. You are no longer a member of this community');

    await expect(
      updatePostComment(secondMemberUser.id, comment.id, 'Edited comment content')
    ).rejects.toThrow('Access denied. You are no longer a member of this community');

    await expect(
      deletePostComment(secondMemberUser.id, comment.id)
    ).rejects.toThrow('Access denied. You are no longer a member of this community');
  });
});
