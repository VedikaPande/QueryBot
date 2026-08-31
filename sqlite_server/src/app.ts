import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import apiRoutes from './routes';

const app: Express = express();

// Behind a reverse proxy, trust the forwarded headers so client IPs log correctly.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Service-Token'],
  })
);

// Minimal hardening without pulling in a dependency: these responses are JSON
// and file downloads, never rendered HTML.
app.use((_req: Request, res: Response, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(requestLogger);

app.get('/health', (_req: Request, res: Response) => {
  // The service cannot do its job without a writable uploads directory.
  let storage = 'ok';
  try {
    fs.accessSync(config.uploadDir, fs.constants.W_OK);
  } catch {
    storage = 'unwritable';
  }

  res.status(storage === 'ok' ? 200 : 503).json({
    status: storage === 'ok' ? 'ok' : 'degraded',
    storage,
    uptime: process.uptime(),
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.use('/', apiRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    data: null,
    timestamp: new Date().toISOString(),
  });
});

// Must be registered last so it catches everything above it.
app.use(errorHandler);

export default app;
