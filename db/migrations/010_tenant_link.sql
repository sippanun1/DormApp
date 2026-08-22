-- ============================================================
-- Amanew — 010 Tenant identity: how a tenant proves who they are
--
-- Phase 2 of docs/LINE_INTEGRATION_PLAN.md. 009 built the record that a tenant
-- was told something; this is what lets that tenant come and read it.
--
-- The identity proof is a STAFF-ISSUED CODE handed over at the desk (owner
-- decision 2026-08-17). No SMS provider, no per-message cost, and the thing
-- being trusted is a person at the counter rather than possession of a phone
-- number — which matters here because `tenants.phone` is the universal
-- identifier printed on every bill, and would otherwise be the whole secret.
--
-- What this migration deliberately does NOT add:
--
--   * No `tenants.password_hash`. CLAUDE.md's "tenant login is phone +
--     password" convention was written for the prototype and never had a
--     column behind it; the plan replaced it with this. A password is a
--     credential the office would end up resetting by phone, which is the same
--     trust as the code with worse storage.
--   * No refresh-token table. A tenant session is re-obtainable from the
--     office, and the sessions here are long enough that it rarely is.
--
-- Requires 001, 002, 003, 009.
-- ============================================================

-- ------------------------------------------------------------
-- TENANT_LINK_CODES
--
-- Single-use, short-lived, and issued by a named staff member — so "who let
-- this device in" is answerable later. That is why `issued_by` is RESTRICT and
-- NOT NULL: a code with no issuer is an unattributable grant of access to a
-- tenant's bills.
-- ------------------------------------------------------------
CREATE TABLE tenant_link_codes (
    code        TEXT PRIMARY KEY CHECK (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    issued_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,

    -- Written only when the code is redeemed from inside LINE (Phase 3).
    -- Redeeming in a browser leaves it NULL, which is a linked tenant with no
    -- LINE account — a state the sender must handle anyway (rule 15: LINE is a
    -- copy, never the record).
    used_by_line_user_id TEXT,

    -- A used code has a moment it was used. Without this, `used_at IS NULL`
    -- and "unused" could drift apart and the single-use check would be a lie.
    CHECK (used_by_line_user_id IS NULL OR used_at IS NOT NULL),
    CHECK (expires_at > created_at)
);

-- The redeem path looks a code up by primary key. This index is for the other
-- question — "does this tenant already have a code waiting?" — which the staff
-- screen asks every time it renders, to avoid printing a second one.
CREATE INDEX idx_tenant_link_codes_live ON tenant_link_codes (tenant_id, expires_at DESC)
    WHERE used_at IS NULL;

-- ------------------------------------------------------------
-- One LINE account, one tenant
--
-- `tenants.line_user_id` has existed since 001:88, nullable and never written.
-- This is the migration that finally writes it, so it is also the first moment
-- the column can be wrong: without this index, one LINE account could redeem
-- codes for two tenants and would then receive both their bills.
--
-- Partial, because NULL means "no LINE account" and must stay repeatable
-- across all 60 rooms.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX uq_tenants_line_user ON tenants (line_user_id)
    WHERE line_user_id IS NOT NULL;
