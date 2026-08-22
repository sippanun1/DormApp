import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, conflict, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';

export const tenanciesRoutes = Router();

const createBody = z.object({
  room_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  start_date: z.string().date(),
  // Rule 12 / Rule 4.12 "ตกลงอยู่กี่เดือน" — captured at signing, never derived,
  // because it is what early termination is measured against.
  agreed_months: z.number().int().positive({ message: 'ต้องระบุจำนวนเดือนที่ตกลงกัน' }),
  deposit_amount: z.number().min(0).default(0),
  // Absent means the room type's standard rent. Rule 11: no price is typed
  // from scratch, only overridden — and an override is always flagged.
  monthly_rent: z.number().min(0).optional(),
  // Rule 12 / Rule 4.8: a renewal is a NEW tenancy carrying the old deposit,
  // never an extension of the old row.
  previous_tenancy_id: z.string().uuid().optional(),
});

/**
 * POST /tenancies — the monthly move-in (S08).
 *
 * As with bookings, the "is this room already taken" question belongs to the
 * database: `uq_tenancies_one_active_per_room` is a partial unique index, and
 * two simultaneous walk-in check-ins race past any application-level check.
 * We insert and translate the rejection.
 */
tenanciesRoutes.post(
  '/',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ครบถ้วน');
    const { room_id, tenant_id, start_date, agreed_months, deposit_amount, monthly_rent, previous_tenancy_id } =
      parsed.data;

    const roomRows = await prisma.$queryRaw<
      { id: string; room_number: string; rental_type: string; standard_rent: string }[]
    >`SELECT r.id, r.room_number, r.rental_type,
             COALESCE(r.rent_override, rt.default_rent) AS standard_rent
      FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
      WHERE r.id = ${room_id}::uuid AND r.is_active`;

    const room = roomRows[0];
    if (!room) throw notFound('ไม่พบห้องนี้');
    if (room.rental_type !== 'monthly') {
      throw conflict(`ห้อง ${room.room_number} เป็นห้องรายวัน ไม่สามารถทำสัญญารายเดือนได้`);
    }

    const standard = Number(room.standard_rent);
    const rent = monthly_rent ?? standard;
    const overridden = rent !== standard;

    try {
      const rows = await prisma.$queryRaw<
        { id: string; monthly_rent: string; rent_overridden: boolean; agreed_months: number }[]
      >`INSERT INTO tenancies (room_id, tenant_id, start_date, deposit_amount,
                               monthly_rent, rent_overridden, agreed_months,
                               previous_tenancy_id, created_by)
        VALUES (${room_id}::uuid, ${tenant_id}::uuid, ${start_date}::date, ${deposit_amount},
                ${rent}, ${overridden}, ${agreed_months},
                ${previous_tenancy_id ?? null}::uuid, ${req.user!.id}::uuid)
        RETURNING id, monthly_rent, rent_overridden, agreed_months`;

      res.status(201).json({ tenancy: rows[0] });
    } catch (err) {
      const mapped = fromDatabaseError(err, `ห้อง ${room.room_number} มีผู้เช่าอยู่แล้ว`);
      throw mapped ?? err;
    }
  }),
);

/**
 * End a tenancy (move-out). The deposit settlement itself is S27 and Week 7's
 * work — this only closes the contract so the room frees up, which the partial
 * unique index keys off `status = 'active'`.
 */
const endBody = z.object({ end_date: z.string().date().optional() });

tenanciesRoutes.post(
  '/:id/end',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const parsed = endBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('วันที่ไม่ถูกต้อง');

    try {
      const rows = await prisma.$queryRaw<{ id: string; status: string; end_date: Date }[]>`
        UPDATE tenancies
        SET status = 'ended',
            -- Same floor as the settlement path: a renewal signed in advance is
            -- active before it starts, and a contract cannot end before it began.
            end_date = GREATEST(start_date,
                                COALESCE(${parsed.data.end_date ?? null}::date, bangkok_today()))
        WHERE id = ${req.params.id}::uuid AND status = 'active'
        RETURNING id, status, end_date`;

      if (!rows[0]) throw conflict('ปิดสัญญาไม่ได้ — สัญญานี้สิ้นสุดไปแล้ว');
      res.json({ tenancy: rows[0] });
    } catch (err) {
      // CHECK (end_date >= start_date) — a move-out cannot precede the move-in.
      const mapped = fromDatabaseError(err, 'วันที่สิ้นสุดต้องไม่ก่อนวันเริ่มสัญญา');
      throw mapped ?? err;
    }
  }),
);


