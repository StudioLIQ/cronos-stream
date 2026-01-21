import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { queryOne, execute } from '../db/db.js';
import { getChannelBySlug } from './public.js';

const router = Router();

const NONCE_EXPIRY_MINUTES = 10;
const DISPLAY_NAME_MIN_LENGTH = 2;
const DISPLAY_NAME_MAX_LENGTH = 20;

// Allowed characters: Korean, English, numbers, basic symbols
const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}\s._-]+$/u;

// Banned words (simplified, reuse from content policy)
const BANNED_WORDS = ['fuck', 'shit', 'ass', 'bitch', 'nigger', 'faggot'];

function generateNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

function nowUtcMysqlDatetime(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function validateDisplayName(name: string): { ok: true } | { ok: false; error: string } {
  if (name.length < DISPLAY_NAME_MIN_LENGTH || name.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, error: `Display name must be ${DISPLAY_NAME_MIN_LENGTH}-${DISPLAY_NAME_MAX_LENGTH} characters` };
  }

  if (!DISPLAY_NAME_PATTERN.test(name)) {
    return { ok: false, error: 'Display name contains invalid characters' };
  }

  const lowerName = name.toLowerCase();
  for (const word of BANNED_WORDS) {
    if (lowerName.includes(word)) {
      return { ok: false, error: 'Display name contains inappropriate content' };
    }
  }

  return { ok: true };
}

function verifySignature(message: string, signature: string, expectedAddress: string): boolean {
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

interface NonceRow {
  nonce: string;
  expiresAt: string;
  usedAt: string | null;
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

// POST /api/profile - Update global profile (wallet-signed)
router.post('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address, displayName, nonce, issuedAt, expiresAt, signature } = req.body;

    // Validate required fields
    if (!address || !displayName || !nonce || !issuedAt || !expiresAt || !signature) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const normalizedAddress = address.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/i.test(normalizedAddress)) {
      res.status(400).json({ error: 'Invalid address' });
      return;
    }

    // Validate display name
    const validation = validateDisplayName(displayName);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Check nonce exists and is not expired or used
    const nonceRow = await queryOne<NonceRow>(
      `SELECT nonce, expiresAt, usedAt FROM wallet_profile_nonces
       WHERE address = ? AND nonce = ?`,
      [normalizedAddress, nonce]
    );

    if (!nonceRow) {
      res.status(400).json({ error: 'Invalid nonce' });
      return;
    }

    if (nonceRow.usedAt) {
      res.status(400).json({ error: 'Nonce already used' });
      return;
    }

    const nonceExpiry = new Date(nonceRow.expiresAt);
    if (nonceExpiry < new Date()) {
      res.status(400).json({ error: 'Nonce expired' });
      return;
    }

    // Verify signature
    const message = `Stream402 Global Profile Update

Address: ${normalizedAddress}
Display Name: ${displayName}
Scope: global
Nonce: ${nonce}
Issued At: ${issuedAt}
Expires At: ${expiresAt}`;

    if (!verifySignature(message, signature, normalizedAddress)) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    // Mark nonce as used
    await execute(
      `UPDATE wallet_profile_nonces SET usedAt = ? WHERE address = ? AND nonce = ?`,
      [nowUtcMysqlDatetime(), normalizedAddress, nonce]
    );

    // Upsert profile
    await execute(
      `INSERT INTO wallet_profiles (address, displayName)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE displayName = VALUES(displayName), updatedAt = NOW()`,
      [normalizedAddress, displayName]
    );

    res.json({ ok: true, displayName });
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:slug/profile - Update channel profile override (wallet-signed)
router.post('/channels/:slug/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const { address, action, displayNameOverride, nonce, issuedAt, expiresAt, signature } = req.body;

    // Validate required fields
    if (!address || !action || !nonce || !issuedAt || !expiresAt || !signature) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (action !== 'set' && action !== 'clear') {
      res.status(400).json({ error: 'Invalid action. Must be "set" or "clear"' });
      return;
    }

    if (action === 'set' && !displayNameOverride) {
      res.status(400).json({ error: 'displayNameOverride required for action "set"' });
      return;
    }

    const normalizedAddress = address.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/i.test(normalizedAddress)) {
      res.status(400).json({ error: 'Invalid address' });
      return;
    }

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Validate display name if setting
    if (action === 'set') {
      const validation = validateDisplayName(displayNameOverride);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error });
        return;
      }
    }

    // Check nonce exists and is not expired or used
    const nonceRow = await queryOne<NonceRow>(
      `SELECT nonce, expiresAt, usedAt FROM channel_profile_nonces
       WHERE channelId = ? AND address = ? AND nonce = ?`,
      [channel.id, normalizedAddress, nonce]
    );

    if (!nonceRow) {
      res.status(400).json({ error: 'Invalid nonce' });
      return;
    }

    if (nonceRow.usedAt) {
      res.status(400).json({ error: 'Nonce already used' });
      return;
    }

    const nonceExpiry = new Date(nonceRow.expiresAt);
    if (nonceExpiry < new Date()) {
      res.status(400).json({ error: 'Nonce expired' });
      return;
    }

    // Verify signature
    const message = action === 'set'
      ? `Stream402 Channel Profile Update

Address: ${normalizedAddress}
Channel: ${slug}
Action: ${action}
Display Name Override: ${displayNameOverride}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expires At: ${expiresAt}`
      : `Stream402 Channel Profile Update

Address: ${normalizedAddress}
Channel: ${slug}
Action: ${action}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expires At: ${expiresAt}`;

    if (!verifySignature(message, signature, normalizedAddress)) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    // Mark nonce as used
    await execute(
      `UPDATE channel_profile_nonces SET usedAt = ? WHERE channelId = ? AND address = ? AND nonce = ?`,
      [nowUtcMysqlDatetime(), channel.id, normalizedAddress, nonce]
    );

    if (action === 'set') {
      // Upsert channel profile override
      await execute(
        `INSERT INTO channel_wallet_profiles (channelId, address, displayNameOverride)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE displayNameOverride = VALUES(displayNameOverride), updatedAt = NOW()`,
        [channel.id, normalizedAddress, displayNameOverride]
      );

      res.json({ ok: true, displayNameOverride });
    } else {
      // Clear channel profile override
      await execute(
        `DELETE FROM channel_wallet_profiles WHERE channelId = ? AND address = ?`,
        [channel.id, normalizedAddress]
      );

      res.json({ ok: true, cleared: true });
    }
  } catch (err) {
    next(err);
  }
});

// Helper function to get effective display name for an address
export async function getEffectiveDisplayName(
  channelId: string,
  address: string
): Promise<string | null> {
  // Check channel override first
  const channelProfile = await queryOne<{ displayNameOverride: string }>(
    'SELECT displayNameOverride FROM channel_wallet_profiles WHERE channelId = ? AND address = ?',
    [channelId, address.toLowerCase()]
  );

  if (channelProfile) {
    return channelProfile.displayNameOverride;
  }

  // Check global profile
  const globalProfile = await queryOne<{ displayName: string }>(
    'SELECT displayName FROM wallet_profiles WHERE address = ?',
    [address.toLowerCase()]
  );

  if (globalProfile) {
    return globalProfile.displayName;
  }

  // Return null (caller should fall back to shortened address)
  return null;
}

export default router;
