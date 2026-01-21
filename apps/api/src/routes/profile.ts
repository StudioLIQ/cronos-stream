import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { queryOne, execute } from '../db/db.js';
import { getChannelBySlug } from './public.js';

const router = Router();

const NONCE_EXPIRY_MINUTES = 10;

function generateNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

function nowUtcMysqlDatetime(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

// GET /api/profile/nonce - Get a nonce for global profile update
router.get('/profile/nonce', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = (req.query.address as string)?.toLowerCase();

    if (!address || !/^0x[a-f0-9]{40}$/i.test(address)) {
      res.status(400).json({ error: 'Missing or invalid address parameter' });
      return;
    }

    const nonce = generateNonce();
    const now = new Date();
    const expiresAt = addMinutes(now, NONCE_EXPIRY_MINUTES);

    await execute(
      `INSERT INTO wallet_profile_nonces (address, nonce, expiresAt)
       VALUES (?, ?, ?)`,
      [address, nonce, expiresAt.toISOString().slice(0, 19).replace('T', ' ')]
    );

    res.json({
      nonce,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/profile/nonce - Get a nonce for channel profile override
router.get('/channels/:slug/profile/nonce', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const address = (req.query.address as string)?.toLowerCase();

    if (!address || !/^0x[a-f0-9]{40}$/i.test(address)) {
      res.status(400).json({ error: 'Missing or invalid address parameter' });
      return;
    }

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const nonce = generateNonce();
    const now = new Date();
    const expiresAt = addMinutes(now, NONCE_EXPIRY_MINUTES);

    await execute(
      `INSERT INTO channel_profile_nonces (channelId, address, nonce, expiresAt)
       VALUES (?, ?, ?, ?)`,
      [channel.id, address, nonce, expiresAt.toISOString().slice(0, 19).replace('T', ' ')]
    );

    res.json({
      nonce,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
