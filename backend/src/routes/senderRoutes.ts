import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { currentUserId, requireAuth, requireCsrf } from '../middleware/auth';
import { createSender, listSenders } from '../services/senderService';

export const senderRouter = Router();
senderRouter.use(requireAuth);

const customSmtpSchema = z.object({
  email: z.string().email(),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpUser: z.string().min(1),
  smtpPass: z.string().min(1),
});

senderRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ data: await listSenders(currentUserId(req)) });
  }),
);

// Empty body = create a new Ethereal test inbox. Full SMTP details = use that account instead.
senderRouter.post(
  '/',
  requireCsrf,
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const custom = Object.keys(body).length === 0 ? undefined : customSmtpSchema.parse(body);
    const sender = await createSender(currentUserId(req), custom);
    res.status(201).json({ data: sender });
  }),
);
