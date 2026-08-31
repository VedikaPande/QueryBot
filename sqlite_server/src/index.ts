import app from './app';
import { config, validateConfig } from './config';
import { logger, errorMessage } from './utils/logger';
import { deleteOldFiles, ensureUploadsDir } from './utils/fileUtils';

validateConfig();
ensureUploadsDir();

// Sweep once at startup so a restart after downtime does not leave expired
// uploads on disk until the first interval elapses.
void deleteOldFiles();
const cleanupTimer = setInterval(() => void deleteOldFiles(), config.cleanupIntervalMs);
cleanupTimer.unref();

const server = app.listen(config.port, () => {
  logger.info('SQLite server started', {
    port: config.port,
    environment: config.nodeEnv,
    uploadDir: config.uploadDir,
    authEnabled: Boolean(config.serviceToken),
  });
});

/** Stop accepting connections and let in-flight requests finish. */
const shutdown = (signal: string): void => {
  logger.info('Shutting down', { signal });
  clearInterval(cleanupTimer);

  server.close((error) => {
    if (error) {
      logger.error('Error during shutdown', { error: errorMessage(error) });
      process.exit(1);
    }
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Do not hang forever on a stuck connection.
  setTimeout(() => {
    logger.warn('Forcing shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: errorMessage(reason) });
});
