-- ============================================================
-- Amanew — Constraint verification
--
-- Every test asserts that the DATABASE rejects bad data, independently of any
-- application code. Run against a freshly migrated database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_initial_schema.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/002_scope_delta.sql
--   psql "$DATABASE_URL" -f db/tests/constraint_tests.sql
--
-- Each test prints PASS or FAIL. Any FAIL means the schema is wrong — stop.
-- ============================================================

\set QUIET on
SET client_min_messages TO NOTICE;
\pset tuples_only on
\pset format unaligned

-- Both asserts RETURN their verdict rather than RAISE NOTICE it, so the result
-- is one clean line per test regardless of the client's message settings.
CREATE OR REPLACE FUNCTION assert_rejects(label TEXT, stmt TEXT) RETURNS TEXT AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN OTHERS THEN
        RETURN 'PASS  ' || rpad(label, 46) || '  (rejected: ' || left(SQLERRM, 55) || ')';
    END;
    RETURN 'FAIL  ' || rpad(label, 46) || '  <-- STATEMENT SUCCEEDED, IT MUST NOT';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_accepts(label TEXT, stmt TEXT) RETURNS TEXT AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN OTHERS THEN
        RETURN 'FAIL  ' || rpad(label, 46) || '  <-- REJECTED BUT SHOULD SUCCEED: ' || left(SQLERRM, 55);
    END;
    RETURN 'PASS  ' || rpad(label, 46);
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Fixtures
-- ------------------------------------------------------------
BEGIN;

-- Once the database is seeded, room_types already holds 'single' and 'double',
-- and type_key is UNIQUE with a CHECK allowing only those two values — so the
-- fixtures below have no third key to use and would collide. DDL is
-- transactional in Postgres, so dropping the index here is undone by the
-- ROLLBACK at the end along with everything else.
--
-- Nothing below depends on this index: the "third room type" test is rejected
-- by the CHECK constraint ('superior' is not an allowed key), not by uniqueness.
DROP INDEX uq_room_types_key;

INSERT INTO users (id, name, phone, password_hash, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'เจ้าของ',   '0810000001', 'x', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'พนักงาน',   '0810000002', 'x', 'staff'),
  ('33333333-3333-3333-3333-333333333333', 'ช่าง',      '0810000003', 'x', 'worker');

INSERT INTO buildings (id, name) VALUES
  ('44444444-4444-4444-4444-444444444444', 'Amanew Residence ศรีสะเกษ');

INSERT INTO room_types (id, type_key, name_th, name_en, bed_type, default_rent, default_nightly) VALUES
  ('55555555-5555-5555-5555-555555555555', 'single', 'ห้องเตียงเดี่ยว', 'Single Bed', 'single', 4500, 600),
  ('66666666-6666-6666-6666-666666666666', 'double', 'ห้องเตียงคู่',   'Double Bed', 'double', 5000, 700);

INSERT INTO rooms (id, building_id, room_type_id, room_number, rental_type) VALUES
  ('77777777-7777-7777-7777-777777777777', '44444444-4444-4444-4444-444444444444',
   '55555555-5555-5555-5555-555555555555', '101', 'monthly'),
  ('88888888-8888-8888-8888-888888888888', '44444444-4444-4444-4444-444444444444',
   '66666666-6666-6666-6666-666666666666', '103', 'daily'),
  ('99999999-9999-9999-9999-999999999999', '44444444-4444-4444-4444-444444444444',
   '66666666-6666-6666-6666-666666666666', '301', 'monthly');

INSERT INTO tenants (id, full_name, phone) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'คุณสมชาย ใจดี',    '0891234567'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'คุณมาลี สุขสันต์', '0897654321');

INSERT INTO tenancies (id, room_id, tenant_id, start_date, deposit_amount,
                       monthly_rent, agreed_months, created_by) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '77777777-7777-7777-7777-777777777777',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-01-01', 4500, 4500, 12,
   '11111111-1111-1111-1111-111111111111');

