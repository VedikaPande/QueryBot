/**
 * Runtime configuration.
 *
 * The SQLite service is deliberately absent: the browser no longer talks to it
 * directly. Every dataset operation goes through the Flask API, which
 * authenticates the user and checks dataset ownership first.
 */
export const config = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  APP_NAME: 'QueryBot',
  VERSION: '1.0.0',

  /** Upload ceiling mirrored from the server so the UI can reject early. */
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
  ACCEPTED_FILE_TYPES: ['.csv', '.sqlite', '.db'] as const,
} as const;

/** Base URL of the API host, without the `/api` path segment. */
export const apiHost = config.API_BASE_URL.replace(/\/api\/?$/, '');
