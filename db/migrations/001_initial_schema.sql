-- ============================================================
-- Amanew Smart Management System — 001 Initial Schema
--
-- Source: AMANEW_MASTER_DOCUMENT.md §4, transcribed as written.
-- Every constraint traces back to an Accepted ADR.
--
-- IMPORTANT: this migration is deliberately a faithful copy of §4 so it can be
-- diffed against the Master Document line by line. §4 predates the S26–S46
-- scope delta and is INCOMPLETE ON ITS OWN — most visibly, `tenancies` has no
-- rent column, so never-violate rule 2 (contract rent frozen for the life of
-- the contract) has nowhere to live. 002_scope_delta.sql closes that and the
-- rest of §17.2. Never run 001 without 002.
-- ============================================================

-- Required for EXCLUDE constraint using daterange overlap (ADR-002)
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ------------------------------------------------------------
-- USERS  (ADR-007, ADR-010)
-- ------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    phone           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'worker')), -- ADR-010: TEXT+CHECK, not ENUM
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- BUILDINGS
-- ------------------------------------------------------------
CREATE TABLE buildings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    address     TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- ROOM_TYPES
-- ------------------------------------------------------------
CREATE TABLE room_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_th     TEXT NOT NULL,
    name_en     TEXT NOT NULL,
    bed_type    TEXT NOT NULL
);

-- ------------------------------------------------------------
-- ROOMS  (ADR-001: strictly monthly or daily)
-- ------------------------------------------------------------
CREATE TABLE rooms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id     UUID NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
    room_type_id    UUID NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
    room_number     TEXT NOT NULL,
    rental_type     TEXT NOT NULL CHECK (rental_type IN ('monthly', 'daily')), -- ADR-001, ADR-010
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (building_id, room_number)
);

-- ------------------------------------------------------------
-- ROOM_TYPE_CHANGES  (ADR-004: append-only log)
-- ------------------------------------------------------------
CREATE TABLE room_type_changes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    old_type    TEXT NOT NULL,
    new_type    TEXT NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);

-- ------------------------------------------------------------
-- TENANTS  (ADR-013: shared identity across tenancies and bookings)
-- ------------------------------------------------------------
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       TEXT NOT NULL,
    phone           TEXT NOT NULL UNIQUE,
    date_of_birth   DATE,       -- nullable; not collected at every check-in
    national_id     TEXT,       -- nullable; see §6.2 (retention — BLOCKING pre-launch, see PROGRESS.md)
    guardian_name   TEXT,       -- nullable; for student tenants (ADR-017)
    guardian_phone  TEXT,       -- nullable (ADR-017)
    line_user_id    TEXT,       -- nullable; LINE Notify (Phase 2) / LINE Login (Phase 3), ADR-017
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- TENANCIES  (ADR-002, ADR-012, ADR-013)
-- NOTE: extended by 002 — §4 has no rent, no agreed term, no renewal link.
-- ------------------------------------------------------------
CREATE TABLE tenancies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    start_date      DATE NOT NULL,
    end_date        DATE,
    deposit_amount  NUMERIC(10,2) NOT NULL DEFAULT 0, -- เงินประกัน only (rule 5), never มัดจำกุญแจ
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    created_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date IS NULL OR end_date >= start_date)
);

-- ADR-002: only one active tenancy per room at a time
CREATE UNIQUE INDEX uq_tenancies_one_active_per_room
    ON tenancies (room_id)
    WHERE status = 'active';

-- ------------------------------------------------------------
-- BOOKINGS  (ADR-002: EXCLUDE constraint prevents daily overlap)
-- ------------------------------------------------------------
CREATE TABLE bookings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, -- ADR-013
    check_in_date   DATE NOT NULL,
    check_out_date  DATE NOT NULL,
    nightly_rate    NUMERIC(10,2) NOT NULL,
    status          TEXT NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
    created_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (check_out_date > check_in_date),

    -- ADR-002: no two active bookings on the same room may share overlapping dates.
    -- cancelled/no_show bookings are excluded from the conflict check.
    EXCLUDE USING gist (
        room_id WITH =,
        daterange(check_in_date, check_out_date, '[)') WITH &&
    ) WHERE (status IN ('confirmed', 'checked_in'))
);

