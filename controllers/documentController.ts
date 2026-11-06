import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError.js';
import {
  createDocument,
  getDocumentById,
  listUserDocuments,
  updateDocument,
  deleteDocument,
  addCollaborator,
  removeCollaborator,
  openDocumentInMeeting,
  embedWhiteboardInDocument,
  executeDocumentAi,
} from '../services/documentService.js';

export const createDocumentController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const document = await createDocument(userId, req.body);
    res.status(201).json({
      success: true,
      message: 'Document created successfully',
      data: document
    });
  } catch (err) {
    next(err);
  }
};

export const listUserDocumentsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const query = {
      scopeType: typeof req.query.scopeType === 'string' ? req.query.scopeType : undefined,
      organizationId: typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined,
      projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
      teamId: typeof req.query.teamId === 'string' ? req.query.teamId : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined
    };

    const documents = await listUserDocuments(userId, query);
    res.status(200).json({
      success: true,
      data: documents
    });
  } catch (err) {
    next(err);
  }
};

export const getDocumentByIdController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const meetingCode = typeof req.query.meetingCode === 'string' ? req.query.meetingCode : undefined;

    const document = await getDocumentById(userId, documentId, meetingCode);
    res.status(200).json({
      success: true,
      data: document
    });
  } catch (err) {
    next(err);
  }
};

export const updateDocumentController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const document = await updateDocument(userId, documentId, req.body);

    res.status(200).json({
      success: true,
      message: 'Document updated successfully',
      data: document
    });
  } catch (err) {
    next(err);
  }
};

export const deleteDocumentController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await deleteDocument(userId, documentId);

    res.status(200).json({
      success: true,
      message: 'Document deleted successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const addCollaboratorController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const collaborator = await addCollaborator(userId, documentId, req.body);

    res.status(200).json({
      success: true,
      message: 'Collaborator added successfully',
      data: collaborator
    });
  } catch (err) {
    next(err);
  }
};

export const removeCollaboratorController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const targetUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

    const result = await removeCollaborator(userId, documentId, targetUserId);
    res.status(200).json({
      success: true,
      message: 'Collaborator removed successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const openDocumentInMeetingController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { meetingCode } = req.body;

    const result = await openDocumentInMeeting(userId, documentId, meetingCode);
    res.status(200).json({
      success: true,
      message: 'Document opened in meeting successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const embedWhiteboardInDocController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { whiteboardId } = req.body;

    const link = await embedWhiteboardInDocument(userId, documentId, whiteboardId);
    res.status(200).json({
      success: true,
      message: 'Whiteboard embedded in document successfully',
      data: link
    });
  } catch (err) {
    next(err);
  }
};

export const executeDocumentAiController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const aiResult = await executeDocumentAi(userId, documentId, req.body);

    res.status(200).json({
      success: true,
      data: aiResult
    });
  } catch (err) {
    next(err);
  }
};
