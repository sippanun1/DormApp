-- ============================================================
-- Amanew — 007 Announcements (S41) and requests (S42)
--
-- Both tables were deliberately deferred in 002: standalone, no FK into the
-- money model, additive whenever their endpoints landed. This is that moment.
--
-- Requires 001, 002, 003.
-- ============================================================

-- ------------------------------------------------------------
-- ANNOUNCEMENTS (S41)
--
-- Never-violate rule 15: the in-app notification is the record and cannot be
-- switched off — Rule 6.13 makes it the proof a tenant was told. LINE is an
-- optional COPY carrying amount and due date only, never slips or personal
-- data. So there is no `in_app` column to set false: it is not a channel
-- choice, it is what an announcement IS. `send_line` is the only channel flag,
-- and a tenant with no LINE still receives everything.
--
-- Targeting is stored as what the sender chose, not as an expanded list of
-- rooms. A floor announcement sent in July still reads "ชั้น 3" a year later
-- even though the rooms on that floor now hold different people — expanding it
-- at send time would rewrite history every time somebody moved.
-- ------------------------------------------------------------
CREATE TABLE announcements (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         TEXT NOT NULL CHECK (length(trim(title)) > 0),
    body          TEXT NOT NULL CHECK (length(trim(body)) > 0),

    target_type   TEXT NOT NULL CHECK (target_type IN ('all', 'floor', 'room')),
    -- Floors as integers, rooms as room numbers. Empty for 'all'.
    target_floors INTEGER[] NOT NULL DEFAULT '{}',
    target_rooms  TEXT[]    NOT NULL DEFAULT '{}',
    CHECK (target_type <> 'floor' OR array_length(target_floors, 1) > 0),
    CHECK (target_type <> 'room'  OR array_length(target_rooms,  1) > 0),

    -- Rule 15: the optional copy. In-app is not represented because it is not
    -- optional.
    send_line     BOOLEAN NOT NULL DEFAULT FALSE,

    sent_by       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_sent_at ON announcements (sent_at DESC);

-- Read receipts (the prototype's "อ่านแล้ว 21/24") are NOT here. They need a
-- tenant who can log in, and tenant self-service is outside Phase 1 (§5). The
-- table is additive when that arrives: announcement_id + tenant_id + read_at.

-- ------------------------------------------------------------
-- REQUESTS (S42)
--
-- Owner decision 2026-07-31 (never-violate rule 14): hired technicians have no
-- account and workers have no phone screens. The office moves the status by
-- hand, `assigned_to` is free text — the ช่าง it names may not be a user of
-- this system at all — and there are no parts and no costs anywhere on this
-- table. A repair's cost is recorded wherever the owner records money, not
-- here.
--
-- `blocked` is a status, not a type: it is what the office sets after the ช่าง
-- phones in. A type would need a sender, and the person it describes cannot
-- log in.
-- ------------------------------------------------------------
CREATE TABLE requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id      UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    -- Nullable: a checkout cleaning job has no tenant behind it, and a request
    -- from a room whose tenant has left still has to be finishable.
    tenant_id    UUID REFERENCES tenants(id) ON DELETE RESTRICT,

    request_type TEXT NOT NULL CHECK (request_type IN ('repair', 'cleaning', 'moveout', 'renewal')),
    detail       TEXT NOT NULL CHECK (length(trim(detail)) > 0),

    status       TEXT NOT NULL DEFAULT 'reported'
                 CHECK (status IN ('reported', 'assigned', 'in_progress', 'blocked', 'resolved')),
    assigned_to  TEXT,
    -- What the ช่าง told the office by phone. Text, because it is hearsay until
    -- somebody records the actual money somewhere that owns money.
    note         TEXT,

    reported_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    -- A resolved request must say when, and an unresolved one must not pretend.
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE INDEX idx_requests_status ON requests (status, reported_at);
CREATE INDEX idx_requests_room ON requests (room_id);

-- ------------------------------------------------------------
-- Neither table is append-only: an announcement can be deleted before anyone
-- acts on it, and a request's status is meant to move. They are deliberately
-- absent from the ADR-006 REVOKE list — nothing here is a record of money or
-- of a legal obligation.
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON announcements TO amanew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON requests TO amanew_app;