-- ------------------------------------------------------------
-- GUEST_REGISTRATIONS  (ADR-011: Hotel Act data capture, daily bookings only)
-- ------------------------------------------------------------
CREATE TABLE guest_registrations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id          UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
    guest_nationality   TEXT NOT NULL,
    guest_id_type       TEXT NOT NULL CHECK (guest_id_type IN ('thai_id', 'passport', 'driving_license')),
    guest_id_number     TEXT NOT NULL,
    guest_address       TEXT NOT NULL,
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- METER_READINGS  (ADR-008: uniqueness + continuity)
-- NOTE: 002 adds room_id — the UNIQUE below cannot express a transfer month
-- (rule 13), where one tenancy bills two rooms in the same period.
-- ------------------------------------------------------------
CREATE TABLE meter_readings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id      UUID NOT NULL REFERENCES tenancies(id) ON DELETE RESTRICT,
    meter_type      TEXT NOT NULL CHECK (meter_type IN ('water', 'electric')), -- ADR-015
    reading_period  DATE NOT NULL, -- first day of the billing month
    old_reading     NUMERIC(10,2) NOT NULL,
    new_reading     NUMERIC(10,2) NOT NULL,
    rate            NUMERIC(10,4) NOT NULL, -- captured per-row: computed_cost is frozen against later tariff changes
    computed_cost   NUMERIC(10,2) GENERATED ALWAYS AS ((new_reading - old_reading) * rate) STORED,
    entered_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    entered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (new_reading >= old_reading),
    UNIQUE (tenancy_id, meter_type, reading_period) -- ADR-008, ADR-015; replaced in 002
);

-- ------------------------------------------------------------
-- METER_READING_CORRECTIONS  (ADR-006: append-only)
-- ------------------------------------------------------------
CREATE TABLE meter_reading_corrections (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meter_reading_id        UUID NOT NULL REFERENCES meter_readings(id) ON DELETE RESTRICT,
    corrected_old_reading   NUMERIC(10,2) NOT NULL,
    corrected_new_reading   NUMERIC(10,2) NOT NULL,
    reason                  TEXT NOT NULL,
    corrected_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    corrected_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- INVOICE NUMBER SEQUENCE  (ADR-003)
-- ------------------------------------------------------------
CREATE SEQUENCE invoice_number_seq START 1;

-- ------------------------------------------------------------
-- INVOICES  (ADR-003, ADR-005, ADR-009)
-- ------------------------------------------------------------
CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number  BIGINT NOT NULL UNIQUE DEFAULT nextval('invoice_number_seq'), -- ADR-003
    tenancy_id      UUID NOT NULL REFERENCES tenancies(id) ON DELETE RESTRICT,
    billing_period  DATE NOT NULL,
    room_charge     NUMERIC(10,2) NOT NULL DEFAULT 0,
    utility_charge  NUMERIC(10,2) NOT NULL DEFAULT 0,
    other_charges   NUMERIC(10,2) NOT NULL DEFAULT 0,
    late_fee_frozen NUMERIC(10,2), -- ADR-009: NULL until payment submitted; frozen thereafter
    total_amount    NUMERIC(10,2) NOT NULL,
    due_date        DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'unpaid'
                    CHECK (status IN ('unpaid', 'pending_verification', 'paid', 'rejected')),
    generated_by    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenancy_id, billing_period)
);

-- ADR-005: invoices are immutable once issued — block edits to financial fields.
CREATE OR REPLACE FUNCTION block_invoice_amount_edit() RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.room_charge, NEW.utility_charge, NEW.other_charges, NEW.total_amount)
       IS DISTINCT FROM
       (OLD.room_charge, OLD.utility_charge, OLD.other_charges, OLD.total_amount) THEN
        RAISE EXCEPTION 'Invoices are immutable: create an adjustment entry instead of editing invoice %', OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_invoice_amount_edit
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION block_invoice_amount_edit();

