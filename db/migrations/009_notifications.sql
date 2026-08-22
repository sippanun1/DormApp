-- ============================================================
-- Amanew — 009 Notifications: the record Rule 6.13 already assumes exists
--
-- Business Rule 6.13 makes the in-app notification the proof a tenant was told.
-- Until this migration that proof did not exist for any event in the system:
-- 007 stores a `send_line` flag, `apps/web/app/announcements/page.tsx` tells
-- staff the message went out, and nothing was ever written down anywhere.
--
-- Never-violate rule 15, in schema form:
--
--   * A notification IS the in-app notice. There is no `in_app` column, the
--     same way 007 has none — being a row is what "the tenant was told" means,
--     and a column that could be false would make Rule 6.13 unenforceable.
--   * LINE is a copy, so its delivery state is three COLUMNS ON THIS ROW, not a
--     second table. A second table could hold a LINE message with no in-app
--     record behind it; columns cannot.
--   * `amount` and `due_date` are structured, so the LINE renderer
--     (`apps/api/src/line/messages.ts`, Phase 3) never has to read `body`.
--     Rule 15 lets LINE carry amount and due date and nothing else; giving it
--     typed fields to carry means it never needs the free text.
--
-- Plan of record: docs/LINE_INTEGRATION_PLAN.md, Phase 1. This is the whole of
-- Phase 1's schema; tenant identity and LINE credentials are 010 and Phase 3.
--
-- Requires 001, 002, 003, 007.
-- ============================================================

-- ------------------------------------------------------------
-- Formatting, in the database, because the body is composed there
--
-- The notification body is built inside the same statement as the event it is
-- about (see apps/api/src/notify/emit.ts), so the money and the date are
-- formatted in SQL. CLAUDE.md's conventions are not restyleable per call site:
-- ฿ prefix with comma thousands, and a two-digit Buddhist year.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION thai_baht(amount NUMERIC) RETURNS TEXT
    LANGUAGE sql IMMUTABLE STRICT AS $$
    -- ฿4,150 for a whole number of baht, ฿4,150.50 when there are satang.
    -- (One to_char with 'FM…990.99' would leave a trailing '.' on ฿4,150.)
    SELECT '฿' || to_char(amount, CASE WHEN amount = trunc(amount)
                                       THEN 'FM999,999,990'
                                       ELSE 'FM999,999,990.00' END);
$$;