INSERT INTO invoices (id, tenancy_id, billing_period, room_charge, utility_charge,
                      total_amount, due_date, generated_by) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '2026-07-01', 4500, 600, 5100, '2026-07-05', '11111111-1111-1111-1111-111111111111');

INSERT INTO payments (id, invoice_id, amount, payment_method, submitted_by) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   5100, 'transfer', '22222222-2222-2222-2222-222222222222');

INSERT INTO bookings (id, room_id, tenant_id, check_in_date, check_out_date,
                      nightly_rate, key_deposit, created_by) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '88888888-8888-8888-8888-888888888888',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-08-10', '2026-08-13', 700, 300,
   '22222222-2222-2222-2222-222222222222');

\set QUIET off
\echo ''
\echo '=== THE FOUR CORE CONSTRAINTS ==================================='

-- 1. ADR-002: two active tenancies on one room (partial unique index)
SELECT assert_rejects('1. two active tenancies, same room', $q$
    INSERT INTO tenancies (room_id, tenant_id, start_date, monthly_rent, agreed_months, created_by)
    VALUES ('77777777-7777-7777-7777-777777777777', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            '2026-02-01', 4500, 6, '11111111-1111-1111-1111-111111111111')
$q$);

-- 1b. ...but an ENDED tenancy must not block a new one
SELECT assert_accepts('1b. ended tenancy does not block a new one', $q$
    INSERT INTO tenancies (room_id, tenant_id, start_date, status, monthly_rent, agreed_months, created_by)
    VALUES ('99999999-9999-9999-9999-999999999999', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            '2025-01-01', 'ended', 5000, 12, '11111111-1111-1111-1111-111111111111')
$q$);

-- 2. ADR-002: overlapping bookings (EXCLUDE constraint)
SELECT assert_rejects('2. overlapping bookings, same room', $q$
    INSERT INTO bookings (room_id, tenant_id, check_in_date, check_out_date, nightly_rate, created_by)
    VALUES ('88888888-8888-8888-8888-888888888888', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '2026-08-12', '2026-08-15', 700, '22222222-2222-2222-2222-222222222222')
$q$);

-- 2b. ...but back-to-back is fine: '[)' means checkout day is bookable
SELECT assert_accepts('2b. back-to-back booking (checkout day reused)', $q$
    INSERT INTO bookings (room_id, tenant_id, check_in_date, check_out_date, nightly_rate, created_by)
    VALUES ('88888888-8888-8888-8888-888888888888', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '2026-08-13', '2026-08-15', 700, '22222222-2222-2222-2222-222222222222')
$q$);

-- 2c. ...and a cancelled booking frees the dates
SELECT assert_accepts('2c. cancelled booking frees its dates', $q$
    WITH x AS (UPDATE bookings SET status = 'cancelled'
               WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' RETURNING 1)
    INSERT INTO bookings (room_id, tenant_id, check_in_date, check_out_date, nightly_rate, created_by)
    SELECT '88888888-8888-8888-8888-888888888888', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
           '2026-08-10', '2026-08-12', 700, '22222222-2222-2222-2222-222222222222' FROM x
$q$);

-- 3. ADR-005: invoice amounts are immutable
SELECT assert_rejects('3. UPDATE invoice total_amount', $q$
    UPDATE invoices SET total_amount = 9999 WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
$q$);

-- 3b. ...but the status may still move (that is how payment works)
SELECT assert_accepts('3b. invoice status transition still allowed', $q$
    UPDATE invoices SET status = 'pending_verification'
    WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
$q$);

-- 4. ADR-007: only an admin may verify a payment
SELECT assert_rejects('4. staff verifies a payment', $q$
    UPDATE payments SET verified_by = '22222222-2222-2222-2222-222222222222', verified_at = now()
    WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$q$);

SELECT assert_rejects('4b. worker verifies a payment', $q$
    UPDATE payments SET verified_by = '33333333-3333-3333-3333-333333333333', verified_at = now()
    WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$q$);

SELECT assert_accepts('4c. admin verifies a payment', $q$
    UPDATE payments SET verified_by = '11111111-1111-1111-1111-111111111111', verified_at = now()
    WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$q$);

\echo ''
\echo '=== NEVER-VIOLATE RULES ADDED BY 002 ============================'

-- Rule 13: a transfer month needs two readings, same tenancy/type/period,
-- different rooms. Under 001 alone the second INSERT is rejected.
SELECT assert_accepts('rule 13: two-period utilities on one tenancy', $q$
    INSERT INTO meter_readings (tenancy_id, room_id, meter_type, reading_period,
                                old_reading, new_reading, rate, entered_by)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '77777777-7777-7777-7777-777777777777',
            'electric', '2026-07-01', 2458, 2480, 9.00, '22222222-2222-2222-2222-222222222222'),
           ('cccccccc-cccc-cccc-cccc-cccccccccccc', '99999999-9999-9999-9999-999999999999',
            'electric', '2026-07-01', 1200, 1215, 9.00, '22222222-2222-2222-2222-222222222222')
$q$);

