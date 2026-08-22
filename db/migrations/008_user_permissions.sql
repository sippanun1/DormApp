-- ============================================================
-- Amanew — 008 Per-person permissions (S26)
--
-- Never-violate rule 6: permissions are per-person checkboxes, and the seven
-- role names in the design are preset tick-combinations — not types. The
-- Master Document originally froze "3 roles only"; that was reconciled with the
-- owner on 2026-07-31 in favour of the checkboxes, and this table is that
-- decision in the schema.
--
-- `users.role` STAYS, and is not redundant. Two things depend on it that a
-- checkbox cannot safely express:
--
--   * ADR-007's `trg_enforce_admin_verification` reads `users.role` directly.
--     Payment verification is the one power that must not be delegable, so
--     there is deliberately NO permission key for it — granting it would need
--     a schema change, which is the point.
--   * §5.3's worker response shape is chosen by role. A worker is a different
--     audience, not a user with fewer ticks.
--
-- So role answers "which audience is this" and permissions answer "what may
-- this particular person do". The five owner-only powers in rule 6 (settings,
-- prices, staff, expense delete, audit log) have no keys either: they are
-- admin-only, and a checkbox that could grant them would make rule 6 false.
--
-- Requires 001, 002.
-- ============================================================

-- The catalogue is a CHECK rather than a lookup table, for the same reason
-- room types are a fixed list: a typo'd key would otherwise become a permission
-- that silently grants nothing, and nobody would notice until it mattered.
CREATE TABLE user_permissions (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL CHECK (permission_key IN (
        'booking.manage',      -- daily bookings and check-in (S10, S12)
        'tenancy.manage',      -- monthly contracts, renewal, move-out (S08, S35, S27)
        'meter.record',        -- the monthly sheet (S13)
        'meter.correct',       -- correcting a recorded reading (S15)
        'invoice.generate',    -- the monthly run (S16, S17)
        'payment.record',      -- recording a payment and its slip (S20)
        'reports.view',        -- the money reports (S39, S40)
        'request.manage',      -- the requests inbox (S42)
        'announcement.send'    -- announcements (S41)
    )),
    granted_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission_key)
);

CREATE INDEX idx_user_permissions_user ON user_permissions (user_id);

-- ------------------------------------------------------------
-- Existing staff keep exactly what they could do before this migration ran.
--
-- A permissions system that starts by taking access away breaks the desk on
-- deploy day; one that starts by granting everything makes the checkboxes
-- decorative. This grants the set the API already allowed a staff role, and
-- nothing more — meter.correct and reports.view were admin-only before, so they
-- are not granted here.
-- ------------------------------------------------------------
INSERT INTO user_permissions (user_id, permission_key, granted_by)
SELECT u.id, k.key, u.id
FROM users u
CROSS JOIN (VALUES
    ('booking.manage'), ('tenancy.manage'), ('meter.record'),
    ('invoice.generate'), ('payment.record'), ('request.manage'), ('announcement.send')
) AS k(key)
WHERE u.role = 'staff'
ON CONFLICT DO NOTHING;

-- Admins are not listed: an owner is not restricted by their own checkboxes,
-- and storing a full set for them would invite someone to un-tick one and lock
-- the owner out of their own system. The API grants admin everything.

GRANT SELECT, INSERT, UPDATE, DELETE ON user_permissions TO amanew_app;
