-- ============================================================
-- Amanew — 002 Scope Delta
--
-- Source: AMANEW_MASTER_DOCUMENT.md §17.2, which lists the schema implications
-- of screens S26–S46 and states plainly that they are "not yet written into
-- §4/§5". 001 is therefore incomplete on its own.
--
-- WHAT THIS MIGRATION IS FOR: the subset of §17.2 that touches money and
-- identity on rows that will exist from day one. Adding these later means
-- migrating live contract data, which is why they are here and not deferred.
--
-- WHAT IS DELIBERATELY DEFERRED: cash_entries (S39), announcements +
-- announcement_reads (S41), requests (S42), notification_prefs (S38). All four
-- are new standalone tables with no foreign key pointing INTO the core money
-- model, so creating them later is additive and carries no migration risk.
-- They land with their own endpoints. See §17.2 for their shapes.
-- ============================================================

-- ------------------------------------------------------------
-- ROOM_TYPES — standard prices (S24; never-violate rule 11)
--
-- Prices live on the type, not the room. S24 is the only screen that sets
-- them; no screen types a price from scratch.
-- ------------------------------------------------------------
ALTER TABLE room_types
    ADD COLUMN type_key        TEXT,
    ADD COLUMN default_rent    NUMERIC(10,2),
    ADD COLUMN default_nightly NUMERIC(10,2),
    ADD COLUMN is_active       BOOLEAN NOT NULL DEFAULT TRUE;

-- Two types only, and their keys are the price axis (bed), not air conditioning.
-- Owner 2026-08-04: every room is a ห้องแอร์, so aircon distinguishes nothing.
ALTER TABLE room_types
    ADD CONSTRAINT room_types_type_key_check CHECK (type_key IN ('single', 'double'));
CREATE UNIQUE INDEX uq_room_types_key ON room_types (type_key);

-- ------------------------------------------------------------
-- ROOMS — per-room price override, with the visible flag rule 11 requires
--
-- NULL means "use the type's standard price". A non-NULL value is an override
-- and every screen showing it must show it AS an override.
-- ------------------------------------------------------------
ALTER TABLE rooms
    ADD COLUMN rent_override    NUMERIC(10,2),
    ADD COLUMN nightly_override NUMERIC(10,2);

-- ------------------------------------------------------------
-- TENANCIES — the frozen contract rent, the agreed term, and renewal linkage
--
-- monthly_rent (never-violate rule 2): frozen for the life of the contract.
--   §4 had no rent column at all, which left the frozen rent with nowhere to
--   live and would have forced every invoice to re-derive it from the room's
--   current price — exactly what rule 2 forbids. It is NOT NULL: a contract
--   without a rent is not a contract.
--
-- rent_overridden (rule 11): true when monthly_rent was set to something other
--   than the room's standard price at signing. Carried so the override stays
--   visible for the contract's life, not just at the moment of signing.
--
-- agreed_months (rule 12 / Rule 4.12, "ตกลงอยู่กี่เดือน"): what early
--   termination is measured against. Captured at signing, never derived.
--
-- previous_tenancy_id (rule 12 / Rule 4.8): renewal is a NEW tenancy row with
--   the deposit carried over — never an UPDATE extending the old one. This
--   column is the only thing linking the two, so renewal history is readable.
-- ------------------------------------------------------------
ALTER TABLE tenancies
    ADD COLUMN monthly_rent        NUMERIC(10,2) NOT NULL,
    ADD COLUMN rent_overridden     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN agreed_months       INTEGER NOT NULL,
    ADD COLUMN previous_tenancy_id UUID REFERENCES tenancies(id) ON DELETE RESTRICT;

ALTER TABLE tenancies
    ADD CONSTRAINT tenancies_agreed_months_check CHECK (agreed_months > 0),
    ADD CONSTRAINT tenancies_monthly_rent_check  CHECK (monthly_rent >= 0),
    -- A tenancy cannot be its own renewal.
    ADD CONSTRAINT tenancies_no_self_renewal     CHECK (previous_tenancy_id IS DISTINCT FROM id);

-- A tenancy may only be renewed once — two rows claiming the same predecessor
-- would make "which contract replaced this one" unanswerable.
CREATE UNIQUE INDEX uq_tenancies_one_renewal_per_tenancy
    ON tenancies (previous_tenancy_id)
    WHERE previous_tenancy_id IS NOT NULL;

-- ------------------------------------------------------------
-- BOOKINGS — มัดจำกุญแจ (never-violate rule 5)
--
-- The two deposit species are never merged. เงินประกัน is tenancies.deposit_amount
-- (monthly, at contract); มัดจำกุญแจ is this column (daily, at check-in).
-- Separate columns on separate tables is the strongest possible expression of
-- "never merged" — there is no query that can accidentally sum them.
-- ------------------------------------------------------------
ALTER TABLE bookings
    ADD COLUMN key_deposit          NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN key_deposit_refunded BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN rate_overridden      BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE bookings
    ADD CONSTRAINT bookings_key_deposit_check CHECK (key_deposit >= 0);