-- ...but a genuine duplicate (same room) is still rejected
SELECT assert_rejects('rule 9: duplicate reading, same room+period', $q$
    INSERT INTO meter_readings (tenancy_id, room_id, meter_type, reading_period,
                                old_reading, new_reading, rate, entered_by)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '77777777-7777-7777-7777-777777777777',
            'electric', '2026-07-01', 2480, 2500, 9.00, '22222222-2222-2222-2222-222222222222')
$q$);

-- Rule 9: current < previous is rejected
SELECT assert_rejects('rule 9: current reading below previous', $q$
    INSERT INTO meter_readings (tenancy_id, room_id, meter_type, reading_period,
                                old_reading, new_reading, rate, entered_by)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '77777777-7777-7777-7777-777777777777',
            'water', '2026-07-01', 124, 119, 25.00, '22222222-2222-2222-2222-222222222222')
$q$);

-- Rule 2: a contract cannot exist without a rent
SELECT assert_rejects('rule 2: tenancy without a rent', $q$
    INSERT INTO tenancies (room_id, tenant_id, start_date, agreed_months, created_by)
    VALUES ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '2026-09-01', 12, '11111111-1111-1111-1111-111111111111')
$q$);

-- Rule 12: agreed term is mandatory — it is what early termination measures against
SELECT assert_rejects('rule 12: tenancy without an agreed term', $q$
    INSERT INTO tenancies (room_id, tenant_id, start_date, monthly_rent, created_by)
    VALUES ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '2026-09-01', 5000, '11111111-1111-1111-1111-111111111111')
$q$);

SELECT assert_rejects('rule 12: agreed term of zero months', $q$
    INSERT INTO tenancies (room_id, tenant_id, start_date, monthly_rent, agreed_months, created_by)
    VALUES ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '2026-09-01', 5000, 0, '11111111-1111-1111-1111-111111111111')
$q$);

-- Rule 12: a contract may only be renewed once
SELECT assert_accepts('rule 12: first renewal of a contract', $q$
    INSERT INTO tenancies (room_id, tenant_id, start_date, monthly_rent, agreed_months,
                           previous_tenancy_id, created_by)
    VALUES ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '2027-01-01', 4500, 12, 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            '11111111-1111-1111-1111-111111111111')
$q$);

SELECT assert_rejects('rule 12: second renewal of the same contract', $q$
    INSERT INTO tenancies (room_id, tenant_id, start_date, status, monthly_rent, agreed_months,
                           previous_tenancy_id, created_by)
    VALUES ('77777777-7777-7777-7777-777777777777', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            '2027-01-01', 'ended', 4500, 12, 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            '11111111-1111-1111-1111-111111111111')
$q$);

