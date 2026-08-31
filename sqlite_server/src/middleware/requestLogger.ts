import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/** Log one line per completed request. */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();

  res.on('finish', () => {
    const context = {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    };

    if (res.statusCode >= 500) {
      logger.error('Request failed', context);
    } else if (res.statusCode >= 400) {
      logger.warn('Request rejected', context);
    } else {
      logger.info('Request completed', context);
    }
  });

  next();
};
