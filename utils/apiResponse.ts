import { Response } from 'express';

export const sendSuccess = (res: Response, statusCode: number, message: string, data: any = null) => {
  const response: any = { success: true, statusCode, message };
  if (data !== null && data !== undefined) response.data = data;
  return res.status(statusCode).json(response);
};

export const sendError = (res: Response, statusCode: number, message: string) => {
  return res.status(statusCode).json({ success: false, statusCode, message });
};

export default { sendSuccess, sendError };
