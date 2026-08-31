import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types/common';

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export class BaseController {
  /** Send a successful response using the shared envelope. */
  protected success<T>(res: Response, data: T, message = 'OK', statusCode = 200): Response {
    const response: ApiResponse<T> = {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    };
    return res.status(statusCode).json(response);
  }

  /** Send an error response using the shared envelope. */
  protected error(
    res: Response,
    message: string,
    statusCode = 500,
    errors?: unknown
  ): Response {
    const response: ApiResponse<null> = {
      success: false,
      message,
      data: null,
      ...(errors === undefined ? {} : { errors }),
      timestamp: new Date().toISOString(),
    };
    return res.status(statusCode).json(response);
  }

  /** Forward rejected promises to the Express error handler. */
  protected asyncHandler =
    (fn: Handler) =>
    (req: Request, res: Response, next: NextFunction): void => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
}
