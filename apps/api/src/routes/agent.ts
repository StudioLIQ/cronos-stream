import { Router } from 'express';
import { queryOne, queryAll } from '../db/db.js';
import { planAgent } from '../agent/planner.js';

const router = Router();

interface ChannelRow {
  id: string;
}

interface ActionRow {
  actionKey: string;
  type: string;
}

interface MembershipPlanRow {
  id: string;
  name: string;
}

// POST /api/channels/:slug/agent/plan - Build an agent execution plan (no payment)
router.post('/channels/:slug/agent/plan', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const input = req.body?.input;
    const maxSteps = req.body?.maxSteps;

    if (typeof input !== 'string' || !input.trim()) {
      res.status(400).json({ error: 'Missing or invalid input' });
      return;
    }

    if (input.length > 1000) {
      res.status(400).json({ error: 'Input too long' });
      return;
    }

    const channel = await queryOne<ChannelRow>('SELECT id FROM channels WHERE slug = ?', [slug]);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const actions = await queryAll<ActionRow>(
      'SELECT actionKey, type FROM actions WHERE channelId = ? AND enabled = 1',
      [channel.id]
    );

    const membershipPlans = await queryAll<MembershipPlanRow>(
      'SELECT id, name FROM membership_plans WHERE channelId = ? AND enabled = 1',
      [channel.id]
    );

    const result = planAgent({
      input,
      actions,
      membershipPlans,
      maxSteps: typeof maxSteps === 'number' ? maxSteps : undefined,
    });

    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ ok: true, plan: result.plan });
  } catch (err) {
    next(err);
  }
});

export default router;

