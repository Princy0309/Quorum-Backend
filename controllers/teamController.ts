import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createTeam,
  getOrganizationTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
} from '../services/teamService.js';
import prisma from '../config/prisma.js';
import { queueNotification } from '../queues/notificationQueue.js';


const getParam = (param: unknown): string => {
  if (typeof param === 'string') return param.trim();
  if (Array.isArray(param) && typeof param[0] === 'string') return param[0].trim();
  return String(param || '').trim();
};

export const createTeamController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const orgId = getParam(req.params.id);
    const { name, description } = req.body;

    const team = await createTeam(orgId, req.user.id, {
      name,
      description,
    });

    return res.status(201).json({
      success: true,
      data: team,
    });
  }
);

export const getOrganizationTeamsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teams = await getOrganizationTeams(orgId);

    return res.status(200).json({
      success: true,
      data: teams,
    });
  }
);

export const getTeamController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);

    const team = await getTeamById(orgId, teamId);

    return res.status(200).json({
      success: true,
      data: team,
    });
  }
);

export const updateTeamController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);
    const { name, description } = req.body;

    const updated = await updateTeam(orgId, teamId, {
      name,
      description,
    });

    return res.status(200).json({
      success: true,
      data: updated,
    });
  }
);

export const deleteTeamController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);

    const result = await deleteTeam(orgId, teamId);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  }
);

export const addTeamMemberController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);
    const { userId, role } = req.body;

    if (!userId) {
      return next(new ApiError(400, 'userId is required'));
    }

    const member = await addTeamMember(orgId, teamId, String(userId).trim(), role);

    return res.status(201).json({
      success: true,
      data: member,
    });
  }
);

export const removeTeamMemberController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);
    const userId = getParam(req.params.userId);

    const result = await removeTeamMember(orgId, teamId, userId);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  }
);


export const getTeamMessagesController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const teamId = getParam(req.params.teamId);

    const conversation = await prisma.conversation.findUnique({
      where: { teamId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
      },
    });

    if (!conversation) {
      return next(new ApiError(404, 'Team conversation not found'));
    }

    return res.status(200).json({
      success: true,
      data: {
        conversationId: conversation.id,
        messages: conversation.messages,
      },
    });
  }
);

export const sendTeamMessageController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized'));
    }

    const teamId = getParam(req.params.teamId);
    const { content, fileUrl, fileType, fileName, fileSize } = req.body;

    if (!content && !fileUrl) {
      return next(new ApiError(400, 'Message content or file attachment is required'));
    }

    const conversation = await prisma.conversation.findUnique({
      where: { teamId },
    });

    if (!conversation) {
      return next(new ApiError(404, 'Team conversation not found'));
    }

    const isMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: req.user.id,
        },
      },
    });

    if (!isMember) {
      return next(new ApiError(403, 'You must be a team member to post in this chat'));
    }

    const nextSeq = conversation.lastSeq + 1;

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: req.user.id,
          content: content || '',
          fileUrl: fileUrl || null,
          fileType: fileType || null,
          fileName: fileName || null,
          fileSize: fileSize ? Number(fileSize) : null,
          seq: nextSeq,
        },
        include: {
          sender: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastSeq: nextSeq },
      }),
    ]);

    const io = req.app.get('io');
    if (io) {
      io.to(conversation.id).emit('chat:message:new', message);
    }

    if (content && typeof content === 'string') {
      try {
        const text = content.trim();
        const hasTeamMention = /@(team|all)\b/i.test(text);

       
        if (hasTeamMention && isMember.role === 'LEAD') {
          const allMembers = await prisma.teamMember.findMany({
            where: {
              teamId,
              NOT: { userId: req.user.id },
            },
            select: { userId: true },
          });

          for (const member of allMembers) {
            await queueNotification({
              recipientId: member.userId,
              type: 'TEAM_INVITE',
              title: 'Team Announcement',
              body: `${message.sender.name || 'Team Lead'} mentioned the team in chat: "${text.slice(0, 60)}"`,
              data: { teamId, conversationId: conversation.id, messageId: message.id },
            });
          }
        } else {
          
          const mentionMatches = text.match(/@(\w+)/g);
          if (mentionMatches && mentionMatches.length > 0) {
            const mentionedNames = mentionMatches.map((m) => m.slice(1).toLowerCase());

            const teamMembers = await prisma.teamMember.findMany({
              where: {
                teamId,
                NOT: { userId: req.user.id },
              },
              include: {
                user: { select: { id: true, name: true } },
              },
            });

            for (const member of teamMembers) {
              const firstName = (member.user.name || '').split(' ')[0].toLowerCase();
              if (mentionedNames.includes(firstName)) {
                await queueNotification({
                  recipientId: member.userId,
                  type: 'TEAM_INVITE',
                  title: 'Mentioned in Team Chat',
                  body: `${message.sender.name || 'Someone'} mentioned you: "${text.slice(0, 60)}"`,
                  data: { teamId, conversationId: conversation.id, messageId: message.id },
                });
              }
            }
          }
        }
      } catch (err: any) {
        
      }
    }


    return res.status(201).json({
      success: true,
      data: message,
    });
  }
);

export const deleteTeamMessageController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized'));
    }

    const teamId = getParam(req.params.teamId);
    const messageId = getParam(req.params.messageId);

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return next(new ApiError(404, 'Message not found'));
    }

    // Hierarchy Check: Team Lead or author can delete
    const teamMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: req.user.id,
        },
      },
    });

    const isAuthor = message.senderId === req.user.id;
    const isLead = teamMember?.role === 'LEAD';

    if (!isAuthor && !isLead) {
      return next(new ApiError(403, 'Only the author or Team Lead can delete this message'));
    }

    await prisma.message.delete({
      where: { id: messageId },
    });

    return res.status(200).json({
      success: true,
      message: 'Message deleted successfully',
    });
  }
);

export const pinTeamMessageController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized'));
    }

    const teamId = getParam(req.params.teamId);
    const messageId = getParam(req.params.messageId);

    // Hierarchy Check: Only Team Lead can pin messages
    const teamMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: req.user.id,
        },
      },
    });

    if (teamMember?.role !== 'LEAD') {
      return next(new ApiError(403, 'Only Team Leads can pin messages'));
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return next(new ApiError(404, 'Message not found'));
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isPinned: !message.isPinned },
    });

    return res.status(200).json({
      success: true,
      data: updated,
    });
  }
);

