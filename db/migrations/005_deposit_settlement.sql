-- ============================================================
-- Amanew — 005 Deposit settlement (S27)
--
-- Master Document §3.4/ADR-012 deferred *itemised* deposit deductions to
-- Phase 2 and left Phase 1 with `tenancies.deposit_amount` alone, on the stated
-- assumption that "Phase 1 doesn't include checkout/deposit-return flows".
-- That assumption stopped being true when the owner asked for S27 during the
-- 2026-07-31 review and approved it with the rest of the prototype on
-- 2026-08-10. A move-out that computes a refund and then stores nothing is
-- worse than no screen at all: the number a tenant was handed in cash would
-- exist only in that conversation.
--
-- So this table records the settlement as ONE row per tenancy — not the Phase 2
-- itemised ledger. It stays additive-compatible with the reserved
-- `deposit_deductions` shape: line items land there later, and each will point
-- at the settlement it belongs to.
--
-- Never-violate rule 4 is enforced HERE, not only in the API: the refund is a
-- generated column that floors at zero, so no caller can write a negative
-- refund and no future endpoint can invent a debt for a former tenant. The
-- excess is stored for display ("ส่วนเกิน — ไม่เรียกเก็บ") and is never
-- collectable, because there is no column anywhere that would carry it forward.
--
-- Requires 001, 002, 003.
-- ============================================================

CREATE TABLE deposit_settlements (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id        UUID NOT NULL UNIQUE REFERENCES tenancies(id) ON DELETE RESTRICT,

    -- What was held. Copied from the tenancy at settlement time so the record
    -- stays readable if the contract row is ever corrected.
    deposit_amount    NUMERIC(10,2) NOT NULL CHECK (deposit_amount >= 0),

    -- The three deductions Rule 9.4 names, kept apart rather than summed: a
    -- tenant asking "why did I get ฿1,200 back" needs the parts, and a total
    -- alone cannot be re-explained a year later.
    cleaning_fee      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cleaning_fee >= 0),
    damage_amount     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (damage_amount >= 0),
    outstanding_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (outstanding_amount >= 0),

    -- Rule 12 / Rule 4.12: leaving before the agreed months forfeits the
    -- deposit. A flag, not a fourth deduction — it is a different kind of event
    -- from a cost, and the reason is required so it is never a silent zero.
    deposit_forfeited BOOLEAN NOT NULL DEFAULT FALSE,
    forfeit_reason    TEXT,
    CHECK (NOT deposit_forfeited OR forfeit_reason IS NOT NULL),

    -- Rule 4, in the schema. GREATEST(...,0) is the floor; a forfeited deposit
    -- refunds nothing regardless of the arithmetic.
    refund_amount     NUMERIC(10,2) NOT NULL
                      GENERATED ALWAYS AS (
                        CASE WHEN deposit_forfeited THEN 0
                             ELSE GREATEST(deposit_amount - cleaning_fee - damage_amount - outstanding_amount, 0)
                        END
                      ) STORED,

    -- Shown struck through and never collected. Stored so the screen can show
    -- what was waived rather than silently rounding it away.
    excess_waived     NUMERIC(10,2) NOT NULL
                      GENERATED ALWAYS AS (
                        CASE WHEN deposit_forfeited THEN 0
                             ELSE GREATEST(cleaning_fee + damage_amount + outstanding_amount - deposit_amount, 0)
                        END
                      ) STORED,

    notes             TEXT,
    settled_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    settled_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deposit_settlements_tenancy ON deposit_settlements (tenancy_id);

-- ------------------------------------------------------------
-- BOOKINGS — the daily side of the same rule (rule 5)
--
-- มัดจำกุญแจ is a different species of money from เงินประกัน and is never
-- summed with it, so it settles on its own row. `key_deposit_refunded` was a
-- boolean, which cannot express "keys returned, ฿100 kept for a broken lock".
-- The deducted amount gets its own column; the boolean stays as the record of
-- whether anything was returned at all.
-- ------------------------------------------------------------
ALTER TABLE bookings
    ADD COLUMN key_deposit_deducted NUMERIC(10,2) NOT NULL DEFAULT 0
        CHECK (key_deposit_deducted >= 0);

-- The same floor as above: a deduction may consume the key deposit, never
-- exceed it and become a charge.
ALTER TABLE bookings
    ADD CONSTRAINT bookings_key_deduction_within_deposit
        CHECK (key_deposit_deducted <= key_deposit);

-- ------------------------------------------------------------
-- ADR-006: a settlement is a record of money handed over. It is corrected by a
-- new row in the Phase 2 ledger, never by editing what the tenant was told.
-- ------------------------------------------------------------
REVOKE UPDATE, DELETE ON deposit_settlements FROM amanew_app;