-- ------------------------------------------------------------
-- METER_READINGS — the room a reading belongs to (never-violate rule 13)
--
-- §4 keyed readings UNIQUE (tenancy_id, meter_type, reading_period). A room
-- transfer keeps the SAME tenancy, so a transfer month has two readings of the
-- same type in the same period — one per room — and §4's constraint rejects
-- the second. §17.2 flags this as "the single electric/water pair in §4 cannot
-- express it"; this is that fix.
--
-- room_id is nullable only so 001's existing rows (there are none in practice)
-- don't block the migration; the application always writes it.
-- ------------------------------------------------------------
ALTER TABLE meter_readings
    ADD COLUMN room_id UUID REFERENCES rooms(id) ON DELETE RESTRICT,
    -- Rule 9: a broken meter yields an estimated reading, flagged as ประมาณการ.
    ADD COLUMN is_estimated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE meter_readings
    DROP CONSTRAINT meter_readings_tenancy_id_meter_type_reading_period_key;

ALTER TABLE meter_readings
    ADD CONSTRAINT uq_meter_readings_period
        UNIQUE (tenancy_id, meter_type, reading_period, room_id);

CREATE INDEX idx_meter_readings_room ON meter_readings (room_id, reading_period);

-- ------------------------------------------------------------
-- TENANCY_ROOM_HISTORY — room transfers (never-violate rule 13)
--
-- Append-only, and joins ADR-006's revoke list below. The transfer keeps the
-- same contract and the same rent even into a pricier room type, so there is
-- deliberately no rent column here: a transfer that changed the rent would be
-- a rule 13 violation, and the schema should not offer a place to record one.
-- ------------------------------------------------------------
CREATE TABLE tenancy_room_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id      UUID NOT NULL REFERENCES tenancies(id) ON DELETE RESTRICT,
    from_room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    to_room_id      UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    transferred_on  DATE NOT NULL,
    reason          TEXT,
    transferred_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_room_id <> to_room_id)
);

CREATE INDEX idx_tenancy_room_history_tenancy ON tenancy_room_history (tenancy_id);

-- ------------------------------------------------------------
-- UTILITY_RATES — property-wide tariff (S24), effective-dated
--
-- Rates are frozen INTO each invoice at issue: meter_readings.rate already
-- captures the tariff per row, so changing a rate here is never retroactive.
-- This table is the source staff read when entering a new reading, not a
-- lookup that historical invoices join against.
-- ------------------------------------------------------------
CREATE TABLE utility_rates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meter_type     TEXT NOT NULL CHECK (meter_type IN ('water', 'electric')),
    rate           NUMERIC(10,4) NOT NULL CHECK (rate >= 0),
    effective_from DATE NOT NULL,
    created_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (meter_type, effective_from)
);

-- ------------------------------------------------------------
-- SYSTEM_SETTINGS — the policies S43 makes owner-editable
--
-- §17.4 item 1: due day, the ฿50/day late fee, cleaning fee, key deposit,
-- renewal lead time and the invoice message are all currently hardcoded in the
-- prototype. Key/value rather than a wide table because S43 renders them as a
-- list and the set grows; the application owns the type of each value.
-- ------------------------------------------------------------
CREATE TABLE system_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    value_type  TEXT NOT NULL CHECK (value_type IN ('int', 'money', 'text', 'bool')),
    updated_by  UUID REFERENCES users(id) ON DELETE RESTRICT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- AUDIT_LOG — what S45 reads back
--
-- §17.4 item 3: six screens promise "บันทึกในประวัติ" and nothing reads it.
-- Append-only, joins the revoke list. Deliberately generic: the specific
-- histories that carry enforcement (invoice_status_history,
-- meter_reading_corrections, room_type_changes) stay as their own tables —
-- this is the human-readable activity feed, not a replacement for them.
-- ------------------------------------------------------------
CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id   UUID,
    action      TEXT NOT NULL,
    detail      JSONB,
    actor_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_entity  ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC);

-- ------------------------------------------------------------
-- ADR-006: append-only enforcement.
--
-- §4 leaves these commented out pending a role name. They are active here
-- against the application role, which is the whole point of ADR-006 — these
-- tables are the compensating control for running without RLS, and a
-- commented-out REVOKE is not a control.
--
-- The role is created if absent so this migration is self-contained on a local
-- database; on Supabase, grant the application's role instead and keep the
-- REVOKEs. Note this does NOT bind the owner/superuser connection — Postgres
-- superusers bypass grants, so the application must never connect as one.
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amanew_app') THEN
        CREATE ROLE amanew_app NOLOGIN;
    END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amanew_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO amanew_app;

REVOKE UPDATE, DELETE ON invoice_status_history     FROM amanew_app;
REVOKE UPDATE, DELETE ON meter_reading_corrections  FROM amanew_app;
REVOKE UPDATE, DELETE ON room_type_changes          FROM amanew_app;
REVOKE UPDATE, DELETE ON guest_registrations        FROM amanew_app; -- Hotel Act data (ADR-006 amendment)
REVOKE UPDATE, DELETE ON tenancy_room_history       FROM amanew_app; -- added by this migration
REVOKE UPDATE, DELETE ON audit_log                  FROM amanew_app; -- added by this migration

-- NOTE (§6.2, BLOCKING pre-launch): guest_registrations is append-only with no
-- delete path for amanew_app, by design. The PDPA retention rule the owner has
-- not yet set will need a purge mechanism running OUTSIDE this role. Do not
-- solve it by granting DELETE here — that would undo ADR-006.
