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

const resolveItemsMetadataBatch = async (
  userId: string,
  items: Array<{ id: string; itemType: SavedItemType; itemId: string }>
) => {
  const messageIds = items.filter((i) => i.itemType === 'MESSAGE' || i.itemType === 'FILE').map((i) => i.itemId);
  const conversationIds = items.filter((i) => i.itemType === 'CHAT').map((i) => i.itemId);
  const postIds = items.filter((i) => i.itemType === 'DOCUMENT' || i.itemType === 'RESOURCE').map((i) => i.itemId);

  const [messages, conversations, posts] = await Promise.all([
    messageIds.length > 0
      ? prisma.message.findMany({
          where: { id: { in: messageIds } },
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
        })
      : [],
    conversationIds.length > 0
      ? prisma.conversation.findMany({
          where: { id: { in: conversationIds } },
          include: {
            participants: {
              where: { userId },
              select: { id: true, role: true }
            }
          }
        })
      : [],
    postIds.length > 0
      ? prisma.communityPost.findMany({
          where: { id: { in: postIds } },
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
        })
      : []
  ]);

  const messageMap = new Map(messages.map((m) => [m.id, m]));
  const conversationMap = new Map(conversations.map((c) => [c.id, c]));
  const postMap = new Map(posts.map((p) => [p.id, p]));

  const metadataMap = new Map<string, { isAccessible: boolean; content: any; title: string; searchText: string }>();

  for (const item of items) {
    if (item.itemType === 'MESSAGE' || item.itemType === 'FILE') {
      const msg = messageMap.get(item.itemId);
      if (!msg) {
        metadataMap.set(item.id, { isAccessible: false, content: null, title: 'Deleted message or file', searchText: '' });
      } else if (msg.conversation.participants.length === 0) {
        metadataMap.set(item.id, { isAccessible: false, content: null, title: 'Inaccessible message', searchText: '' });
      } else if (item.itemType === 'FILE' && (!msg.fileUrl || msg.fileUrl.trim().length === 0)) {
        metadataMap.set(item.id, { isAccessible: false, content: null, title: 'Message contains no file attachment', searchText: '' });
      } else {
        const title = item.itemType === 'FILE' ? (msg.fileName || 'Attached file') : (msg.content.slice(0, 80) || 'Message');
        const searchText = `${msg.content || ''} ${msg.fileName || ''} ${msg.conversation.name || ''}`.toLowerCase();
        metadataMap.set(item.id, {
          isAccessible: true,
          content: {
            id: msg.id,
            conversationId: msg.conversationId,
            conversationType: msg.conversation.type,
            conversationName: msg.conversation.name,
            sender: msg.sender,
            content: msg.content,
            fileUrl: msg.fileUrl,
            fileName: msg.fileName,
            fileType: msg.fileType,
            fileSize: msg.fileSize,
            createdAt: msg.createdAt
          },
          title,
          searchText
        });
      }
    } else if (item.itemType === 'CHAT') {
      const conv = conversationMap.get(item.itemId);
      if (!conv) {
        metadataMap.set(item.id, { isAccessible: false, content: null, title: 'Deleted conversation', searchText: '' });
      } else if (conv.participants.length === 0) {
        metadataMap.set(item.id, { isAccessible: false, content: null, title: 'Inaccessible conversation', searchText: '' });
      } else {
        const title = conv.name || 'Chat Conversation';
        metadataMap.set(item.id, {
          isAccessible: true,
          content: {
            id: conv.id,
            type: conv.type,
            name: conv.name,
            createdAt: conv.createdAt
          },
          title,
          searchText: (conv.name || '').toLowerCase()
        });
      }
    } else if (item.itemType === 'DOCUMENT' || item.itemType === 'RESOURCE') {
      const post = postMap.get(item.itemId);
      if (!post) {
        metadataMap.set(item.id, { isAccessible: false, content: null, title: 'Deleted post or resource', searchText: '' });
      } else if (post.community.members.length === 0) {
        metadataMap.set(item.id, { isAccessible: false, content: null, title: 'Inaccessible resource', searchText: '' });
      } else if (item.itemType === 'DOCUMENT' && (!post.fileUrl || post.fileUrl.trim().length === 0)) {
        metadataMap.set(item.id, { isAccessible: false, content: null, title: 'Post contains no attached document', searchText: '' });
      } else {
        const title = post.fileName || post.content.slice(0, 80) || 'Community Resource';
        const searchText = `${post.content || ''} ${post.fileName || ''} ${post.community.name || ''} ${post.channel.name || ''}`.toLowerCase();
        metadataMap.set(item.id, {
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
        });
      }
    } else {
      metadataMap.set(item.id, { isAccessible: true, content: null, title: 'Saved Item', searchText: '' });
    }
  }

  return metadataMap;
};

const resolveItemMetadata = async (userId: string, itemType: SavedItemType, itemId: string) => {
  const map = await resolveItemsMetadataBatch(userId, [{ id: itemId, itemType, itemId }]);
  return map.get(itemId) || { isAccessible: false, content: null, title: 'Item not found', searchText: '' };
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

    const metadataMap = await resolveItemsMetadataBatch(userId, pagedItems);

    const enrichedItems = pagedItems.map((item) => {
      const details = metadataMap.get(item.id) || { isAccessible: false, content: null, title: 'Item not found' };
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
    });

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
  let hasNextMatch = false;

  while (hasMoreDbRecords) {
    const batch = await prisma.savedItem.findMany({
      where: whereClause,
      take: 50,
      skip: currentCursor ? 1 : 0,
      cursor: currentCursor ? { id: currentCursor } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
    const metadataMap = await resolveItemsMetadataBatch(userId, batch);

    for (const item of batch) {
      lastScannedId = item.id;
      const details = metadataMap.get(item.id) || { isAccessible: false, content: null, title: '', searchText: '' };
      const combinedText = `${item.note || ''} ${details.searchText}`.toLowerCase();

      if (combinedText.includes(searchTerm)) {
        if (matchedItems.length < take) {
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
        } else {
          hasNextMatch = true;
          break;
        }
      }
    }

    if (hasNextMatch) {
      break;
    }

    if (batch.length < 50) {
      hasMoreDbRecords = false;
    }
  }

  const hasNextPage = hasNextMatch;
  const nextCursor = hasNextPage && matchedItems.length > 0 ? matchedItems[matchedItems.length - 1].id : null;

  return {
    items: matchedItems,
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
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