/**
 * S35 — renewal preview.
 *
 * Rule 4.8 / rule 12: renewing is signing a NEW contract, not extending the old
 * row. What carries across is the deposit and nothing else; what is decided
 * again is the rent and the agreed term. Both numbers are shown here — the
 * contract's own rent and the room's standard price today — because a renewal
 * is exactly the moment when the two are allowed to differ and the owner has to
 * choose deliberately.
 */
tenanciesRoutes.get(
  '/:id/renewal',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT tn.id, tn.status, tn.start_date, tn.agreed_months,
             tn.monthly_rent::float8 AS monthly_rent,
             tn.deposit_amount::float8 AS deposit_amount,
             r.id AS room_id, r.room_number, rt.name_th AS room_type_label,
             t.id AS tenant_id, t.full_name AS tenant_name, t.phone AS tenant_phone,
             COALESCE(r.rent_override, rt.default_rent)::float8 AS standard_rent,
             (tn.start_date + (tn.agreed_months || ' months')::interval)::date AS ends_on,
             ((tn.start_date + (tn.agreed_months || ' months')::interval)::date - bangkok_today()) AS days_left,
             -- uq_tenancies_one_renewal_per_tenancy: a contract can be renewed
             -- once. If it already was, this screen shows the successor rather
             -- than offering to create a second one.
             (SELECT json_build_object('id', n.id, 'start_date', n.start_date,
                                       'agreed_months', n.agreed_months,
                                       'monthly_rent', n.monthly_rent::float8)
              FROM tenancies n WHERE n.previous_tenancy_id = tn.id) AS renewed_into,
             (SELECT json_build_object('id', p.id, 'start_date', p.start_date)
              FROM tenancies p WHERE p.id = tn.previous_tenancy_id) AS renewed_from
      FROM tenancies tn
      JOIN rooms r ON r.id = tn.room_id
      JOIN room_types rt ON rt.id = r.room_type_id
      JOIN tenants t ON t.id = tn.tenant_id
      WHERE tn.id = ${req.params.id}::uuid`;

    const tenancy = rows[0];
    if (!tenancy) throw notFound('ไม่พบสัญญานี้');

    // Unpaid bills do not block a renewal — they follow the tenant, not the
    // contract row — but the owner should see them before signing again.
    const outstanding = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM invoices
      WHERE tenancy_id = ${req.params.id}::uuid AND status <> 'paid'`;

    res.json({ tenancy, outstanding_invoices: Number(outstanding[0]?.count ?? 0) });
  }),
);

const renewBody = z.object({
  /** Defaults to the day after the current contract's agreed end. */
  start_date: z.string().date().optional(),
  agreed_months: z.number().int().positive({ message: 'ต้องระบุจำนวนเดือนที่ตกลงกัน' }),
  /** Defaults to the current contract's rent — not the room's standard price. */
  monthly_rent: z.number().min(0).optional(),
});

/**
 * POST /tenancies/:id/renew — close the old contract, open its successor.
 *
 * Two rows, linked by previous_tenancy_id, and never one row with a later end
 * date: the old contract's rent, term and deposit stay exactly as they were
 * signed, which is what makes a renewal auditable a year later (rule 4.8).
 *
 * The deposit is carried, not re-collected: the tenant hands over nothing at a
 * renewal, and เงินประกัน stays the same money it always was (rule 5).
 *
 * Sequential inside one transaction rather than a single CTE statement: the
 * partial unique index allows one active tenancy per room, and an INSERT in the
 * same command as the closing UPDATE cannot see that update — it would collide
 * with the row it is replacing.
 */
