import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  askAiAssistant,
  searchWorkspaceWithAi,
  getProjectAssistance,
  generateQuickResponses,
  generateProjectStatusUpdate,
  AiChatAttachmentInput
} from '../services/aiChatService.js';
import { summarizeConversationChat } from '../services/aiSummaryService.js';
import {
  recordAiInteraction,
  getUserAiHistory,
  deleteUserAiHistory
} from '../services/aiHistoryService.js';
import { getSignedUploadUrl, uploadBufferToS3 } from '../services/uploadService.js';

const sendAiSuccess = (res: Response, statusCode: number, message: string, data: any) => {
  return res.status(statusCode).json({
    statusCode,
    success: statusCode < 400,
    message,
    data,
    ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {})
  });
};

export const chatController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const prompt = String(req.body?.prompt || req.body?.message || '').trim();
  const context = req.body?.context;

  const attachments: AiChatAttachmentInput[] = [];

  // 1. Direct multipart file uploads via multer (req.files or req.file)
  const uploadedFiles = (req.files && Array.isArray(req.files) && req.files.length > 0)
    ? req.files
    : ((req as any).file ? [(req as any).file] : []);

  for (const file of uploadedFiles) {
    attachments.push({
      buffer: file.buffer,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
    });
  }

  // 2. Attachments array in JSON body
  const bodyAttachments = req.body?.attachments || req.body?.files;
  if (Array.isArray(bodyAttachments)) {
    for (const item of bodyAttachments) {
      if (item && typeof item === 'object') {
        attachments.push({
          fileUrl: item.fileUrl || item.url,
          fileName: item.fileName,
          fileType: item.fileType,
          mimeType: item.mimeType,
          fileSize: item.fileSize ? Number(item.fileSize) : undefined,
          base64Data: item.base64Data,
        });
      }
    }
  }

  // 3. Flat single attachment fields in JSON body
  if (req.body?.fileUrl || req.body?.url || req.body?.base64Data) {
    attachments.push({
      fileUrl: req.body.fileUrl || req.body.url,
      fileName: req.body.fileName,
      fileType: req.body.fileType,
      mimeType: req.body.mimeType,
      fileSize: req.body.fileSize ? Number(req.body.fileSize) : undefined,
      base64Data: req.body.base64Data,
    });
  }

  const result = await askAiAssistant(prompt, context, attachments.length > 0 ? attachments : undefined);

  if (userId) {
    const fileLabel = attachments.length > 0 
      ? ` [${attachments.length} attachment(s) shared: ${attachments.map(a => a.fileName || 'file').slice(0, 3).join(', ')}]` 
      : '';
    await recordAiInteraction(userId, {
      prompt: (prompt || 'Analyze attached file') + fileLabel,
      response: result.answer,
      actionType: 'chat',
      model: result.metadata?.model,
      tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
    });
  }

  return sendAiSuccess(res, 200, 'AI response generated successfully', result);
});

export const uploadAiFileController = asyncHandler(async (req: Request, res: Response) => {
  const uploadedFiles = (req.files && Array.isArray(req.files) && req.files.length > 0)
    ? req.files
    : ((req as any).file ? [(req as any).file] : []);

  if (uploadedFiles.length > 0) {
    const file = uploadedFiles[0];
    const uploadResult = await uploadBufferToS3(file.buffer, file.originalname, 'ai', file.mimetype);
    return sendAiSuccess(res, 201, 'File uploaded to S3 for AI analysis successfully', uploadResult);
  }

  const fileName = String(req.body?.fileName || req.body?.name || 'document.pdf').trim();
  const signedData = await getSignedUploadUrl('ai', fileName);
  return sendAiSuccess(res, 200, 'S3 presigned upload URL generated for AI file sharing', signedData);
});

export const summarizeChatController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const conversationId = String(req.params.conversationId || req.body?.conversationId || '').trim();
  if (!conversationId) {
    throw new ApiError(400, 'conversationId is required in route params or request body');
  }
  const { limit, focus } = req.body || {};

  const result = await summarizeConversationChat(userId, conversationId, {
    limit: limit ? Number(limit) : undefined,
    focus: typeof focus === 'string' ? focus : undefined
  });

  await recordAiInteraction(userId, {
    prompt: `Summarize conversation: ${conversationId}${focus ? ` (focus: ${focus})` : ''}`,
    response: result.summary,
    actionType: 'summary',
    conversationId,
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
  });

  return sendAiSuccess(res, 200, 'Conversation summarized successfully', result);
});

export const searchWorkspaceController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { query, limit } = req.body;
  const result = await searchWorkspaceWithAi(userId, query, {
    limit: limit ? Number(limit) : undefined
  });

  await recordAiInteraction(userId, {
    prompt: `Workspace search: ${query}`,
    response: result.answer,
    actionType: 'search',
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
  });

  return sendAiSuccess(res, 200, 'Workspace search completed successfully', result);
});

export const projectAssistanceController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { prompt, organizationId, teamId, communityId } = req.body;
  const result = await getProjectAssistance(userId, prompt, {
    organizationId,
    teamId,
    communityId
  });

  await recordAiInteraction(userId, {
    prompt,
    response: result.answer,
    actionType: 'project_assistance',
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
  });

  return sendAiSuccess(res, 200, 'Project assistance generated successfully', result);
});

export const quickRepliesController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { mode, message, conversationId, tone } = req.body;
  const result = await generateQuickResponses(userId, {
    mode,
    message,
    conversationId,
    tone
  });

  await recordAiInteraction(userId, {
    prompt: `Quick ${mode}: ${message || conversationId}`,
    response: result.suggestions.join('\n'),
    actionType: 'quick_replies',
    conversationId,
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
  });

  return sendAiSuccess(res, 200, 'Quick response suggestions generated successfully', result);
});

export const projectUpdateController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { organizationId, teamId, communityId, timeframe } = req.body;
  const result = await generateProjectStatusUpdate(userId, {
    organizationId,
    teamId,
    communityId,
    timeframe
  });

  await recordAiInteraction(userId, {
    prompt: `Project update (${timeframe}): ${organizationId || teamId || communityId || 'user projects'}`,
    response: result.statusUpdate,
    actionType: 'project_update',
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
  });

  return sendAiSuccess(res, 200, 'Project update generated successfully', result);
});

export const getHistoryController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { limit, cursor, actionType, conversationId } = req.query;
  const result = await getUserAiHistory(userId, {
    limit: limit ? Number(limit) : undefined,
    cursor: typeof cursor === 'string' ? cursor : undefined,
    actionType: typeof actionType === 'string' ? actionType : undefined,
    conversationId: typeof conversationId === 'string' ? conversationId : undefined
  });

  return sendAiSuccess(res, 200, 'AI assistant history retrieved successfully', result);
});

export const deleteHistoryController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const rawId = req.params.id || req.query.id;
  const interactionId = typeof rawId === 'string' ? rawId : undefined;
  const result = await deleteUserAiHistory(userId, interactionId);

  return sendAiSuccess(res, 200, 'AI assistant history deleted successfully', result);
});
