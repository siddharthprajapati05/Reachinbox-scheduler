import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { safeEqual } from '../lib/safeEqual';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    googleOauthState?: string;
    slackOauthState?: string;
  }
}

// The user id ALWAYS comes from the server-side session, never from the request body or URL.
export function currentUserId(req: Request): string {
  return req.session.userId as string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Please log in' } });
    return;
  }
  next();
}

// CSRF protection for cookie-authenticated requests that change data.
// The frontend gets the token from GET /api/auth/me and sends it in the X-CSRF-Token header.
// A malicious website cannot read that token, so it cannot forge the header.
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const sent = req.header('x-csrf-token');
  const expected = req.session.csrfToken;
  if (!sent || !expected || !safeEqual(sent, expected)) {
    res.status(403).json({ error: { code: 'invalid_csrf_token', message: 'Missing or invalid CSRF token' } });
    return;
  }
  next();
}

// Only the emails listed in ADMIN_EMAILS may open Bull Board.
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.session.userId ? await prisma.user.findUnique({ where: { id: req.session.userId } }) : null;
    if (!user) {
      res.status(401).send(`Please log in first at ${config.FRONTEND_URL}/login`);
      return;
    }
    if (!config.adminEmails.includes(user.email.toLowerCase())) {
      res.status(403).send('Forbidden: your account is not listed in ADMIN_EMAILS');
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