tenanciesRoutes.post(
  '/:id/renew',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const parsed = renewBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลต่อสัญญาไม่ครบถ้วน');
    const { agreed_months } = parsed.data;

    const currentRows = await prisma.$queryRaw<
      {
        id: string; status: string; room_id: string; tenant_id: string;
        monthly_rent: string; deposit_amount: string; standard_rent: string;
        ends_on: Date; already_renewed: boolean;
      }[]
    >`SELECT tn.id, tn.status, tn.room_id, tn.tenant_id, tn.monthly_rent, tn.deposit_amount,
             COALESCE(r.rent_override, rt.default_rent) AS standard_rent,
             (tn.start_date + (tn.agreed_months || ' months')::interval)::date AS ends_on,
             EXISTS (SELECT 1 FROM tenancies n WHERE n.previous_tenancy_id = tn.id) AS already_renewed
      FROM tenancies tn
      JOIN rooms r ON r.id = tn.room_id
      JOIN room_types rt ON rt.id = r.room_type_id
      WHERE tn.id = ${req.params.id}::uuid`;

    const current = currentRows[0];
    if (!current) throw notFound('ไม่พบสัญญานี้');
    if (current.status !== 'active') throw conflict('สัญญานี้ปิดไปแล้ว — ต่อสัญญาไม่ได้');
    if (current.already_renewed) throw conflict('สัญญานี้ต่อสัญญาไปแล้ว');

    const endsOn = current.ends_on.toISOString().slice(0, 10);
    const startDate = parsed.data.start_date ?? new Date(current.ends_on.getTime() + 86_400_000).toISOString().slice(0, 10);
    if (startDate <= endsOn) {
      // Overlapping contracts on one room would be refused by the index anyway;
      // saying why is more useful than surfacing a constraint violation.
      throw badRequest(`สัญญาใหม่ต้องเริ่มหลังวันสิ้นสุดสัญญาเดิม (${endsOn})`);
    }

    // Rule 2 does not travel: the OLD contract's rent was frozen for its life,
    // and the new one starts at whatever is agreed now. Defaulting to the old
    // rent rather than the room's current price keeps a renewal from quietly
    // raising the rent when nobody discussed it.
    const rent = parsed.data.monthly_rent ?? Number(current.monthly_rent);
    const overridden = rent !== Number(current.standard_rent);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const closed = await tx.$queryRaw<{ id: string }[]>`
          UPDATE tenancies SET status = 'ended', end_date = ${endsOn}::date
          WHERE id = ${current.id}::uuid AND status = 'active'
          RETURNING id`;
        if (!closed[0]) throw conflict('สัญญานี้ถูกปิดไปแล้ว');

        const rows = await tx.$queryRaw<Record<string, unknown>[]>`
          INSERT INTO tenancies (room_id, tenant_id, start_date, deposit_amount,
                                 monthly_rent, rent_overridden, agreed_months,
                                 previous_tenancy_id, created_by)
          VALUES (${current.room_id}::uuid, ${current.tenant_id}::uuid, ${startDate}::date,
                  ${current.deposit_amount}, ${rent}, ${overridden}, ${agreed_months},
                  ${current.id}::uuid, ${req.user!.id}::uuid)
          RETURNING id, start_date, agreed_months,
                    monthly_rent::float8 AS monthly_rent, rent_overridden,
                    deposit_amount::float8 AS deposit_amount, previous_tenancy_id`;
        return rows[0];
      });

      res.status(201).json({ tenancy: created, previous_ended_on: endsOn, deposit_carried: true });
    } catch (err) {
      const mapped = fromDatabaseError(err, 'ต่อสัญญาไม่สำเร็จ — ห้องนี้มีสัญญาที่ทับซ้อนกันอยู่');
      throw mapped ?? err;
    }
  }),
);