-- Rule 11: only two room types exist, and the axis is the bed
SELECT assert_rejects('rule 11: a third room type', $q$
    INSERT INTO room_types (type_key, name_th, name_en, bed_type, default_rent, default_nightly)
    VALUES ('superior', 'ห้องซูพีเรีย', 'Superior', 'double', 6000, 900)
$q$);

-- ADR-004: rental_type cannot change under an active tenancy
SELECT assert_rejects('ADR-004: rental_type change, active tenancy', $q$
    UPDATE rooms SET rental_type = 'daily' WHERE id = '77777777-7777-7777-7777-777777777777'
$q$);

-- ADR-001: no third rental type
SELECT assert_rejects('ADR-001: rental_type = both', $q$
    INSERT INTO rooms (building_id, room_type_id, room_number, rental_type)
    VALUES ('44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555',
            '999', 'both')
$q$);

-- Rule 13: a transfer to the same room is meaningless
SELECT assert_rejects('rule 13: transfer from a room to itself', $q$
    INSERT INTO tenancy_room_history (tenancy_id, from_room_id, to_room_id, transferred_on, transferred_by)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '77777777-7777-7777-7777-777777777777',
            '77777777-7777-7777-7777-777777777777', '2026-07-15',
            '11111111-1111-1111-1111-111111111111')
$q$);

-- Phone is the universal identifier — it must be unique
SELECT assert_rejects('convention: duplicate tenant phone', $q$
    INSERT INTO tenants (full_name, phone) VALUES ('คุณซ้ำ เบอร์เดิม', '0891234567')
$q$);

\echo ''
\echo '=== 009: THE NOTIFICATION RECORD (RULE 6.13 / RULE 15) =========='

-- Rule 6.13: the in-app notification is the proof a tenant was told. It exists
-- as a row, and there is no column that could switch it off.
SELECT assert_accepts('rule 6.13: a bill notice is recorded', $q$
    INSERT INTO notifications (tenant_id, event, ref_id, title, body, amount, due_date)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bill_issued',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', 'บิลค่าเช่าใหม่',
            'ห้อง 101 · งวด ก.ค. 69', 5100, '2026-08-05')
$q$);

-- The idempotency key every emit point leans on: ON CONFLICT DO NOTHING is only
-- safe because the database will not accept the second row in the first place.
SELECT assert_rejects('009: the same tenant told twice about one bill', $q$
    INSERT INTO notifications (tenant_id, event, ref_id, title, body)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bill_issued',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', 'บิลค่าเช่าใหม่', 'ซ้ำ')
$q$);

-- Evidence, not a draft (ADR-005's reasoning, applied to the notice).
SELECT assert_rejects('009: rewriting what a tenant was told', $q$
    UPDATE notifications SET body = 'ยอดใหม่'
    WHERE tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND event = 'bill_issued'
$q$);

-- Reading it, and delivering the LINE copy, are the two things that may change.
SELECT assert_accepts('009: marking a notice read is still allowed', $q$
    UPDATE notifications SET read_at = now()
    WHERE tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND event = 'bill_issued'
$q$);

-- Rule 15 in the schema: LINE is the only channel that can be a preference, so
-- in-app has no representable "off" state anywhere in the database.
SELECT assert_rejects('rule 15: in-app as a switchable channel', $q$
    INSERT INTO notification_prefs (tenant_id, channel, event, enabled)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'in_app', 'bill_issued', FALSE)
$q$);

SELECT assert_accepts('rule 15: LINE can be switched off per event', $q$
    INSERT INTO notification_prefs (tenant_id, channel, event, enabled)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'line', 'announcement', FALSE)
$q$);

-- ------------------------------------------------------------
-- 010: tenant identity
--
-- The link code is the whole credential, so the shape of a valid one is the
-- database's business too — not only the generator's.
-- ------------------------------------------------------------
SELECT assert_rejects('010: a code outside the unambiguous alphabet', $q$
    INSERT INTO tenant_link_codes (code, tenant_id, issued_by, expires_at)
    VALUES ('abc123', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            (SELECT id FROM users WHERE role = 'admin' LIMIT 1), now() + interval '1 hour')
$q$);

