import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger, errorMessage } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
}

/**
 * Terminal error handler.
 *
 * Client errors (4xx) return their message; server errors return a generic one
 * so internal details such as filesystem paths never reach the response body.
 */
export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;

  if (statusCode >= 500) {
    logger.error('Unhandled request error', {
      method: req.method,
      path: req.originalUrl,
      error: errorMessage(err),
      stack: err.stack,
    });
  } else {
    logger.warn('Request error', {
      method: req.method,
      path: req.originalUrl,
      statusCode,
      error: errorMessage(err),
    });
  }

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? 'Internal server error' : errorMessage(err),
    data: null,
    ...(config.isProduction ? {} : { stack: err.stack }),
    timestamp: new Date().toISOString(),
  });
};
