-- ============================================================
-- Amanew — 004 Trigger timezone
--
-- guard_room_type_change() (ADR-004) compared check_out_date against
-- CURRENT_DATE, which on Supabase is UTC — yesterday's date for the first seven
-- hours of every Bangkok day. The consequence is narrow but real: between
-- midnight and 07:00, a room whose guest checks out today looks to the trigger
-- like a booking that already ended, and the rental_type change it should have
-- blocked would be allowed through.
--
-- 001 is deliberately a faithful transcription of Master Document §4 so it can
-- be diffed line by line, so the fix lands here as a replacement rather than as
-- an edit to 001. This is the only change: CURRENT_DATE → bangkok_today().
--
-- Requires 003_timezone.sql (bangkok_today).
-- ============================================================

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
              AND check_out_date >= bangkok_today()   -- was CURRENT_DATE (ADR-009)
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