SELECT assert_rejects('010: a code that expires before it exists', $q$
    INSERT INTO tenant_link_codes (code, tenant_id, issued_by, expires_at)
    VALUES ('ABC234', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            (SELECT id FROM users WHERE role = 'admin' LIMIT 1), now() - interval '1 hour')
$q$);

-- A LINE account that has been recorded as used must have a moment it was
-- used; otherwise "unused" and "never redeemed" could drift apart and the
-- single-use check in the API would be checking a column that means nothing.
SELECT assert_rejects('010: redeemed by LINE but never redeemed', $q$
    INSERT INTO tenant_link_codes (code, tenant_id, issued_by, expires_at, used_by_line_user_id)
    VALUES ('ABC235', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            (SELECT id FROM users WHERE role = 'admin' LIMIT 1), now() + interval '1 hour', 'U0000')
$q$);

-- One LINE account cannot claim two tenants — it would then receive both their
-- bills. `line_user_id` has existed since 001 and was never written until 010,
-- so this index is the first thing that has ever constrained it.
SELECT assert_rejects('010: one LINE account claiming two tenants', $q$
    UPDATE tenants SET line_user_id = 'Ushared'
    WHERE id IN (SELECT id FROM tenants LIMIT 2)
$q$);

-- NULL is not a claim: 59 of 60 rooms are legitimately un-linked at once.
SELECT assert_accepts('010: many tenants with no LINE account', $q$
    UPDATE tenants SET line_user_id = NULL
$q$);

-- ------------------------------------------------------------
-- 011: the code is a setup token, and it dies with the contract
--
-- 010 made the code single-use, which meant the LINE webhook and the browser
-- competed for it and being set up on both cost two codes. It is now multi-use
-- inside a window — so the window is the only thing standing between a slip of
-- paper and a tenant's bills, and the database has to be the one enforcing it.
--
-- The horizon is the AGREED term (rule 12), not `end_date`, which stays NULL
-- until someone actually moves out — and it is the LATEST active tenancy, so a
-- renewal legitimately extends it. Fixture tenant 'aaaa…' has both an original
-- and a renewed tenancy by the time this runs, which is why these two use a
-- relative far-future date rather than a literal one: hard-coding a year here
-- would silently start passing the day a fixture above it changes.
-- ------------------------------------------------------------
SELECT assert_rejects('011: a code outliving the tenancy', $q$
    INSERT INTO tenant_link_codes (code, tenant_id, issued_by, expires_at)
    VALUES ('ABC236', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            (SELECT id FROM users WHERE role = 'admin' LIMIT 1), now() + interval '10 years')
$q$);

SELECT assert_accepts('011: a code inside the tenancy', $q$
    INSERT INTO tenant_link_codes (code, tenant_id, issued_by, expires_at)
    VALUES ('ABC237', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            (SELECT id FROM users WHERE role = 'admin' LIMIT 1), now() + interval '7 days')
$q$);

-- Extending is the second write path to expires_at, which is exactly why the
-- cap is a trigger and not a clause in the issuing endpoint.
SELECT assert_rejects('011: extending a code past the tenancy', $q$
    UPDATE tenant_link_codes SET expires_at = now() + interval '10 years' WHERE code = 'ABC237'
$q$);

-- The count and the timestamp cannot disagree: if they could, "how many devices
-- used this code" and "was it ever used" would be two different answers.
SELECT assert_rejects('011: redemptions with no first use', $q$
    INSERT INTO tenant_link_codes (code, tenant_id, issued_by, expires_at, redemptions)
    VALUES ('ABC238', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            (SELECT id FROM users WHERE role = 'admin' LIMIT 1), now() + interval '1 day', 3)
$q$);

SELECT assert_rejects('011: a first use that was not counted', $q$
    INSERT INTO tenant_link_codes (code, tenant_id, issued_by, expires_at, first_used_at)
    VALUES ('ABC239', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            (SELECT id FROM users WHERE role = 'admin' LIMIT 1), now() + interval '1 day', now())
$q$);