-- ------------------------------------------------------------
-- INVOICE_STATUS_HISTORY  (ADR-006: append-only)
-- ------------------------------------------------------------
CREATE TABLE invoice_status_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    old_status  TEXT NOT NULL,
    new_status  TEXT NOT NULL,
    reason      TEXT, -- required in application layer when new_status = 'rejected'
    changed_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- PAYMENTS  (ADR-007: Admin-only verification)
-- ------------------------------------------------------------
CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount          NUMERIC(10,2) NOT NULL,
    payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer', 'qr')),
    slip_file_url   TEXT,
    submitted_by    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_by     UUID REFERENCES users(id) ON DELETE RESTRICT,
    verified_at     TIMESTAMPTZ,
    CHECK (verified_by IS NULL OR verified_at IS NOT NULL)
);

-- ADR-007: enforce Admin-only verification at the database level as a backstop
-- to the Express-layer permission check (defense in depth, since RLS is off).
CREATE OR REPLACE FUNCTION enforce_admin_verification() RETURNS TRIGGER AS $$
DECLARE
    verifier_role TEXT;
BEGIN
    IF NEW.verified_by IS NOT NULL AND (OLD.verified_by IS NULL) THEN
        SELECT role INTO verifier_role FROM users WHERE id = NEW.verified_by;
        IF verifier_role IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION 'Only admin users may verify payments';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_admin_verification
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION enforce_admin_verification();

-- ------------------------------------------------------------
-- Indexes for Phase 1 dashboard/query patterns
-- ------------------------------------------------------------
CREATE INDEX idx_rooms_building ON rooms (building_id);
CREATE INDEX idx_tenancies_room ON tenancies (room_id);
CREATE INDEX idx_bookings_room ON bookings (room_id);
CREATE INDEX idx_bookings_dates ON bookings (check_in_date, check_out_date);
CREATE INDEX idx_meter_readings_tenancy ON meter_readings (tenancy_id);
CREATE INDEX idx_meter_readings_lookup ON meter_readings (tenancy_id, reading_period, meter_type); -- ADR-015
CREATE INDEX idx_invoices_tenancy ON invoices (tenancy_id);
CREATE INDEX idx_invoices_status ON invoices (status);
CREATE INDEX idx_payments_invoice ON payments (invoice_id);

-- Indexes for tenant identity lookups (ADR-013)
CREATE INDEX idx_tenancies_tenant ON tenancies (tenant_id);
CREATE INDEX idx_bookings_tenant ON bookings (tenant_id);

-- ------------------------------------------------------------
-- ADR-006: the trigger that guards rental_type changes.
-- Defined last: it references tenancies and bookings, which must already exist.
-- (§4 lists it immediately after room_type_changes, which would fail on a
--  clean database — the only ordering correction 001 makes to §4.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_room_type_change() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.rental_type IS DISTINCT FROM OLD.rental_type THEN
        IF EXISTS (
            SELECT 1 FROM tenancies
            WHERE room_id = OLD.id AND status = 'active'
        ) THEN
            RAISE EXCEPTION 'Cannot change rental_type: room % has an active tenancy', OLD.id;
        END IF;
        IF EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = OLD.id
              AND status IN ('confirmed', 'checked_in')
              AND check_out_date >= CURRENT_DATE
        ) THEN
            RAISE EXCEPTION 'Cannot change rental_type: room % has a future/active booking', OLD.id;
        END IF;

        -- Log the change (append-only)
        INSERT INTO room_type_changes (room_id, old_type, new_type, changed_by)
        VALUES (OLD.id, OLD.rental_type, NEW.rental_type, current_setting('app.current_user_id', true)::UUID);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_room_type_change
    BEFORE UPDATE ON rooms
    FOR EACH ROW
    EXECUTE FUNCTION guard_room_type_change();
