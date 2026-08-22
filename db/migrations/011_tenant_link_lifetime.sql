-- ============================================================
-- Amanew — 011 The link code becomes a setup token, and the session follows
--           the tenancy
--
-- Plan of record: docs/TENANT_ACCESS_PLAN.md (2026-08-22). This supersedes the
-- link-code half of 010.
--
-- 010 made the code single-use. Driving the built system found three things
-- wrong with that, all of them the same shape:
--
--   1. The LINE webhook and the browser redeem the SAME code through the same
--      claim, so spending it on one made the other impossible. Being set up on
--      both cost two codes and two trips to the desk.
--   2. `link-status` derived เชื่อมแอปแล้ว from `used_at`. A LINE bind sets
--      `used_at`. So a tenant who bound LINE and never opened the app showed as
--      fully linked — and the two badges exist precisely so the desk can see
--      which half is missing.
--   3. Re-issuing a code killed the outstanding one by setting `used_at`, which
--      is the same column. A tenant who lost the slip before redeeming it also
--      showed as linked.
--
-- 2 and 3 are one defect: `used_at` was doing three jobs — redeemed in a
-- browser, redeemed in LINE, and revoked by re-issue. This migration gives each
-- its own column and lets the code be redeemed more than once inside a window.
--
-- What deliberately does NOT change (ADR-021, docs/TENANT_ACCESS_PLAN.md §D2):
--
--   * The code is still not a password. It is time-boxed — seven days by
--     default, and never past the end of the tenancy it opens — so a slip of
--     paper stops working on its own. `tenants` still has no `password_hash`.
--   * The code is still not a way in from LINE. Binding an account is all the
--     webhook can do with it.
--
-- Requires 001, 002, 003, 010.
-- ============================================================

-- ------------------------------------------------------------
-- One column, one job
--
-- `used_at` is renamed rather than reinterpreted: its meaning changes from
-- "spent" to "first of possibly several redemptions", and a rename makes that
-- visible at every call site instead of letting it drift silently. The CHECK
-- and the index that referenced it follow the rename automatically; the index
-- is rebuilt below because its predicate changes too.
-- ------------------------------------------------------------
ALTER TABLE tenant_link_codes RENAME COLUMN used_at TO first_used_at;

ALTER TABLE tenant_link_codes
    -- What actually happened. An unexpected extra redemption is only visible to
    -- the desk if something counts it — S04/S44 show this next to the badges.
    ADD COLUMN redemptions INTEGER NOT NULL DEFAULT 0,
    -- Killing a code early: re-issue, and the owner's delete button. Note this
    -- has NO mutual exclusion with `first_used_at` — revoking an already-used
    -- code is the whole point now that a code stays live after first use.
    ADD COLUMN revoked_at TIMESTAMPTZ;

-- Anything already redeemed under 010 was redeemed exactly once.
UPDATE tenant_link_codes SET redemptions = 1 WHERE first_used_at IS NOT NULL;

ALTER TABLE tenant_link_codes
    ADD CONSTRAINT tenant_link_codes_redemptions_check
        CHECK (redemptions >= 0 AND (redemptions > 0) = (first_used_at IS NOT NULL));

-- "Live" now means unexpired AND unrevoked; being used no longer ends a code.
-- This is the index the staff screen hits on every render to ask whether a code
-- is already outstanding for this tenant.
DROP INDEX idx_tenant_link_codes_live;
CREATE INDEX idx_tenant_link_codes_live ON tenant_link_codes (tenant_id, expires_at DESC)
    WHERE revoked_at IS NULL;

-- ------------------------------------------------------------
-- The app badge gets its own column, on the right table
--
-- Defects 2 and 3 above are fixed here rather than by a cleverer query over
-- `tenant_link_codes`, because that table cannot answer the question being
-- asked. A redemption is an event; "a device holds a session" is a state, and
-- the code row knows nothing about it.
--
-- This is deliberately symmetric with `line_user_id` (001:88): two independent
-- facts about a tenant, two columns on `tenants`, two badges that can now be
-- true or false independently — which is what Phase 5's design said all along.
-- ------------------------------------------------------------
ALTER TABLE tenants ADD COLUMN app_linked_at TIMESTAMPTZ;

-- Backfill: a redemption that did NOT carry a LINE user id was a browser one.
UPDATE tenants t
SET app_linked_at = c.at
FROM (
    SELECT tenant_id, max(first_used_at) AS at
    FROM tenant_link_codes
    WHERE first_used_at IS NOT NULL AND used_by_line_user_id IS NULL
    GROUP BY tenant_id
) c
WHERE t.id = c.tenant_id;

-- ------------------------------------------------------------
-- A code may never outlive the tenancy it opens
--
-- This cannot be a CHECK — it has to read `tenancies` and `bookings` — so it is
-- a trigger, and it is a trigger rather than trust in the issuing endpoint
-- because "extend the expiry" is a second write path that could exceed the cap
-- on its own.
--
-- NULL horizon (a tenant between contracts, or one who has moved out) means no
-- cap here; the issuing endpoint's default window is then the only limit. This
-- table is not the place to decide whether such a tenant should get a code.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_access_horizon(target UUID) RETURNS DATE
LANGUAGE sql STABLE AS $$
    SELECT max(h) FROM (
        -- Rule 12: the agreed term is what was signed ("ตกลงอยู่กี่เดือน"),
        -- not `end_date`, which stays NULL until someone actually moves out.
        SELECT (t.start_date + (t.agreed_months || ' months')::interval)::date
        FROM tenancies t
        WHERE t.tenant_id = target AND t.status = 'active'
        UNION ALL
        SELECT b.check_out_date
        FROM bookings b
        WHERE b.tenant_id = target AND b.status IN ('confirmed', 'checked_in')
    ) x(h);
$$;

CREATE OR REPLACE FUNCTION trg_link_code_within_horizon() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    horizon DATE;
BEGIN
    horizon := tenant_access_horizon(NEW.tenant_id);
    -- End of the horizon day in Bangkok, not in the server's timezone.
    -- CLAUDE.md: the Supabase pooler forces every connection to UTC, so
    -- `horizon + 1` as a bare timestamp would be seven hours out and a code
    -- would expire on the wrong side of midnight.
    IF horizon IS NOT NULL
       AND NEW.expires_at > ((horizon + 1)::timestamp AT TIME ZONE 'Asia/Bangkok') THEN
        RAISE EXCEPTION
            'link code expiry % is past the end of the tenancy (%)', NEW.expires_at, horizon
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_link_codes_horizon
    BEFORE INSERT OR UPDATE OF expires_at ON tenant_link_codes
    FOR EACH ROW EXECUTE FUNCTION trg_link_code_within_horizon();

-- ------------------------------------------------------------
-- The window, as an owner policy (S43)
--
-- Seven days by default (owner, 2026-08-22). Inserted here as well as in the
-- seed because the live database is seeded once and this key has to exist for
-- every issue after this migration runs.
-- ------------------------------------------------------------
INSERT INTO system_settings (key, value, value_type)
VALUES ('tenant_link_code_days', '7', 'int')
ON CONFLICT (key) DO NOTHING;
