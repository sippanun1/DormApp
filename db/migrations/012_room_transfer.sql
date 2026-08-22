-- ============================================================
-- Amanew — 012 Room transfer: the meter follows the room, not the contract
--
-- Never-violate rule 13 / Business Rules 10.1–10.4: a transfer keeps the SAME
-- contract with a new room number, the same rent even into a pricier room type,
-- the deposit carried, and the transfer month's bill carrying two utility
-- periods — the old room's closing and the new room's fresh start.
--
-- 002 already built most of the storage for this and it was never used:
-- `tenancy_room_history`, `meter_readings.room_id`, and the unique key
-- `(tenancy_id, meter_type, reading_period, room_id)` that lets one contract
-- hold two readings of the same meter type in one month. What was missing is
-- everything below.
--
-- **The bug this migration exists to prevent.** Every previous reading in the
-- system is derived by walking `tenancy_chain()` — correctly, because a renewal
-- is a new tenancy row and the meter on the wall did not restart (006). But
-- that walk has no room filter. The moment a contract spans two rooms, "the
-- last reading on this chain" is a reading of a DIFFERENT PHYSICAL METER, and
-- the new room's first bill would be computed against the old room's dial.
-- This is the same shape of fault 006 fixed for renewals, and it is why the
-- derivation moves into the database here rather than being patched at each of
-- the three call sites that perform it.
--
-- Requires 001, 002, 003, 006.
-- ============================================================

-- ------------------------------------------------------------
-- The opening read off the wall of the new room, on the day of the move
--
-- Not a `meter_readings` row: that table stores a CONSUMPTION — old and new
-- with `computed_cost` generated between them — and on transfer day the new
-- room has an opening and no closing yet. The closing arrives at the ordinary
-- month-end round, weeks later, and that round needs this number to subtract
-- from. Storing it as a half-filled reading would mean either a fake zero-usage
-- row that a later correction has to overwrite (polluting the S15 audit trail
-- with routine work) or a nullable `new_reading`, which would make
-- `computed_cost` nullable for every reading in the system.
--
-- NOT NULL because a transfer without them cannot be billed: the new room's
-- first invoice would have nothing to measure from. Added nullable and then
-- constrained, so that an existing row — there are none — would fail loudly
-- rather than silently become zero.
-- ------------------------------------------------------------
ALTER TABLE tenancy_room_history
    ADD COLUMN opening_electric NUMERIC(10,2),
    ADD COLUMN opening_water    NUMERIC(10,2);

ALTER TABLE tenancy_room_history
    ALTER COLUMN opening_electric SET NOT NULL,
    ALTER COLUMN opening_water    SET NOT NULL;

ALTER TABLE tenancy_room_history
    ADD CONSTRAINT tenancy_room_history_openings_check
        CHECK (opening_electric >= 0 AND opening_water >= 0);

-- One move per contract per day. Two rows for the same day would make "which
-- room were they in" unanswerable, and the second would silently win.
CREATE UNIQUE INDEX uq_tenancy_room_history_day
    ON tenancy_room_history (tenancy_id, transferred_on);

-- ------------------------------------------------------------
-- The previous reading, in one place
--
-- Three call sites derive this today — the entry endpoint, the batch sheet and
-- the move-out preview — and 006's reasoning applies again: three copies of a
-- rule about which meter is which is three chances for them to disagree.
--
-- Two sources, in order:
--
--   1. The last reading this CONTRACT CHAIN took ON THIS ROOM. The chain,
--      because a renewal did not restart the meter (006); the room, because a
--      transfer did.
--   2. Failing that, the opening read off the wall when they transferred in.
--      This is what makes the new room's first month measurable at all.
--
-- Returns NULL when neither exists, which is a genuine move-in: ADR-008 says
-- staff must then read the physical meter, and the caller asks them to.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION chain_previous_reading(
    target         UUID,
    mtype          TEXT,
    exclude_period DATE DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    WITH here AS (SELECT room_id FROM tenancies WHERE id = target),
         chain AS (SELECT tenancy_id FROM tenancy_chain(target))
    SELECT COALESCE(
        (SELECT mr.new_reading
         FROM meter_readings mr, here
         WHERE mr.tenancy_id IN (SELECT tenancy_id FROM chain)
           AND mr.meter_type = mtype
           AND mr.room_id = here.room_id
           AND (exclude_period IS NULL OR mr.reading_period <> exclude_period)
         ORDER BY mr.reading_period DESC, mr.entered_at DESC
         LIMIT 1),
        (SELECT CASE mtype WHEN 'electric' THEN h.opening_electric ELSE h.opening_water END
         FROM tenancy_room_history h, here
         WHERE h.tenancy_id IN (SELECT tenancy_id FROM chain)
           AND h.to_room_id = here.room_id
         ORDER BY h.transferred_on DESC, h.created_at DESC
         LIMIT 1)
    );
$$;

-- ------------------------------------------------------------
-- Every room the contract occupied during a billing period
--
-- A transfer month is not billable from the old room's meters alone. Without
-- this, `/invoices/ready` counts two meter types, calls the month complete and
-- issues a bill missing everything the tenant used in the room they now live
-- in — an under-charge that becomes permanent the moment a receipt exists.
--
-- The current room is always included: a contract is always somewhere.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenancy_rooms_in_period(target UUID, period DATE)
RETURNS TABLE (room_id UUID)
LANGUAGE sql STABLE AS $$
    SELECT t.room_id FROM tenancies t WHERE t.id = target
    UNION
    SELECT h.from_room_id
    FROM tenancy_room_history h
    WHERE h.tenancy_id = target
      AND h.transferred_on >= period
      AND h.transferred_on < (period + INTERVAL '1 month')::date;
$$;
