import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, conflict, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requireRole, type PermissionKey } from '../middleware/auth.js';

export const staffRoutes = Router();

/**
 * S26 — staff and their permissions. Owner-only, per rule 6.
 *
 * The nine keys here are the delegable powers. Payment verification is not
 * among them (ADR-007 — admin-only, and a database trigger enforces it
 * independently), and neither are settings, prices, staff management or the
 * audit log (rule 6 calls those owner-only). A checkbox that could grant any of
 * those would make the rule it contradicts false, so the absence is the design.
 */
const PERMISSION_KEYS = [
  'booking.manage',
  'tenancy.manage',
  'meter.record',
  'meter.correct',
  'invoice.generate',
  'payment.record',
  'reports.view',
  'request.manage',
  'announcement.send',
] as const satisfies readonly PermissionKey[];

/**
 * The seven role names from the design, as what they actually are: preset
 * tick-combinations. Choosing one ticks boxes; it does not create a type, and
 * the owner is free to un-tick anything afterwards.
 */
const PRESETS: Record<string, PermissionKey[]> = {
  'พนักงานต้อนรับ': ['booking.manage', 'tenancy.manage', 'payment.record', 'request.manage'],
  'พนักงานเก็บมิเตอร์': ['meter.record'],
  'พนักงานบัญชี': ['invoice.generate', 'payment.record', 'reports.view'],
  'ผู้จัดการ': [
    'booking.manage',
    'tenancy.manage',
    'meter.record',
    'meter.correct',
    'invoice.generate',
    'payment.record',
    'reports.view',
    'request.manage',
    'announcement.send',
  ],
  'แม่บ้าน': ['request.manage'],
  'ช่าง': ['request.manage'],
  'ผู้ช่วยเจ้าของ': ['reports.view', 'invoice.generate', 'announcement.send'],
};

staffRoutes.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const staff = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT u.id, u.name, u.phone, u.role, u.is_active, u.created_at,
             COALESCE(
               (SELECT json_agg(p.permission_key ORDER BY p.permission_key)
                FROM user_permissions p WHERE p.user_id = u.id),
               '[]'::json) AS permissions
      FROM users u
      ORDER BY u.role, u.name`;

    res.json({ staff, permission_keys: PERMISSION_KEYS, presets: PRESETS });
  }),
);

const createBody = z.object({
  name: z.string().trim().min(1, 'ต้องระบุชื่อ'),
  phone: z.string().trim().min(9, 'เบอร์โทรไม่ถูกต้อง'),
  password: z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร'),
  // Role is the audience (§5.3's worker shape, ADR-007's verifier), not the
  // permission set. Creating another admin is possible and deliberate: it is
  // the only way to have someone else verify payments.
  role: z.enum(['admin', 'staff', 'worker']).default('staff'),
  permissions: z.array(z.enum(PERMISSION_KEYS)).default([]),
});

staffRoutes.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ครบถ้วน');
    const { name, phone, password, role, permissions } = parsed.data;

    const hash = await bcrypt.hash(password, 10);

    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO users (name, phone, password_hash, role)
        VALUES (${name}, ${phone}, ${hash}, ${role})
        RETURNING id`;
      const id = rows[0]!.id;

      if (permissions.length > 0) {
        await prisma.$executeRaw`
          INSERT INTO user_permissions (user_id, permission_key, granted_by)
          SELECT ${id}::uuid, k, ${req.user!.id}::uuid FROM unnest(${permissions}::text[]) AS k`;
      }

      await prisma.$executeRaw`
        INSERT INTO audit_log (entity_type, entity_id, action, detail, actor_id)
        VALUES ('user', ${id}::uuid, 'staff_created',
                ${JSON.stringify({ name, phone, role, permissions })}::jsonb, ${req.user!.id}::uuid)`;

      res.status(201).json({ user: { id, name, phone, role, permissions } });
    } catch (err) {
      const mapped = fromDatabaseError(err, 'เบอร์นี้มีผู้ใช้อยู่แล้ว');
      throw mapped ?? err;
    }
  }),
);

