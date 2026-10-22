import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { SavedItemType, Prisma } from '@prisma/client';

export interface SaveItemInput {
  itemType: SavedItemType;
  itemId: string;
  note?: string | null;
  collectionId?: string | null;
}

export interface UpdateSavedItemInput {
  note?: string | null;
  collectionId?: string | null;
}

export interface GetSavedItemsQuery {
  itemType?: SavedItemType;
  collectionId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface CreateCollectionInput {
  name: string;
  description?: string | null;
  color?: string | null;
}

export interface UpdateCollectionInput {
  name?: string;
  description?: string | null;
  color?: string | null;
}

const resolveItemMetadata = async (userId: string, itemType: SavedItemType, itemId: string) => {
  if (itemType === 'MESSAGE' || itemType === 'FILE') {
    const message = await prisma.message.findUnique({
      where: { id: itemId },
      include: {
        conversation: {
          select: {
            id: true,
            type: true,
            name: true,
            participants: {
              where: { userId },
              select: { id: true }
            }
          }
        },
        sender: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        }
      }
    });

    if (!message) {
      return { isAccessible: false, content: null, title: 'Deleted message or file', searchText: '' };
    }

    if (message.conversation.participants.length === 0) {
      return { isAccessible: false, content: null, title: 'Inaccessible message', searchText: '' };
    }

    if (itemType === 'FILE' && (!message.fileUrl || message.fileUrl.trim().length === 0)) {
      return { isAccessible: false, content: null, title: 'Message contains no file attachment', searchText: '' };
    }

    const title = itemType === 'FILE' ? (message.fileName || 'Attached file') : (message.content.slice(0, 80) || 'Message');
    const searchText = `${message.content || ''} ${message.fileName || ''} ${message.conversation.name || ''}`.toLowerCase();

    return {
      isAccessible: true,
      content: {
        id: message.id,
        conversationId: message.conversationId,
        conversationType: message.conversation.type,
        conversationName: message.conversation.name,
        sender: message.sender,
        content: message.content,
        fileUrl: message.fileUrl,
        fileName: message.fileName,
        fileType: message.fileType,
        fileSize: message.fileSize,
        createdAt: message.createdAt
      },
      title,
      searchText
    };
  }

  if (itemType === 'CHAT') {
    const conversation = await prisma.conversation.findUnique({
      where: { id: itemId },
      include: {
        participants: {
          where: { userId },
          select: { id: true, role: true }
        }
      }
    });

    if (!conversation) {
      return { isAccessible: false, content: null, title: 'Deleted conversation', searchText: '' };
    }

    if (conversation.participants.length === 0) {
      return { isAccessible: false, content: null, title: 'Inaccessible conversation', searchText: '' };
    }

    const title = conversation.name || 'Chat Conversation';
    const searchText = (conversation.name || '').toLowerCase();

    return {
      isAccessible: true,
      content: {
        id: conversation.id,
        type: conversation.type,
        name: conversation.name,
        createdAt: conversation.createdAt
      },
      title,
      searchText
    };
  }

  if (itemType === 'DOCUMENT' || itemType === 'RESOURCE') {
    const post = await prisma.communityPost.findUnique({
      where: { id: itemId },
      include: {
        community: {
          select: {
            id: true,
            name: true,
            members: {
              where: { userId },
              select: { id: true }
            }
          }
        },
        channel: {
          select: {
            id: true,
            name: true
          }
        },
        author: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        }
      }
    });

    if (!post) {
      return { isAccessible: false, content: null, title: 'Deleted post or resource', searchText: '' };
    }

    if (post.community.members.length === 0) {
      return { isAccessible: false, content: null, title: 'Inaccessible resource', searchText: '' };
    }

    if (itemType === 'DOCUMENT' && (!post.fileUrl || post.fileUrl.trim().length === 0)) {
      return { isAccessible: false, content: null, title: 'Post contains no attached document', searchText: '' };
    }