CREATE OR REPLACE FUNCTION thai_month(d DATE) RETURNS TEXT
    LANGUAGE sql IMMUTABLE STRICT AS $$
    -- A billing period is a month, not a day: "ก.ค. 69", never "1 ก.ค. 69".
    SELECT (ARRAY['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                  'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[EXTRACT(MONTH FROM d)::int]
        || ' ' || lpad((((EXTRACT(YEAR FROM d))::int + 543) % 100)::text, 2, '0');
$$;

CREATE OR REPLACE FUNCTION thai_date(d DATE) RETURNS TEXT
    LANGUAGE sql IMMUTABLE STRICT AS $$
    -- "17 ก.ค. 69" — the Buddhist year, last two digits, as every screen shows it.
    SELECT to_char(d, 'FMDD') || ' '
        || (ARRAY['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                  'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[EXTRACT(MONTH FROM d)::int]
        || ' ' || lpad((((EXTRACT(YEAR FROM d))::int + 543) % 100)::text, 2, '0');
$$;

-- ------------------------------------------------------------
-- NOTIFICATIONS
-- ------------------------------------------------------------
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

    event       TEXT NOT NULL CHECK (event IN (
                    'bill_issued',        -- an invoice was generated (Phase 1)
                    'payment_verified',   -- the slip was accepted (Phase 1)
                    'payment_rejected',   -- the slip was refused, with the reason (Phase 1)
                    'announcement',       -- S41 reached this tenant (Phase 1)
                    'due_reminder',       -- due_day − due_reminder_days (Phase 4)
                    'overdue',            -- the day the ฿50/day starts (Phase 4)
                    'contract_expiring'   -- S28's expiring list (Phase 4)
                )),

    -- What it is about: the invoice, the payment, the announcement, the
    -- tenancy. Polymorphic, so no FK — and NOT NULL, because every event above
    -- has a referent and because the idempotency key below is only total if
    -- this column can never be NULL (NULLs do not conflict with each other).
    ref_id      UUID NOT NULL,

    title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
    body        TEXT NOT NULL CHECK (length(trim(body)) > 0),

    -- Structured, for rule 15's benefit: the LINE renderer reads these, never
    -- `body`. Both are nullable — "your slip was rejected" carries neither.
    amount      NUMERIC(10,2),
    due_date    DATE,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at     TIMESTAMPTZ,

    -- The LINE copy's delivery state, on the record it copies.
    -- 'sending' is claimed by the Phase 3 sender (FOR UPDATE SKIP LOCKED) so
    -- two Railway instances cannot both push one row; it is in the CHECK from
    -- the start because a sender that cannot write its own claim state is a
    -- migration away from working, and would fail in production only.
    line_status  TEXT NOT NULL DEFAULT 'pending'
                 CHECK (line_status IN ('pending','sending','sent','skipped','failed')),
    line_sent_at TIMESTAMPTZ,
    line_error   TEXT,
    CHECK (line_status <> 'sent' OR line_sent_at IS NOT NULL),

    -- Idempotency: one notification per tenant per event per thing. A retried
    -- batch, a double-clicked verify button or a reminder tick that runs twice
    -- in a day cannot create a second row — and because the Phase 3 sender
    -- works off rows, it cannot double-send either. This is what lets every
    -- emit point use ON CONFLICT DO NOTHING instead of checking first.
    UNIQUE (tenant_id, event, ref_id)
);

-- The tenant's own list (S38), newest first.
CREATE INDEX idx_notifications_tenant ON notifications (tenant_id, created_at DESC);
-- The Phase 3 sender's queue. Partial, because 'pending' is a brief state and
-- the table is otherwise almost entirely rows it must never look at again.
CREATE INDEX idx_notifications_line_pending ON notifications (created_at)
    WHERE line_status IN ('pending', 'sending');

-- A notification is evidence, so it is append-only in the same sense an invoice
-- is immutable (ADR-005): what was said, to whom, about what, and when. Reading
-- it and delivering the LINE copy are the only things that may change.
CREATE OR REPLACE FUNCTION block_notification_edit() RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.tenant_id, NEW.event, NEW.ref_id, NEW.title, NEW.body,
        NEW.amount, NEW.due_date, NEW.created_at)
       IS DISTINCT FROM
       (OLD.tenant_id, OLD.event, OLD.ref_id, OLD.title, OLD.body,
        OLD.amount, OLD.due_date, OLD.created_at) THEN
        RAISE EXCEPTION
            'Notifications are the proof a tenant was told (Rule 6.13) and cannot be rewritten: %',
            OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_notification_edit
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION block_notification_edit();

-- Deliberately NOT cascaded from announcements: the owner can unsend an
-- announcement (007 allows the row to be deleted), but the tenants who were
-- already told still were. `ref_id` carries no FK, so the notice outlives it.

-- ------------------------------------------------------------
-- NOTIFICATION_PREFS
--
-- Rule 6.13 enforced by a CHECK rather than by convention: 'line' is the only
-- value `channel` can hold, so in-app has no representable "off" state. A
-- future channel (SMS, e-mail) widens the CHECK; in-app never appears in it.
-- ------------------------------------------------------------
CREATE TABLE notification_prefs (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel   TEXT NOT NULL CHECK (channel = 'line'),
    event     TEXT NOT NULL CHECK (event IN (
                  'bill_issued','payment_verified','payment_rejected',
                  'announcement','due_reminder','overdue','contract_expiring')),
    enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (tenant_id, channel, event)
);

-- No rows are seeded. Absence means "not chosen yet", and the Phase 3 sender
-- reads it as enabled-by-default for bills and payments; announcements are the
-- exception the owner asked for (off unless opted in), and that default lives
-- with the sender, not here, so it stays visible next to the 300/month cap.