const updateBody = z.object({
  name: z.string().trim().min(1).optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร').optional(),
});

/**
 * A staff member is deactivated, never deleted: `users.id` is referenced by
 * every invoice they generated, every reading they entered and every payment
 * they verified, and ON DELETE RESTRICT means those references are the record.
 */
staffRoutes.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');
    const u = parsed.data;

    // An owner who deactivates their own account cannot re-activate it: nobody
    // else can reach this endpoint.
    if (u.is_active === false && req.params.id === req.user!.id) {
      throw conflict('ปิดการใช้งานบัญชีตัวเองไม่ได้');
    }

    const hash = u.password ? await bcrypt.hash(u.password, 10) : null;

    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      UPDATE users
      SET name          = COALESCE(${u.name ?? null}, name),
          is_active     = COALESCE(${u.is_active ?? null}, is_active),
          password_hash = COALESCE(${hash}, password_hash)
      WHERE id = ${req.params.id}::uuid
      RETURNING id, name, phone, role, is_active`;

    if (!rows[0]) throw notFound('ไม่พบผู้ใช้นี้');

    await prisma.$executeRaw`
      INSERT INTO audit_log (entity_type, entity_id, action, detail, actor_id)
      VALUES ('user', ${req.params.id}::uuid, 'staff_updated',
              ${JSON.stringify({
                name: u.name,
                is_active: u.is_active,
                password_changed: Boolean(u.password),
              })}::jsonb, ${req.user!.id}::uuid)`;

    res.json({ user: rows[0] });
  }),
);

const permissionsBody = z.object({ permissions: z.array(z.enum(PERMISSION_KEYS)) });

/**
 * The tick list, replaced wholesale.
 *
 * Sent as the complete set rather than as add/remove operations: the screen is
 * a row of checkboxes, and "what is ticked now" is the only state anybody can
 * see. Diffing on the client would let two open tabs each re-grant what the
 * other removed.
 *
 * The change is written to `audit_log` with both sides — rule 6 makes this
 * owner-only, and who gained what access is exactly the question asked after
 * something goes wrong.
 */
staffRoutes.put(
  '/:id/permissions',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = permissionsBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('รายการสิทธิ์ไม่ถูกต้อง');
    const next = parsed.data.permissions;

    const userRows = await prisma.$queryRaw<{ id: string; role: string; name: string }[]>`
      SELECT id, role, name FROM users WHERE id = ${req.params.id}::uuid`;
    const target = userRows[0];
    if (!target) throw notFound('ไม่พบผู้ใช้นี้');
    // An admin already passes every permission check, so a tick list on one is
    // a lie the screen would then have to keep telling.
    if (target.role === 'admin') throw conflict('เจ้าของมีสิทธิ์ทั้งหมดอยู่แล้ว — ไม่ต้องติ๊กสิทธิ์');

    const before = await prisma.$queryRaw<{ permission_key: string }[]>`
      SELECT permission_key FROM user_permissions WHERE user_id = ${req.params.id}::uuid`;

    await prisma.$transaction([
      prisma.$executeRaw`DELETE FROM user_permissions WHERE user_id = ${req.params.id}::uuid`,
      prisma.$executeRaw`
        INSERT INTO user_permissions (user_id, permission_key, granted_by)
        SELECT ${req.params.id}::uuid, k, ${req.user!.id}::uuid FROM unnest(${next}::text[]) AS k`,
      prisma.$executeRaw`
        INSERT INTO audit_log (entity_type, entity_id, action, detail, actor_id)
        VALUES ('user', ${req.params.id}::uuid, 'permissions_changed',
                ${JSON.stringify({
                  name: target.name,
                  from: before.map((b) => b.permission_key).sort(),
                  to: [...next].sort(),
                })}::jsonb, ${req.user!.id}::uuid)`,
    ]);

    res.json({ user_id: req.params.id, permissions: next });
  }),
);