-- The behaviour change from 010 stated as a constraint: a redeemed code is
-- still live, so the desk must be able to close it. Under single-use this state
-- was terminal and there was nothing left to revoke.
SELECT assert_accepts('011: revoking an already-redeemed code', $q$
    UPDATE tenant_link_codes SET revoked_at = now()
    WHERE code = 'ABC237' AND first_used_at IS NULL
$q$);

-- A tenant between contracts has no horizon, and no cap follows from that —
-- this table is not the place to decide whether such a tenant may have a code.
INSERT INTO tenants (id, full_name, phone)
VALUES ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'คุณไร้สัญญา', '0999000011');

SELECT assert_accepts('011: a code for a tenant between contracts', $q$
    INSERT INTO tenant_link_codes (code, tenant_id, issued_by, expires_at)
    VALUES ('ABC245', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
            (SELECT id FROM users WHERE role = 'admin' LIMIT 1), now() + interval '7 days')
$q$);

-- The two badges are two columns. Under 010 both were derived from `used_at`,
-- so a LINE bind lit เชื่อมแอปแล้ว for a tenant who had never opened the app.
SELECT assert_accepts('011: the app link is its own column', $q$
    UPDATE tenants SET app_linked_at = now()
    WHERE id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0' AND line_user_id IS NULL
$q$);

-- ------------------------------------------------------------
-- 012: room transfer (never-violate rule 13)
--
-- The contract survives the move, so the things that must NOT move with it are
-- the schema's business: there is no rent column on tenancy_room_history at all
-- (002), and the openings that make the new room measurable are NOT NULL.
--
-- A room of its own, cloned from the fixture room: every other room in this
-- file is already spoken for by the tenancy, renewal and move-out sections, and
-- `uq_tenancies_one_active_per_room` is not a constraint to work around.
-- ------------------------------------------------------------
INSERT INTO rooms (id, building_id, room_type_id, room_number, rental_type)
SELECT 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', building_id, room_type_id, '912', rental_type
FROM rooms WHERE id = '77777777-7777-7777-7777-777777777777';

SELECT assert_accepts('012: a transfer records both openings', $q$
    INSERT INTO tenancy_room_history (tenancy_id, from_room_id, to_room_id, transferred_on,
                                      transferred_by, opening_electric, opening_water)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
            '77777777-7777-7777-7777-777777777777', 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd',
            '2026-06-15', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 500, 60)
$q$);

-- One move per contract per day. Two rows for one day would make "which room
-- were they in" unanswerable, and the second would silently win.
SELECT assert_rejects('012: two moves for one contract in one day', $q$
    INSERT INTO tenancy_room_history (tenancy_id, from_room_id, to_room_id, transferred_on,
                                      transferred_by, opening_electric, opening_water)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
            'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', '77777777-7777-7777-7777-777777777777',
            '2026-06-15', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 10, 10)
$q$);

-- A move with no opening cannot be billed: the new room's first invoice would
-- have nothing to measure from.
SELECT assert_rejects('012: a transfer with no opening reading', $q$
    INSERT INTO tenancy_room_history (tenancy_id, from_room_id, to_room_id, transferred_on,
                                      transferred_by, opening_electric)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
            '77777777-7777-7777-7777-777777777777', 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd',
            '2026-07-01', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 500)
$q$);

-- Rule 13's shape in the schema: a transfer to the same room is not a transfer.
SELECT assert_rejects('012: a transfer to the same room', $q$
    INSERT INTO tenancy_room_history (tenancy_id, from_room_id, to_room_id, transferred_on,
                                      transferred_by, opening_electric, opening_water)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
            '77777777-7777-7777-7777-777777777777', '77777777-7777-7777-7777-777777777777',
            '2026-07-02', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 1, 1)
$q$);

