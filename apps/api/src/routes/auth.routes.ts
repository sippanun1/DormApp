import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, unauthorized } from '../http/errors.js';
import { requireAuth, signToken, type Role } from '../middleware/auth.js';

export const authRoutes = Router();

// §5: "Rate-limit this endpoint (login brute-force is the most likely attack
// surface given 3 flat roles with no MFA in Phase 1)."
const loginLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MIN * 60_000,
  limit: env.LOGIN_RATE_LIMIT_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่' },
});

// Phone is the universal identifier — there is no email field anywhere.
const loginBody = z.object({
  phone: z.string().trim().min(9, 'เบอร์โทรไม่ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});

authRoutes.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ครบถ้วน');

    const user = await prisma.users.findUnique({ where: { phone: parsed.data.phone } });

    // Same message and same work either way — a distinct "no such user" reply
    // turns this endpoint into a phone-number oracle.
    const hash = user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(parsed.data.password, hash);
    if (!user || !ok || !user.is_active) throw unauthorized('เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง');

    const account = { id: user.id, name: user.name, role: user.role as Role };
    res.json({ token: signToken(account), user: account });
  }),
);

authRoutes.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
