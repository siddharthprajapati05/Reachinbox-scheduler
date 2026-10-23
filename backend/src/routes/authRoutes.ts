import { randomBytes } from 'crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { prisma } from '../db';
import { asyncHandler } from '../lib/asyncHandler';
import { safeEqual } from '../lib/safeEqual';
import { currentUserId, requireAuth, requireCsrf } from '../middleware/auth';

export const authRouter = Router();

const googleClient = new OAuth2Client(
  config.GOOGLE_CLIENT_ID,
  config.GOOGLE_CLIENT_SECRET,
  `${config.BACKEND_URL}/api/auth/google/callback`,
);

// Step 1: send the browser to Google. "state" is a random value we check on the way back (blocks login CSRF).
authRouter.get('/google', (req, res, next) => {
  const state = randomBytes(16).toString('hex');
  req.session.googleOauthState = state;
  req.session.save((error) => {
    if (error) return next(error);
    res.redirect(
      googleClient.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'select_account' }),
    );
  });
});

// Step 2: Google sends the browser back here with ?code=...&state=...
authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const fail = () => res.redirect(`${config.FRONTEND_URL}/login?error=login_failed`);
    try {
      const { code, state } = req.query;
      const expectedState = req.session.googleOauthState;
      if (typeof code !== 'string' || typeof state !== 'string' || !expectedState || !safeEqual(state, expectedState)) {
        return fail();
      }

      const { tokens } = await googleClient.getToken(code);
      if (!tokens.id_token) return fail();
      // verifyIdToken checks Google's signature and that the token was issued for OUR client id.
      const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID });
      const profile = ticket.getPayload();
      if (!profile?.sub || !profile.email || !profile.email_verified) return fail();

      const profileData = { email: profile.email, name: profile.name ?? profile.email, avatarUrl: profile.picture ?? null };
      const user = await prisma.user.upsert({
        where: { googleId: profile.sub },
        update: profileData,
        create: { googleId: profile.sub, ...profileData },
      });

      // New session id after login (prevents session fixation) plus a fresh CSRF token.
      req.session.regenerate((error) => {
        if (error) return fail();
        req.session.userId = user.id;
        req.session.csrfToken = randomBytes(32).toString('hex');
        req.session.save(() => res.redirect(`${config.FRONTEND_URL}/dashboard`));
      });
    } catch (error) {
      console.error('[auth] Google login failed:', (error as Error).message);
      fail();
    }
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: currentUserId(req) } });
    if (!user) {
      req.session.destroy(() => undefined);
      res.status(401).json({ error: { code: 'unauthorized', message: 'Please log in' } });
      return;
    }
    res.json({
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          isAdmin: config.adminEmails.includes(user.email.toLowerCase()),
        },
        csrfToken: req.session.csrfToken,
      },
    });
  }),
);

authRouter.post('/logout', requireAuth, requireCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ data: { ok: true } });
  });
});
