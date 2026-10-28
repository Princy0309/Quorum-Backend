import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { OrgRole, Prisma } from '@prisma/client';
import {
  CreateWhiteboardInput,
  GetWhiteboardsQuery,
  UpdateWhiteboardInput,
} from '../validators/whiteboardValidators.js';
import {
  coordinatedUpdateWhiteboard,
  cleanupWhiteboardSession,
} from '../sockets/handlers/whiteboardHandler.js';

export interface OrgPermissionResult {
  role: OrgRole;
  isOwner: boolean;
}

export const assertUserBelongsToOrganization = async (
  userId: string,
  organizationId: string
): Promise<OrgPermissionResult> => {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, ownerId: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId,
      },
    },
    select: { role: true },
  });

  const isOwner = org.ownerId === userId;

  if (!member && !isOwner) {
    throw new ApiError(403, 'You do not have permission to access whiteboards in this organization');
  }

  const role = member?.role ?? OrgRole.ORG_ADMIN;

  return { role, isOwner };
};

export const createWhiteboard = async (
  userId: string,
  input: CreateWhiteboardInput
) => {
  await assertUserBelongsToOrganization(userId, input.organizationId);

  const targetMeetingId = input.meetingId;
  if (targetMeetingId) {
    const meeting = await prisma.meeting.findUnique({
      where: { id: targetMeetingId },
      select: {
        id: true,
        hostId: true,
        admitted: true,
        organizationId: true,
      },
    });

    if (!meeting) {
      throw new ApiError(404, 'Associated meeting not found');
    }

    await assertUserCanAccessMeeting(userId, meeting);

    if (meeting.organizationId && meeting.organizationId !== input.organizationId) {
      throw new ApiError(400, 'Meeting and whiteboard must belong to the same organization');
    }

    let shouldUpdateMeetingOrg = false;
    if (!meeting.organizationId) {
      if (meeting.hostId !== userId) {
        throw new ApiError(
          403,
          'Only the meeting host can assign an organization to this meeting'
        );
      }
      shouldUpdateMeetingOrg = true;
    }

    const defaultContent: Prisma.InputJsonObject = {
      elements: [],
      viewState: {
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#ffffff',
      },
    };

    const initialContent = (input.content ?? defaultContent) as Prisma.InputJsonValue;

    const whiteboard = await prisma.$transaction(async (tx) => {
      if (shouldUpdateMeetingOrg) {
        await tx.meeting.update({
          where: { id: meeting.id },
          data: { organizationId: input.organizationId },
        });
      }

      const createdBoard = await tx.whiteboard.create({
        data: {
          name: input.name,
          organizationId: input.organizationId,
          createdById: userId,
          meetingId: targetMeetingId,
          content: initialContent,
          meetings: {
            create: {
              meetingId: targetMeetingId,
            },
          },
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      });

      const link = await tx.whiteboardMeeting.findUnique({
        where: {
          whiteboardId_meetingId: {
            whiteboardId: createdBoard.id,
            meetingId: targetMeetingId,
          },
        },
      });

      if (!link) {
        throw new ApiError(500, 'Failed to link whiteboard to meeting');
      }

      return createdBoard;
    });

    return whiteboard;
  }

  const defaultContent: Prisma.InputJsonObject = {
    elements: [],
    viewState: {
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      backgroundColor: '#ffffff',
    },
  };

  const initialContent = (input.content ?? defaultContent) as Prisma.InputJsonValue;

  const whiteboard = await prisma.whiteboard.create({
    data: {
      name: input.name,
      organizationId: input.organizationId,
      createdById: userId,
      meetingId: null,
      content: initialContent,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  return whiteboard;
};

export const getOrganizationWhiteboards = async (
  userId: string,
  query: GetWhiteboardsQuery
) => {
  let targetOrgId = query.organizationId;

  if (!targetOrgId) {
    const userMembership = await prisma.organizationMember.findFirst({
      where: { userId },
      select: { organizationId: true },
      orderBy: { joinedAt: 'desc' },
    });

    if (userMembership) {
      targetOrgId = userMembership.organizationId;
    } else {
      const ownedOrg = await prisma.organization.findFirst({
        where: { ownerId: userId },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (ownedOrg) {
        targetOrgId = ownedOrg.id;
      }
    }
  }

  if (!targetOrgId) {
    return {
      whiteboards: [],
      pagination: {
        total: 0,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        totalPages: 0,
        hasMore: false,
      },
    };
  }

  await assertUserBelongsToOrganization(userId, targetOrgId);

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Prisma.WhiteboardWhereInput = {
    organizationId: targetOrgId,
    ...(query.search
      ? {
          name: {
            contains: query.search,
            mode: 'insensitive',
          },
        }
      : {}),
  };

  const [total, whiteboards] = await Promise.all([
    prisma.whiteboard.count({ where }),
    prisma.whiteboard.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        meetings: {
          select: {
            meetingId: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  return {
    whiteboards,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
};

export const getWhiteboardById = async (userId: string, whiteboardId: string) => {
  const whiteboard = await prisma.whiteboard.findUnique({
    where: { id: whiteboardId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          ownerId: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
      meetings: {
        include: {
          meeting: {
            select: {
              id: true,
              code: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!whiteboard) {
    throw new ApiError(404, 'Whiteboard not found');
  }

  await assertUserBelongsToOrganization(userId, whiteboard.organizationId);

  return whiteboard;
};

export const updateWhiteboard = async (
  userId: string,
  whiteboardId: string,
  input: UpdateWhiteboardInput
) => {
  const existing = await prisma.whiteboard.findUnique({
    where: { id: whiteboardId },
    select: { id: true, organizationId: true },
  });

  if (!existing) {
    throw new ApiError(404, 'Whiteboard not found');
  }

  await assertUserBelongsToOrganization(userId, existing.organizationId);

  if (input.content !== undefined) {
    return coordinatedUpdateWhiteboard(userId, whiteboardId, input);
  }

  const data: Prisma.WhiteboardUpdateInput = {};
  if (input.name !== undefined) {
    data.name = input.name;
  }

  const updated = await prisma.whiteboard.update({
    where: { id: whiteboardId },
    data,
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
    },
  });

  return updated;
};

export const deleteWhiteboard = async (userId: string, whiteboardId: string) => {
  const existing = await prisma.whiteboard.findUnique({
    where: { id: whiteboardId },
    select: {
      id: true,
      createdById: true,
      organizationId: true,
    },
  });

  if (!existing) {
    throw new ApiError(404, 'Whiteboard not found');
  }

  const { role, isOwner } = await assertUserBelongsToOrganization(
    userId,
    existing.organizationId
  );

  const isCreator = existing.createdById === userId;
  const isAdmin = role === OrgRole.ORG_ADMIN;

  if (!isCreator && !isAdmin && !isOwner) {
    throw new ApiError(
      403,
      'Only the whiteboard creator, organization admin, or owner can delete this board'
    );
  }

  await cleanupWhiteboardSession(whiteboardId);

  await prisma.whiteboard.delete({
    where: { id: whiteboardId },
  });

  return { message: 'Whiteboard deleted successfully' };
};

export const findMeetingByCodeOrId = async (codeOrId: string) => {
  const meeting = await prisma.meeting.findFirst({
    where: {
      OR: [{ code: codeOrId }, { id: codeOrId }],
    },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!meeting) {
    throw new ApiError(404, 'Meeting not found');
  }

  return meeting;
};

export const assertUserCanAccessMeeting = async (
  userId: string,
  meeting: { id: string; hostId: string; admitted: string[]; organizationId: string | null }
) => {
  if (meeting.hostId === userId || meeting.admitted.includes(userId)) {
    return;
  }

  if (meeting.organizationId) {
    try {
      await assertUserBelongsToOrganization(userId, meeting.organizationId);
      return;
    } catch {
    }
  }

  throw new ApiError(403, 'You do not have access to this meeting');
};

export const linkWhiteboardToMeeting = async (
  userId: string,
  whiteboardId: string,
  meetingCodeOrId: string
) => {
  const whiteboard = await prisma.whiteboard.findUnique({
    where: { id: whiteboardId },
    select: { id: true, organizationId: true, name: true },
  });

  if (!whiteboard) {
    throw new ApiError(404, 'Whiteboard not found');
  }

  await assertUserBelongsToOrganization(userId, whiteboard.organizationId);

  const meeting = await findMeetingByCodeOrId(meetingCodeOrId);
  await assertUserCanAccessMeeting(userId, meeting);

  if (meeting.organizationId && meeting.organizationId !== whiteboard.organizationId) {
    throw new ApiError(
      400,
      'Cannot link board: Meeting and whiteboard must belong to the same organization'
    );
  }

  let shouldUpdateMeetingOrg = false;
  if (!meeting.organizationId) {
    if (meeting.hostId !== userId) {
      throw new ApiError(
        403,
        'Only the meeting host can assign an organization to this meeting'
      );
    }
    shouldUpdateMeetingOrg = true;
  }

  const link = await prisma.$transaction(async (tx) => {
    if (shouldUpdateMeetingOrg) {
      await tx.meeting.update({
        where: { id: meeting.id },
        data: { organizationId: whiteboard.organizationId },
      });
    }

    return tx.whiteboardMeeting.upsert({
      where: {
        whiteboardId_meetingId: {
          whiteboardId,
          meetingId: meeting.id,
        },
      },
      create: {
        whiteboardId,
        meetingId: meeting.id,
      },
      update: {},
    });
  });

  return {
    link,
    whiteboardId,
    meetingId: meeting.id,
    meetingCode: meeting.code,
  };
};

export const openWhiteboardInMeeting = async (
  userId: string,
  whiteboardId: string,
  meetingCodeOrId: string
) => {
  await linkWhiteboardToMeeting(userId, whiteboardId, meetingCodeOrId);
  const whiteboard = await getWhiteboardById(userId, whiteboardId);
  const meeting = await findMeetingByCodeOrId(meetingCodeOrId);

  return {
    whiteboard,
    meeting: {
      id: meeting.id,
      code: meeting.code,
      status: meeting.status,
      organizationId: meeting.organizationId,
    },
    socketRoom: `whiteboard:${whiteboard.id}`,
  };
};

export const getMeetingWhiteboards = async (
  userId: string,
  meetingCodeOrId: string
) => {
  const meeting = await findMeetingByCodeOrId(meetingCodeOrId);
  await assertUserCanAccessMeeting(userId, meeting);

  const whiteboards = await prisma.whiteboard.findMany({
    where: {
      meetings: {
        some: {
          meetingId: meeting.id,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  return {
    meeting: {
      id: meeting.id,
      code: meeting.code,
      organizationId: meeting.organizationId,
    },
    whiteboards,
  };
};

export const createWhiteboardForMeeting = async (
  userId: string,
  meetingCodeOrId: string,
  data: { name: string; organizationId?: string; content?: any }
) => {
  const meeting = await findMeetingByCodeOrId(meetingCodeOrId);
  await assertUserCanAccessMeeting(userId, meeting);

  let targetOrgId = meeting.organizationId;
  let shouldAssignOrg = false;

  if (!targetOrgId) {
    if (meeting.hostId !== userId) {
      throw new ApiError(
        403,
        'Only the meeting host can assign an organization to this meeting'
      );
    }
    if (!data.organizationId) {
      throw new ApiError(
        400,
        'organizationId is required when creating a whiteboard for a meeting that is not yet linked to an organization'
      );
    }
    targetOrgId = data.organizationId;
    await assertUserBelongsToOrganization(userId, targetOrgId);
    shouldAssignOrg = true;
  } else {
    if (data.organizationId && data.organizationId !== targetOrgId) {
      throw new ApiError(
        400,
        'Meeting and whiteboard must belong to the same organization'
      );
    }
    await assertUserBelongsToOrganization(userId, targetOrgId);
  }

  const defaultContent: Prisma.InputJsonObject = {
    elements: [],
    viewState: {
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      backgroundColor: '#ffffff',
    },
  };

  const initialContent = (data.content ?? defaultContent) as Prisma.InputJsonValue;

  const whiteboard = await prisma.$transaction(async (tx) => {
    if (shouldAssignOrg) {
      await tx.meeting.update({
        where: { id: meeting.id },
        data: { organizationId: targetOrgId },
      });
    }

    const createdBoard = await tx.whiteboard.create({
      data: {
        name: data.name,
        organizationId: targetOrgId!,
        createdById: userId,
        meetingId: meeting.id,
        content: initialContent,
        meetings: {
          create: {
            meetingId: meeting.id,
          },
        },
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    const linkExists = await tx.whiteboardMeeting.findUnique({
      where: {
        whiteboardId_meetingId: {
          whiteboardId: createdBoard.id,
          meetingId: meeting.id,
        },
      },
    });

    if (!linkExists) {
      throw new ApiError(500, 'Failed to link newly created whiteboard to meeting');
    }

    return createdBoard;
  });

  return {
    whiteboard,
    meeting: {
      id: meeting.id,
      code: meeting.code,
      status: meeting.status,
      organizationId: targetOrgId,
    },
    socketRoom: `whiteboard:${whiteboard.id}`,
  };
};
