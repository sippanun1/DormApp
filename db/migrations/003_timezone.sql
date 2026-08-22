-- ============================================================
-- Amanew — 003 Timezone
--
-- Master Document §18.2 / ADR-009: "Pin Asia/Bangkok in Postgres and both
-- services." The services are pinned via TZ. Postgres turned out not to be
-- pinnable on Supabase, so this migration takes the other route.
--
-- WHY IT MATTERS. Late fees start on the 6th and freeze into the invoice, so a
-- database that thinks it is still the 5th — or already the 6th — bills ฿50
-- that nobody owes, permanently, on a receipt. It is not theoretical: it broke
-- `POST /tenancies/:id/end` on 2026-08-15, where CURRENT_DATE returned the 14th
-- for a tenancy that started on the 15th, and CHECK (end_date >= start_date)
-- rejected the move-out.
--
-- WHAT DOES NOT WORK on Supabase, all verified against this database:
--   ALTER DATABASE postgres SET timezone       — recorded, but sessions ignore it
--   ?options=-c timezone=Asia/Bangkok          — stripped by the pooler
--   PGOPTIONS='-c timezone=Asia/Bangkok'       — likewise stripped
--   SET TIME ZONE per connection               — unreliable under pgbouncer
--                                                transaction-mode pooling, where
--                                                statements may land on a
--                                                different backend
-- Supavisor forces UTC on every pooled connection and there is no supported
-- override.
--
-- WHAT WORKS: never ask the server what day it is. now() is a timestamptz — an
-- absolute instant, correct no matter what the server's timezone is set to —
-- so converting it explicitly yields the Bangkok wall-clock date deterministically.
--
-- RULE: no query in this system may use CURRENT_DATE, CURRENT_TIMESTAMP or
-- now()::date for a business date. Use bangkok_today(). The ALTER DATABASE below
-- is kept because it is correct and costs nothing, but nothing may depend on it.
-- ============================================================

ALTER DATABASE postgres SET timezone TO 'Asia/Bangkok';

-- STABLE, not IMMUTABLE: the value changes between statements but not within one.
CREATE OR REPLACE FUNCTION bangkok_today() RETURNS date
    LANGUAGE sql STABLE
    AS $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date $$;

COMMENT ON FUNCTION bangkok_today() IS
    'Today in Asia/Bangkok, independent of the server timezone (ADR-009). Use this, never CURRENT_DATE.';