    const title = post.fileName || post.content.slice(0, 80) || 'Community Resource';
    const searchText = `${post.content || ''} ${post.fileName || ''} ${post.community.name || ''} ${post.channel.name || ''}`.toLowerCase();

    return {
      isAccessible: true,
      content: {
        id: post.id,
        communityId: post.communityId,
        communityName: post.community.name,
        channelId: post.channelId,
        channelName: post.channel.name,
        author: post.author,
        content: post.content,
        fileUrl: post.fileUrl,
        fileName: post.fileName,
        fileType: post.fileType,
        fileSize: post.fileSize,
        createdAt: post.createdAt
      },
      title,
      searchText
    };
  }

  return { isAccessible: true, content: null, title: 'Saved Item', searchText: '' };
};

export const saveItem = async (userId: string, data: SaveItemInput) => {
  if (data.collectionId) {
    const collection = await prisma.savedCollection.findFirst({
      where: { id: data.collectionId, userId }
    });
    if (!collection) {
      throw new ApiError(404, 'Saved collection not found');
    }
  }

  const metadata = await resolveItemMetadata(userId, data.itemType, data.itemId);
  if (!metadata.isAccessible) {
    throw new ApiError(400, metadata.title || 'Item not found, inaccessible, or invalid for the selected item type');
  }

  return await prisma.savedItem.upsert({
    where: {
      userId_itemType_itemId: {
        userId,
        itemType: data.itemType,
        itemId: data.itemId
      }
    },
    update: {
      note: data.note !== undefined ? data.note : undefined,
      collectionId: data.collectionId !== undefined ? data.collectionId : undefined
    },
    create: {
      userId,
      itemType: data.itemType,
      itemId: data.itemId,
      note: data.note || null,
      collectionId: data.collectionId || null
    },
    include: {
      collection: {
        select: {
          id: true,
          name: true,
          color: true
        }
      }
    }
  });
};

export const getSavedItems = async (userId: string, query: GetSavedItemsQuery) => {
  const take = Math.min(Math.max(query.limit || 20, 1), 50);

  const whereClause: any = {
    userId,
    ...(query.itemType ? { itemType: query.itemType } : {}),
    ...(query.collectionId ? { collectionId: query.collectionId } : {})
  };

  const searchTerm = query.search ? query.search.trim().toLowerCase() : '';

  if (!searchTerm) {
    const items = await prisma.savedItem.findMany({
      where: whereClause,
      take: take + 1,
      skip: query.cursor ? 1 : 0,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        collection: {
          select: {
            id: true,
            name: true,
            color: true
          }
        }
      }
    });

    const hasNextPage = items.length > take;
    const pagedItems = hasNextPage ? items.slice(0, take) : items;
    const nextCursor = hasNextPage && pagedItems.length > 0 ? pagedItems[pagedItems.length - 1].id : null;

    const enrichedItems = await Promise.all(
      pagedItems.map(async (item) => {
        const details = await resolveItemMetadata(userId, item.itemType, item.itemId);
        return {
          id: item.id,
          itemType: item.itemType,
          itemId: item.itemId,
          note: item.note,
          collection: item.collection,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          isAccessible: details.isAccessible,
          title: details.title,
          content: details.content
        };
      })
    );

    return {
      items: enrichedItems,
      nextCursor,
      hasNextPage
    };
  }

  const matchedItems: any[] = [];
  let currentCursor = query.cursor;
  let hasMoreDbRecords = true;
  let lastScannedId: string | null = null;

  while (matchedItems.length < take + 1 && hasMoreDbRecords) {
    const batch = await prisma.savedItem.findMany({
      where: whereClause,
      take: 50,
      skip: currentCursor ? 1 : 0,
      cursor: currentCursor ? { id: currentCursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        collection: {
          select: {
            id: true,
            name: true,
            color: true
          }
        }
      }
    });

    if (batch.length === 0) {
      hasMoreDbRecords = false;
      break;
    }

    currentCursor = batch[batch.length - 1].id;

    for (const item of batch) {
      lastScannedId = item.id;
      const details = await resolveItemMetadata(userId, item.itemType, item.itemId);
      const combinedText = `${item.note || ''} ${details.searchText}`.toLowerCase();

      if (combinedText.includes(searchTerm)) {
        matchedItems.push({
          id: item.id,
          itemType: item.itemType,
          itemId: item.itemId,
          note: item.note,
          collection: item.collection,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          isAccessible: details.isAccessible,
          title: details.title,
          content: details.content
        });

        if (matchedItems.length === take + 1) {
          break;
        }
      }
    }

    if (batch.length < 50) {
      hasMoreDbRecords = false;
    }
  }

  const hasNextPage = matchedItems.length > take || (hasMoreDbRecords && Boolean(lastScannedId));
  const pagedItems = matchedItems.length > take ? matchedItems.slice(0, take) : matchedItems;
  const nextCursor = hasNextPage ? (pagedItems.length > 0 ? pagedItems[pagedItems.length - 1].id : lastScannedId) : null;

  return {
    items: pagedItems,
    nextCursor,
    hasNextPage
  };
};