-- The move itself. The endpoint does this in the same transaction as the
-- history row; here it is done by hand, because what is under test is the two
-- functions and not the endpoint that calls them.
UPDATE tenancies SET room_id = 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd'
WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- The whole point of the migration, as a value rather than a behaviour. Room
-- 912 has no readings of its own, so the previous reading is the opening read
-- off ITS wall — not the last reading of the room they left, which is what
-- every derivation in the system would have returned before 012.
SELECT CASE WHEN chain_previous_reading('cccccccc-cccc-cccc-cccc-cccccccccccc', 'electric') = 500
            THEN 'PASS  012: the meter chain follows the room'
            ELSE 'FAIL  012: chain_previous_reading returned '
                 || COALESCE(chain_previous_reading('cccccccc-cccc-cccc-cccc-cccccccccccc',
                                                    'electric')::text, 'NULL')
            END AS result
\gset
\echo :result

-- And a transfer month counts as two rooms, which is what stops a bill being
-- issued from the old room's meters alone.
SELECT CASE WHEN (SELECT count(*) FROM tenancy_rooms_in_period(
                    'cccccccc-cccc-cccc-cccc-cccccccccccc', DATE '2026-06-01')) = 2
            THEN 'PASS  012: a transfer month spans two rooms'
            ELSE 'FAIL  012: tenancy_rooms_in_period did not see the transfer'
            END AS result
\gset
\echo :result

-- Put it back: later sections read this tenancy in its original room.
UPDATE tenancies SET room_id = '77777777-7777-7777-7777-777777777777'
WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

\echo ''
\echo '=== ADR-003: INVOICE NUMBERING =================================='

-- The sequence is attached and starts at 1
SELECT CASE WHEN (SELECT column_default FROM information_schema.columns
                  WHERE table_name = 'invoices' AND column_name = 'invoice_number')
                 LIKE '%nextval%invoice_number_seq%'
            THEN 'PASS  invoice_number DEFAULT nextval(invoice_number_seq)'
            ELSE 'FAIL  invoice_number is not attached to the sequence' END AS result
\gset
\echo :result

SELECT CASE WHEN (SELECT invoice_number FROM invoices
                  WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd') = 1
            THEN 'PASS  first invoice number is 1'
            ELSE 'FAIL  first invoice number is not 1' END AS result
\gset
\echo :result

-- Sequential allocation with no collision. Note this cannot fail: nextval() is
-- non-transactional precisely so concurrent callers never block or duplicate.
-- The real ADR-003 risk is GAPS, demonstrated below.
SELECT assert_accepts('numbers are unique across a batch of 50', $q$
    INSERT INTO invoices (tenancy_id, billing_period, room_charge, total_amount, due_date, generated_by)
    SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc',
           make_date(2020, 1, 1) + (g || ' months')::interval,
           4500, 4500, make_date(2020, 1, 5) + (g || ' months')::interval,
           '11111111-1111-1111-1111-111111111111'
    FROM generate_series(1, 50) g
$q$);

ROLLBACK;

-- Gap demonstration, outside the rolled-back transaction: a failed generation
-- consumes a number permanently. Invoice #N missing is normal, not data loss —
-- worth knowing before month-end batch generation raises the question.
\echo ''
DO $$
DECLARE a BIGINT; b BIGINT;
BEGIN
    a := nextval('invoice_number_seq');
    BEGIN
        PERFORM nextval('invoice_number_seq');
        RAISE EXCEPTION 'simulated failure';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    b := nextval('invoice_number_seq');
    IF b - a = 2 THEN
        RAISE NOTICE 'NOTE  ADR-003: a rolled-back generation leaves a permanent gap (% then %).', a, b;
        RAISE NOTICE 'NOTE  Expected behaviour. Confirm the owner accepts non-contiguous invoice numbers.';
    END IF;
END
$$;

DROP FUNCTION assert_rejects(TEXT, TEXT);
DROP FUNCTION assert_accepts(TEXT, TEXT);

\echo ''
\echo 'Done. Any FAIL above means the schema is wrong — stop and fix it.'
