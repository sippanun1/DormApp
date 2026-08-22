import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, conflict, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { announcementNotice } from '../notify/emit.js';

export const announcementRoutes = Router();
export const requestRoutes = Router();

/**
 * S41 announcements and S42 requests — the two things the office sends and
 * receives that are not money.
 */

const announcementBody = z.object({
  title: z.string().trim().min(1, 'ต้องระบุหัวข้อประกาศ'),
  body: z.string().trim().min(1, 'ต้องระบุเนื้อหาประกาศ'),
  target_type: z.enum(['all', 'floor', 'room']),
  target_floors: z.array(z.number().int().min(1).max(4)).default([]),
  target_rooms: z.array(z.string().trim().min(1)).default([]),
  /** Rule 15: LINE is the optional copy. In-app is not a choice, so it is not a field. */
  send_line: z.boolean().default(false),
});

/**
 * Send an announcement.
 *
 * The recipient count is computed and returned but NOT stored: it is a fact
 * about today's occupancy, and the announcement is a fact about what was sent.
 * Storing it would make the row disagree with itself the moment somebody moves.
 */
announcementRoutes.post(
  '/',
  requireAuth,
  requirePermission('announcement.send'),
  asyncHandler(async (req, res) => {
    const parsed = announcementBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลประกาศไม่ครบถ้วน');
    const a = parsed.data;

    if (a.target_type === 'floor' && a.target_floors.length === 0) throw badRequest('เลือกอย่างน้อยหนึ่งชั้น');
    if (a.target_type === 'room' && a.target_rooms.length === 0) throw badRequest('เลือกอย่างน้อยหนึ่งห้อง');

    try {
      // Rule 15, finally true rather than merely claimed: until Phase 1 this
      // endpoint stored the announcement and told staff it had been delivered.
      // The in-app notice is now written in the same statement, one row per
      // tenant the targeting actually reaches, so "ส่งประกาศแล้ว" cannot be a
      // screen saying so with nothing behind it.
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        WITH sent AS (
          INSERT INTO announcements (title, body, target_type, target_floors, target_rooms, send_line, sent_by)
          VALUES (${a.title}, ${a.body}, ${a.target_type},
                  ${a.target_floors}::int[], ${a.target_rooms}::text[], ${a.send_line},
                  ${req.user!.id}::uuid)
          RETURNING id, title, body, target_type, target_floors, target_rooms, send_line, sent_at
        ), ${announcementNotice({
          tenant: Prisma.sql`occupant.tenant_id`,
          ref: Prisma.sql`sent.id`,
          title: Prisma.sql`sent.title`,
          body: Prisma.sql`sent.body`,
          // The tick on S41. Rule 15's shape: in-app has no checkbox because it
          // cannot be switched off, and this decides only whether the copy goes.
          sendLine: Prisma.sql`sent.send_line`,
          // The same matching the list endpoint below counts with, expanded to
          // the people in those rooms — monthly tenants and daily guests
          // alike, since both are `tenants` rows and both were sent it. The
          // expansion is NOT stored on the announcement (007's comment: a
          // floor announcement must still read "ชั้น 3" after everyone moves);
          // it is stored here, per person, which is where a record of who was
          // told belongs.
          from: Prisma.sql`FROM sent
            JOIN rooms r ON r.is_active
              AND (sent.target_type = 'all'
                   OR (sent.target_type = 'floor' AND LEFT(r.room_number, 1)::int = ANY (sent.target_floors))
                   OR (sent.target_type = 'room'  AND r.room_number = ANY (sent.target_rooms)))
            JOIN LATERAL (
              SELECT tn.tenant_id FROM tenancies tn WHERE tn.room_id = r.id AND tn.status = 'active'
              UNION
              SELECT b.tenant_id  FROM bookings b  WHERE b.room_id = r.id AND b.status = 'checked_in'
            ) occupant ON TRUE`,
        })}
        SELECT id, title, target_type, target_floors, target_rooms, send_line, sent_at FROM sent`;

      res.status(201).json({ announcement: rows[0] });
    } catch (err) {
      const mapped = fromDatabaseError(err, 'ส่งประกาศไม่สำเร็จ');
      throw mapped ?? err;
    }
  }),
);

/**
 * The list, with how many occupied rooms each one reached — computed on read
 * against today's occupancy, and labelled as such on the screen.
 */
announcementRoutes.get(
  '/',
  requireAuth,
  requirePermission('announcement.send'),
  asyncHandler(async (_req, res) => {
    const announcements = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT a.id, a.title, a.body, a.target_type, a.target_floors, a.target_rooms,
             a.send_line, a.sent_at, u.name AS sent_by_name,
             (SELECT COUNT(*)::int FROM rooms r
              WHERE r.is_active
                AND (a.target_type = 'all'
                     OR (a.target_type = 'floor' AND LEFT(r.room_number, 1)::int = ANY (a.target_floors))
                     OR (a.target_type = 'room'  AND r.room_number = ANY (a.target_rooms)))
                AND (EXISTS (SELECT 1 FROM tenancies tn WHERE tn.room_id = r.id AND tn.status = 'active')
                     OR EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id AND b.status = 'checked_in'))
             ) AS occupied_rooms_now
      FROM announcements a
      JOIN users u ON u.id = a.sent_by
      ORDER BY a.sent_at DESC
      LIMIT 100`;

    res.json({ announcements });
  }),
);

/** Owner-only: an announcement is a thing that was said, and unsaying it is a decision. */
announcementRoutes.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      DELETE FROM announcements WHERE id = ${req.params.id}::uuid RETURNING id`;
    if (!rows[0]) throw notFound('ไม่พบประกาศนี้');
    res.json({ deleted: rows[0].id });
  }),
);

const requestBody = z.object({
  room_id: z.string().uuid(),
  request_type: z.enum(['repair', 'cleaning', 'moveout', 'renewal'], {
    errorMap: () => ({ message: 'ต้องระบุประเภทเรื่องที่แจ้ง' }),
  }),
  detail: z.string().trim().min(1, 'ต้องระบุรายละเอียด'),
});

/**
 * Record a request (S42).
 *
 * Created by the office, not by a tenant: tenants have no login in Phase 1
 * (§5), so in practice somebody phones the desk and staff type it. The tenant
 * is resolved from the room's active tenancy rather than asked for — the desk
 * knows the room, and looking the person up again invites picking the wrong one.
 */
requestRoutes.post(
  '/',
  requireAuth,
  requirePermission('request.manage'),
  asyncHandler(async (req, res) => {
    const parsed = requestBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ครบถ้วน');

    try {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        INSERT INTO requests (room_id, tenant_id, request_type, detail, reported_by)
        SELECT ${parsed.data.room_id}::uuid,
               (SELECT tn.tenant_id FROM tenancies tn
                WHERE tn.room_id = ${parsed.data.room_id}::uuid AND tn.status = 'active' LIMIT 1),
               ${parsed.data.request_type}, ${parsed.data.detail}, ${req.user!.id}::uuid
        RETURNING id, room_id, request_type, status, reported_at`;

      res.status(201).json({ request: rows[0] });
    } catch (err) {
      const mapped = fromDatabaseError(err, 'บันทึกเรื่องแจ้งไม่สำเร็จ');
      throw mapped ?? err;
    }
  }),
);