export const updateSavedItem = async (userId: string, id: string, data: UpdateSavedItemInput) => {
  const existing = await prisma.savedItem.findFirst({
    where: { id, userId }
  });

  if (!existing) {
    throw new ApiError(404, 'Saved item not found');
  }

  if (data.collectionId) {
    const collection = await prisma.savedCollection.findFirst({
      where: { id: data.collectionId, userId }
    });
    if (!collection) {
      throw new ApiError(404, 'Saved collection not found');
    }
  }

  return await prisma.savedItem.update({
    where: { id },
    data: {
      note: data.note !== undefined ? data.note : existing.note,
      collectionId: data.collectionId !== undefined ? data.collectionId : existing.collectionId
    },
    include: {
      collection: {
        select: {
          id: true,
          name: true,
          color: true
        }
      }
    }
  });
};

export const removeSavedItem = async (userId: string, id: string) => {
  const existing = await prisma.savedItem.findFirst({
    where: { id, userId }
  });

  if (!existing) {
    throw new ApiError(404, 'Saved item not found');
  }

  await prisma.savedItem.delete({
    where: { id }
  });

  return { message: 'Saved item removed successfully' };
};

export const createSavedCollection = async (userId: string, data: CreateCollectionInput) => {
  const existing = await prisma.savedCollection.findFirst({
    where: {
      userId,
      name: {
        equals: data.name.trim(),
        mode: 'insensitive'
      }
    }
  });

  if (existing) {
    throw new ApiError(409, 'A collection with this name already exists');
  }

  try {
    return await prisma.savedCollection.create({
      data: {
        userId,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        color: data.color?.trim() || null
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'A collection with this name already exists');
    }
    throw error;
  }
};

export const getSavedCollections = async (userId: string) => {
  return await prisma.savedCollection.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          items: true
        }
      }
    }
  });
};

export const updateSavedCollection = async (userId: string, id: string, data: UpdateCollectionInput) => {
  const existing = await prisma.savedCollection.findFirst({
    where: { id, userId }
  });

  if (!existing) {
    throw new ApiError(404, 'Saved collection not found');
  }

  if (data.name && data.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
    const conflict = await prisma.savedCollection.findFirst({
      where: {
        userId,
        name: {
          equals: data.name.trim(),
          mode: 'insensitive'
        },
        id: { not: id }
      }
    });

    if (conflict) {
      throw new ApiError(409, 'A collection with this name already exists');
    }
  }

  try {
    return await prisma.savedCollection.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.color !== undefined ? { color: data.color?.trim() || null } : {})
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'A collection with this name already exists');
    }
    throw error;
  }
};

export const deleteSavedCollection = async (userId: string, id: string) => {
  const existing = await prisma.savedCollection.findFirst({
    where: { id, userId }
  });

  if (!existing) {
    throw new ApiError(404, 'Saved collection not found');
  }

  await prisma.savedCollection.delete({
    where: { id }
  });

  return { message: 'Collection deleted successfully' };
};
