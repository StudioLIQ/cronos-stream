import express from 'express';
import cors from 'cors';
import { logger } from './logger.js';
import { getDb } from './db/db.js';

const PORT = parseInt(process.env.API_PORT || '3402', 10);

// Initialize database
getDb();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
app.listen(PORT, () => {
  logger.info(`API server listening on port ${PORT}`);
});

export { app };
