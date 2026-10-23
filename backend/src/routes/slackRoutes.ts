import { randomBytes } from 'crypto';
import { Router } from 'express';
import { config } from '../config';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/httpError';
import { safeEqual } from '../lib/safeEqual';
import { currentUserId, requireAuth, requireCsrf } from '../middleware/auth';
import { buildSlackAuthUrl, connectSlack, disconnectSlack, getSlackStatus } from '../services/slackService';

export const slackRouter = Router();
slackRouter.use(requireAuth);

slackRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json({ data: await getSlackStatus(currentUserId(req)) });
  }),
);

// Browser navigation (the "Connect Slack" button links here). Starts the real Slack OAuth flow.
slackRouter.get('/connect', (req, res, next) => {
  if (!config.slackEnabled) {
    throw new HttpError(503, 'slack_not_configured', 'Slack is not configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_REDIRECT_URL.');
  }
  const state = randomBytes(16).toString('hex');
  req.session.slackOauthState = state;
  req.session.save((error) => {
    if (error) return next(error);
    res.redirect(buildSlackAuthUrl(state));
  });
});

slackRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const back = (result: string) => res.redirect(`${config.FRONTEND_URL}/dashboard?slack=${result}`);
    try {
      const { code, state, error } = req.query;
      const expectedState = req.session.slackOauthState;
      delete req.session.slackOauthState; // a state value can only be used once

      if (error || typeof code !== 'string' || typeof state !== 'string' || !expectedState || !safeEqual(state, expectedState)) {
        return back('error');
      }
      await connectSlack(currentUserId(req), code);
      back('connected');
    } catch (error) {
      console.error('[slack] connect failed:', (error as Error).message);
      back('error');
    }
  }),
);

slackRouter.post(
  '/disconnect',
  requireCsrf,
  asyncHandler(async (req, res) => {
    await disconnectSlack(currentUserId(req));
    res.json({ data: { ok: true } });
  }),
);
