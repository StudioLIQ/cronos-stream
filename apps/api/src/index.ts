import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { logger } from './logger.js';
import { config, logConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { initDb, queryOne } from './db/db.js';
import { seed } from './db/seed.js';
import { addClient, broadcast } from './sse/broker.js';
import publicRoutes from './routes/public.js';
import paywalledRoutes from './routes/paywalled.js';
import dashboardRoutes from './routes/dashboard.js';
import profileRoutes from './routes/profile.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/api', publicRoutes);

// Paywalled routes
app.use('/api', paywalledRoutes);

// Dashboard routes (auth required)
app.use('/api', dashboardRoutes);

// Profile routes (public, for wallet-signed nickname updates)
app.use('/api', profileRoutes);

// SSE endpoints
app.get('/api/channels/:slug/stream/overlay', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const channel = await queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    addClient(res, slug, 'overlay');
  } catch (err) {
    next(err);
  }
});

app.get('/api/channels/:slug/stream/dashboard', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const channel = await queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    addClient(res, slug, 'dashboard');
  } catch (err) {
    next(err);
  }
});

// Test broadcast endpoint (temporary, for verification)
app.post('/api/channels/:slug/test-broadcast', (req, res) => {
  const { slug } = req.params;
  const { eventName, data } = req.body;
  broadcast(slug, eventName || 'test', data || { message: 'test' });
  res.json({ ok: true });
});

// Production: Serve static web dist
// __dirname in ESM with fileURLToPath is the dist folder when compiled
// From apps/api/dist, we need to go to apps/web/dist
const webDistPath = path.resolve(__dirname, '../../web/dist');
logger.debug(`Checking for web dist at: ${webDistPath}`);
if (existsSync(webDistPath)) {
  logger.info(`Serving static files from ${webDistPath}`);
  app.use(express.static(webDistPath));

  // SPA fallback - serve index.html for non-API routes
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api') || req.path === '/health') {
      next();
      return;
    }
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
} else {
  logger.info('Web dist not found, skipping static file serving (dev mode)');
}

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error('Unhandled error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal Server Error' });
  }
);

// Start server
async function bootstrap() {
  // Log configuration
  logConfig();

  // Initialize database and seed
  await initDb();
  await seed();

  app.listen(config.apiPort, () => {
    logger.info(`API server listening on port ${config.apiPort}`);
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', { message: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});

export { app };
