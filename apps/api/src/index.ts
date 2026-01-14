import express from 'express';
import cors from 'cors';
import { logger } from './logger.js';
import { config, logConfig } from './config.js';
import { getDb, queryOne, queryAll } from './db/db.js';
import { seed } from './db/seed.js';
import { addClient, broadcast } from './sse/broker.js';

// Log configuration
logConfig();

// Initialize database and seed
getDb();
seed();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Temporary: Get actions for demo channel (will be replaced by proper routes in T3.1)
app.get('/api/channels/:slug/actions', (req, res) => {
  const { slug } = req.params;
  const channel = queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }
  const actions = queryAll<{ actionKey: string; type: string; priceBaseUnits: string; payloadJson: string }>(
    'SELECT actionKey, type, priceBaseUnits, payloadJson FROM actions WHERE channelId = ? AND enabled = 1',
    [channel.id]
  );
  res.json(actions.map(a => ({ ...a, payload: JSON.parse(a.payloadJson) })));
});

// SSE endpoints
app.get('/api/channels/:slug/stream/overlay', (req, res) => {
  const { slug } = req.params;
  const channel = queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }
  addClient(res, slug, 'overlay');
});

app.get('/api/channels/:slug/stream/dashboard', (req, res) => {
  const { slug } = req.params;
  const channel = queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }
  addClient(res, slug, 'dashboard');
});

// Test broadcast endpoint (temporary, for verification)
app.post('/api/channels/:slug/test-broadcast', (req, res) => {
  const { slug } = req.params;
  const { eventName, data } = req.body;
  broadcast(slug, eventName || 'test', data || { message: 'test' });
  res.json({ ok: true });
});

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
app.listen(config.apiPort, () => {
  logger.info(`API server listening on port ${config.apiPort}`);
});

export { app };
