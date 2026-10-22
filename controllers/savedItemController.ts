import { Request, Response, NextFunction } from 'express';
import ApiError from '../utils/ApiError.js';
import {
  saveItemSchema,
  updateSavedItemSchema,
  getSavedItemsQuerySchema,
  createSavedCollectionSchema,
  updateSavedCollectionSchema,
  savedItemIdParamSchema,
  savedCollectionIdParamSchema
} from '../validators/savedItemValidators.js';
import {
  saveItem,
  getSavedItems,
  updateSavedItem,
  removeSavedItem,
  createSavedCollection,
  getSavedCollections,
  updateSavedCollection,
  deleteSavedCollection
} from '../services/savedItemService.js';

export const saveItemController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const validatedData = saveItemSchema.parse(req.body);
    const result = await saveItem(userId, validatedData);

    res.status(201).json({
      success: true,
      message: 'Item saved successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getSavedItemsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const query = getSavedItemsQuerySchema.parse(req.query);
    const result = await getSavedItems(userId, query);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const updateSavedItemController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { id } = savedItemIdParamSchema.parse(req.params);
    const validatedData = updateSavedItemSchema.parse(req.body);
    const result = await updateSavedItem(userId, id, validatedData);

    res.status(200).json({
      success: true,
      message: 'Saved item updated successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const removeSavedItemController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { id } = savedItemIdParamSchema.parse(req.params);
    const result = await removeSavedItem(userId, id);

    res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (err) {
    next(err);
  }
};

export const createCollectionController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const validatedData = createSavedCollectionSchema.parse(req.body);
    const result = await createSavedCollection(userId, validatedData);

    res.status(201).json({
      success: true,
      message: 'Collection created successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getCollectionsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const result = await getSavedCollections(userId);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const updateCollectionController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { id } = savedCollectionIdParamSchema.parse(req.params);
    const validatedData = updateSavedCollectionSchema.parse(req.body);
    const result = await updateSavedCollection(userId, id, validatedData);

    res.status(200).json({
      success: true,
      message: 'Collection updated successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const deleteCollectionController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { id } = savedCollectionIdParamSchema.parse(req.params);
    const result = await deleteSavedCollection(userId, id);

    res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (err) {
    next(err);
  }
};