/**
 * One contract, with its renewal chain.
 *
 * `monthly_rent` is read from the tenancy row and never recomputed from the
 * room's current price — rule 2 freezes it for the life of the contract, and
 * re-deriving it here is exactly the mistake that rule exists to prevent.
 */
tenanciesRoutes.get(
  '/:id',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT t.id, t.start_date, t.end_date, t.status, t.deposit_amount,
             t.monthly_rent, t.rent_overridden, t.agreed_months, t.previous_tenancy_id,
             r.room_number, rt.name_th AS room_type_label,
             ten.id AS tenant_id, ten.full_name AS tenant_name, ten.phone AS tenant_phone,
             (SELECT COALESCE(r2.rent_override, rt2.default_rent)
              FROM rooms r2 JOIN room_types rt2 ON rt2.id = r2.room_type_id
              WHERE r2.id = t.room_id) AS room_current_price
      FROM tenancies t
      JOIN rooms r ON r.id = t.room_id
      JOIN room_types rt ON rt.id = r.room_type_id
      JOIN tenants ten ON ten.id = t.tenant_id
      WHERE t.id = ${req.params.id}::uuid`;

    const tenancy = rows[0];
    if (!tenancy) throw notFound('ไม่พบสัญญานี้');

    // Surfaced so a screen can show "ราคาห้องปัจจุบัน ฿5,000 · สัญญานี้ ฿4,500"
    // as history rather than as an error. It is never a reason to change the rent.
    res.json({ tenancy });
  }),
);

// ---------------------------------------------------------------------------
// S37 — ย้ายห้อง, room transfer
// ---------------------------------------------------------------------------

const transferBody = z.object({
  to_room_id: z.string().uuid(),
  transferred_on: z.string().date(),
  reason: z.string().trim().max(500).optional(),
  /** What the OLD room's meters read as the tenant handed the key back. */
  closing_electric: z.number().min(0),
  closing_water: z.number().min(0),
  /** What the NEW room's meters read as they took it on. */
  opening_electric: z.number().min(0),
  opening_water: z.number().min(0),
  /**
   * Only for a transfer inside the move-in month, when the old room has no
   * reading to measure the closing against yet. ADR-008: an opening value comes
   * off the physical meter and is never derived.
   */
  from_opening_electric: z.number().min(0).optional(),
  from_opening_water: z.number().min(0).optional(),
  /** Acknowledges that the new room's meter ran on after the last occupant left. */
  confirm_opening: z.boolean().optional(),
});

const METER_TH = { electric: 'ไฟ', water: 'น้ำ' } as const;
type MeterType = keyof typeof METER_TH;

/**
 * Move a tenant to another room, keeping the contract (never-violate rule 13,
 * Business Rules 10.1–10.4).
 *
 * What this deliberately does NOT do:
 *
 *   * **It does not touch `monthly_rent`.** Rule 13 says the rent follows the
 *     contract even into a pricier room type, so there is no code path here
 *     that could change it — and `tenancy_room_history` has no rent column for
 *     the same reason (002). The response reports whether the room TYPE
 *     changed, so the screen can say so out loud; the number does not move.
 *   * **It does not touch the deposit.** It carries because it is a column on
 *     the contract and the contract is the same row.
 *   * **It does not end and re-create the tenancy.** That would be a renewal
 *     (Rule 4.8), would restart the meter chain, and would break the agreed
 *     term the early-termination rule is measured against (rule 12).
 *   * **It does not notify the tenant.** The owner's event list (2026-08-17)
 *     covers bills, payments and announcements; a transfer is arranged face to
 *     face with the person it concerns. Inventing an eighth event here would
 *     put it on LINE by way of `LINE_CARRIES` without anyone deciding to.
 *
 * The old room's final reading is written HERE rather than left for the
 * month-end round: the tenant is standing in the room today and will not be in
 * three weeks. The new room's opening is stored on the history row (012) and
 * becomes the number the month-end round measures from.
 */
tenanciesRoutes.post(
  '/:id/transfer',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const parsed = transferBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลการย้ายห้องไม่ครบถ้วน');
    const b = parsed.data;
    const tenancyId = String(req.params.id);

    const rows = await prisma.$queryRaw<
      {
        id: string;
        status: string;
        start_date: Date;
        room_id: string;
        from_room_number: string;
        from_type_key: string;
        tenant_name: string;
        in_future: boolean;
        before_start: boolean;
      }[]
    >`
      SELECT tn.id, tn.status, tn.start_date, tn.room_id,
             r.room_number AS from_room_number, rt.type_key AS from_type_key,
             t.full_name AS tenant_name,
             (${b.transferred_on}::date > bangkok_today()) AS in_future,
             (${b.transferred_on}::date < tn.start_date) AS before_start
      FROM tenancies tn
      JOIN rooms r ON r.id = tn.room_id
      JOIN room_types rt ON rt.id = r.room_type_id
      JOIN tenants t ON t.id = tn.tenant_id
      WHERE tn.id = ${tenancyId}::uuid`;
    const tn = rows[0];
    if (!tn) throw notFound('ไม่พบสัญญานี้');
    if (tn.status !== 'active') throw conflict('สัญญานี้สิ้นสุดแล้ว — ย้ายห้องไม่ได้');
    if (tn.room_id === b.to_room_id) throw badRequest('ห้องปลายทางเป็นห้องเดิม');
    // bangkok_today(), not the server's date: the pooler is UTC for seven hours
    // a day, and a same-day transfer would be rejected as "in the future".
    if (tn.in_future) throw badRequest('ย้ายห้องล่วงหน้าไม่ได้ — บันทึกเมื่อย้ายจริง');
    if (tn.before_start) throw badRequest('วันที่ย้ายก่อนวันเริ่มสัญญา');

    const toRows = await prisma.$queryRaw<
      { id: string; room_number: string; rental_type: string; type_key: string; occupied: boolean }[]
    >`
      SELECT r.id, r.room_number, r.rental_type, rt.type_key,
             EXISTS (SELECT 1 FROM tenancies o WHERE o.room_id = r.id AND o.status = 'active') AS occupied
      FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
      WHERE r.id = ${b.to_room_id}::uuid AND r.is_active`;
    const to = toRows[0];
    if (!to) throw notFound('ไม่พบห้องปลายทาง');
    if (to.rental_type !== 'monthly') {
      throw conflict(`ห้อง ${to.room_number} เป็นห้องรายวัน — ย้ายสัญญารายเดือนเข้าไม่ได้`);
    }
    if (to.occupied) throw conflict(`ห้อง ${to.room_number} มีผู้เช่าอยู่แล้ว`);

    // The transfer month. Both rooms' readings belong to the same billing
    // period — that is what puts two utility periods on one invoice (Rule 10.3).
    const period = b.transferred_on.slice(0, 8) + '01';

    const closing: Record<MeterType, number> = {
      electric: b.closing_electric,
      water: b.closing_water,
    };
    const openings: Record<MeterType, number> = {
      electric: b.opening_electric,
      water: b.opening_water,
    };
    const typedFromOpening: Record<MeterType, number | undefined> = {
      electric: b.from_opening_electric,
      water: b.from_opening_water,
    };

    const resolvedOld: Record<MeterType, number> = { electric: 0, water: 0 };

    for (const meter of ['electric', 'water'] as const) {
      const label = METER_TH[meter];

      // The old room's own previous reading, through 012's function so this
      // agrees exactly with what the meter sheet shows and the entry endpoint
      // would accept.
      const prevRows = await prisma.$queryRaw<{ previous: string | null }[]>`
        SELECT chain_previous_reading(${tenancyId}::uuid, ${meter}) AS previous`;
      const previous = prevRows[0]?.previous ?? null;

      if (previous !== null) {
        resolvedOld[meter] = Number(previous);
      } else {
        // Transferring inside the move-in month: nothing has been read in the
        // old room yet, so the value it started at has to come off the meter.
        const typed = typedFromOpening[meter];
        if (typed === undefined) {
          throw badRequest(
            `ห้อง ${tn.from_room_number} ยังไม่เคยจดมิเตอร์${label} — ` +
              `ต้องกรอกเลขเริ่มต้นตอนเข้าอยู่ โดยอ่านจากหน้ามิเตอร์จริง`,
          );
        }
        resolvedOld[meter] = typed;
      }

      if (closing[meter] < resolvedOld[meter]) {
        throw badRequest(
          `เลขปิดมิเตอร์${label}ของห้อง ${tn.from_room_number} (${closing[meter]}) ` +
            `น้อยกว่าเลขครั้งก่อน (${resolvedOld[meter]})`,
        );
      }

      // The new room's opening, against whoever lived there last — the same two
      // checks the meter endpoint applies at move-in, because it is the same
      // physical situation: a dial that has been running without a tenant.
      const priorRows = await prisma.$queryRaw<{ new_reading: string }[]>`
        SELECT mr.new_reading FROM meter_readings mr
        WHERE mr.room_id = ${b.to_room_id}::uuid AND mr.meter_type = ${meter}
        ORDER BY mr.reading_period DESC, mr.entered_at DESC LIMIT 1`;
      const priorClose = priorRows[0] ? Number(priorRows[0].new_reading) : undefined;

      if (priorClose !== undefined) {
        if (openings[meter] < priorClose) {
          throw conflict(
            `เลขเริ่มต้นมิเตอร์${label}ของห้อง ${to.room_number} (${openings[meter]}) ` +
              `ต่ำกว่าเลขปิดของผู้เช่าคนก่อน (${priorClose}) — ตรวจสอบก่อนบันทึก`,
          );
        }
        if (openings[meter] > priorClose && !b.confirm_opening) {
          throw conflict(
            `เลขเริ่มต้นมิเตอร์${label}ของห้อง ${to.room_number} (${openings[meter]}) ` +
              `ไม่ตรงกับเลขปิดของผู้เช่าคนก่อน (${priorClose}) — ` +
              `ต่างกัน ${openings[meter] - priorClose} หน่วย กรุณายืนยัน`,
          );
        }
      }
    }

    // The month's meters may already have been walked before the move. That
    // collides with 002's UNIQUE (tenancy_id, meter_type, reading_period,
    // room_id), and without this the generic mapper below would report it as
    // "ห้องมีผู้เช่าอยู่แล้ว" — the wrong problem, on the wrong room.
    const already = await prisma.$queryRaw<{ meter_type: string }[]>`
      SELECT meter_type FROM meter_readings
      WHERE tenancy_id = ${tenancyId}::uuid
        AND room_id = ${tn.room_id}::uuid
        AND reading_period = ${period}::date`;
    if (already.length > 0) {
      const which = already.map((a) => METER_TH[a.meter_type as MeterType] ?? a.meter_type).join(' และ ');
      throw conflict(
        `ห้อง ${tn.from_room_number} จดมิเตอร์${which}ของงวดนี้ไว้แล้ว — ` +
          `แก้ไขเลขที่บันทึกไว้ก่อน แล้วจึงย้ายห้อง`,
      );
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // The old room's final bill line. Written with the OLD room_id, which
        // is what lets the transfer month hold two readings of one meter type
        // under 002's UNIQUE (tenancy_id, meter_type, reading_period, room_id).
        await tx.$executeRaw`
          INSERT INTO meter_readings (tenancy_id, room_id, meter_type, reading_period,
                                      old_reading, new_reading, rate, entered_by)
          SELECT ${tenancyId}::uuid, ${tn.room_id}::uuid, e.meter_type, ${period}::date,
                 e.old_reading, e.new_reading,
                 (SELECT ur.rate FROM utility_rates ur
                   WHERE ur.meter_type = e.meter_type AND ur.effective_from <= ${period}::date
                   ORDER BY ur.effective_from DESC LIMIT 1),
                 ${req.user!.id}::uuid
          FROM unnest(
                 ARRAY['electric','water']::text[],
                 ARRAY[${resolvedOld.electric}, ${resolvedOld.water}]::numeric[],
                 ARRAY[${closing.electric}, ${closing.water}]::numeric[]
               ) AS e(meter_type, old_reading, new_reading)`;

        await tx.$executeRaw`
          INSERT INTO tenancy_room_history (tenancy_id, from_room_id, to_room_id, transferred_on,
                                            reason, transferred_by,
                                            opening_electric, opening_water)
          VALUES (${tenancyId}::uuid, ${tn.room_id}::uuid, ${b.to_room_id}::uuid,
                  ${b.transferred_on}::date, ${b.reason ?? null}, ${req.user!.id}::uuid,
                  ${openings.electric}, ${openings.water})`;

        // The contract does not change. Only where it is.
        const moved = await tx.$queryRaw<{ id: string; room_id: string; monthly_rent: string }[]>`
          UPDATE tenancies SET room_id = ${b.to_room_id}::uuid
          WHERE id = ${tenancyId}::uuid AND status = 'active'
          RETURNING id, room_id, monthly_rent`;
        if (!moved[0]) throw conflict('สัญญานี้สิ้นสุดแล้ว — ย้ายห้องไม่ได้');

        await tx.$executeRaw`
          INSERT INTO audit_log (entity_type, entity_id, action, detail, actor_id)
          VALUES ('tenancy', ${tenancyId}::uuid, 'room_transferred',
                  ${JSON.stringify({
                    tenant: tn.tenant_name,
                    from_room: tn.from_room_number,
                    to_room: to.room_number,
                    transferred_on: b.transferred_on,
                    room_type_changed: tn.from_type_key !== to.type_key,
                    reason: b.reason ?? null,
                  })}::jsonb,
                  ${req.user!.id}::uuid)`;

        return moved[0];
      });

      res.status(201).json({
        transfer: {
          tenancy_id: result.id,
          from_room: tn.from_room_number,
          to_room: to.room_number,
          transferred_on: b.transferred_on,
          billing_period: period,
          // Rule 13, said out loud rather than left for the reader to notice:
          // the type may differ and the rent still does not.
          room_type_changed: tn.from_type_key !== to.type_key,
          monthly_rent: Number(result.monthly_rent),
        },
      });
    } catch (err) {
      // The partial unique index on (room_id) WHERE status = 'active' is the
      // real guard against two contracts in one room — the EXISTS check above
      // can lose a race with a concurrent move-in.
      const mapped = fromDatabaseError(err, `ห้อง ${to.room_number} มีผู้เช่าอยู่แล้ว`);
      throw mapped ?? err;
    }
  }),
);

/**
 * What S37 needs before it can ask anything (rule 9: previous auto-filled and
 * locked, never typed).
 *
 * `previous_electric` / `previous_water` are NULL when the contract has no
 * reading in its current room yet — a transfer inside the move-in month. The
 * screen then asks for the opening value instead of pre-filling, and the POST
 * requires it: ADR-008 says an opening comes off the physical meter.
 */
tenanciesRoutes.get(
  '/:id/transfer-preview',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT tn.id AS tenancy_id, tn.status, tn.start_date,
             tn.monthly_rent::float8 AS monthly_rent,
             tn.deposit_amount::float8 AS deposit_amount,
             tn.agreed_months,
             r.id AS from_room_id, r.room_number AS from_room_number,
             rt.type_key AS from_type_key, rt.name_th AS from_type_label,
             t.full_name AS tenant_name, t.phone AS tenant_phone,
             chain_previous_reading(tn.id, 'electric')::float8 AS previous_electric,
             chain_previous_reading(tn.id, 'water')::float8 AS previous_water,
             bangkok_today() AS today
      FROM tenancies tn
      JOIN rooms r ON r.id = tn.room_id
      JOIN room_types rt ON rt.id = r.room_type_id
      JOIN tenants t ON t.id = tn.tenant_id
      WHERE tn.id = ${String(req.params.id)}::uuid`;
    if (!rows[0]) throw notFound('ไม่พบสัญญานี้');
    res.json({ preview: rows[0] });
  }),
);
