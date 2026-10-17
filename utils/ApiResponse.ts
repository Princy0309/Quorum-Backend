import { Response } from 'express';

export class ApiResponse<T = any> {
  statusCode: number;
  data: T;
  message: string;
  success: boolean;

  constructor(statusCode: number, data: T, message: string = 'Success') {
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
    this.success = statusCode < 400;
  }
}

export const sendSuccess = (res: Response, statusCode: number, message: string, data: any = null) => {
  return res.status(statusCode).json(new ApiResponse(statusCode, data, message));
};

export default { ApiResponse, sendSuccess };