requestRoutes.get(
  '/',
  requireAuth,
  requirePermission('request.manage'),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;

    const requests = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT q.id, q.request_type, q.detail, q.status, q.assigned_to, q.note,
              q.reported_at, q.resolved_at,
              r.room_number, t.full_name AS tenant_name, u.name AS reported_by_name,
              -- Hours waiting, in Bangkok. The queue is sorted by age and the
              -- badge is the point of the screen, so this must not drift by
              -- seven hours the way a naive date cast would.
              (EXTRACT(EPOCH FROM (now() - q.reported_at)) / 3600)::int AS hours_waiting
       FROM requests q
       JOIN rooms r ON r.id = q.room_id
       LEFT JOIN tenants t ON t.id = q.tenant_id
       JOIN users u ON u.id = q.reported_by
       WHERE ($1::text IS NULL OR q.status = $1::text)
       ORDER BY (q.status = 'resolved'), q.reported_at`,
      status,
    );

    res.json({
      requests,
      open_count: requests.filter((r) => r.status !== 'resolved').length,
    });
  }),
);

const updateBody = z.object({
  status: z.enum(['reported', 'assigned', 'in_progress', 'blocked', 'resolved']).optional(),
  /** Free text: the ช่าง named here has no account and never will (rule 14). */
  assigned_to: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().nullable().optional(),
});

/**
 * Move a request along.
 *
 * Business Rule 11.1: there is no separate "verified/closed" state — resolved
 * is the end. `resolved_at` is set and cleared by the same statement that moves
 * the status, so the CHECK constraint tying them together can never be the
 * thing that fails.
 */
requestRoutes.patch(
  '/:id',
  requireAuth,
  requirePermission('request.manage'),
  asyncHandler(async (req, res) => {
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('ข้อมูลไม่ถูกต้อง');
    const u = parsed.data;
    if (u.status === undefined && u.assigned_to === undefined && u.note === undefined) {
      throw badRequest('ไม่มีข้อมูลที่จะแก้ไข');
    }

    try {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        UPDATE requests
        SET status      = COALESCE(${u.status ?? null}, status),
            assigned_to = CASE WHEN ${u.assigned_to !== undefined} THEN ${u.assigned_to ?? null} ELSE assigned_to END,
            note        = CASE WHEN ${u.note !== undefined} THEN ${u.note ?? null} ELSE note END,
            resolved_at = CASE
                            WHEN COALESCE(${u.status ?? null}, status) = 'resolved'
                              THEN COALESCE(resolved_at, now())
                            ELSE NULL
                          END
        WHERE id = ${req.params.id}::uuid
        RETURNING id, status, assigned_to, note, resolved_at`;

      if (!rows[0]) throw notFound('ไม่พบเรื่องแจ้งนี้');
      res.json({ request: rows[0] });
    } catch (err) {
      const mapped = fromDatabaseError(err, 'อัปเดตสถานะไม่สำเร็จ');
      throw mapped ?? err;
    }
  }),
);

/** Owner-only, and only while nothing has been done to it. */
requestRoutes.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      DELETE FROM requests
      WHERE id = ${req.params.id}::uuid AND status = 'reported'
      RETURNING id`;
    if (!rows[0]) throw conflict('ลบไม่ได้ — เรื่องนี้ถูกมอบหมายหรือดำเนินการไปแล้ว');
    res.json({ deleted: rows[0].id });
  }),
);
