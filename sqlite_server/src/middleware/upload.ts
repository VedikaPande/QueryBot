import multer from 'multer';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { ensureUploadsDir } from '../utils/fileUtils';

ensureUploadsDir();

const ALLOWED_EXTENSIONS = ['.sqlite', '.db', '.csv'];

export const upload = multer({
  dest: config.uploadDir,
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(extension)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Invalid file type. Accepted formats: ${ALLOWED_EXTENSIONS.join(', ')}`));
  },
  limits: {
    fileSize: config.maxFileSizeBytes,
    files: 1,
  },
});

/**
 * Translate multer failures into the shared response envelope.
 *
 * Without this, an oversized upload surfaces as an opaque 500 from the generic
 * error handler instead of a 413 the client can explain to the user.
 */
export const handleUploadErrors = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!err) {
    next();
    return;
  }

  const timestamp = new Date().toISOString();

  if (err instanceof multer.MulterError) {
    const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
    const megabytes = Math.round(config.maxFileSizeBytes / (1024 * 1024));
    res.status(isTooLarge ? 413 : 400).json({
      success: false,
      message: isTooLarge ? `File exceeds the ${megabytes}MB limit` : err.message,
      data: null,
      timestamp,
    });
    return;
  }

  res.status(400).json({
    success: false,
    message: err instanceof Error ? err.message : 'File upload failed',
    data: null,
    timestamp,
  });
};
