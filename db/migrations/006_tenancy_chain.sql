-- ============================================================
-- Amanew — 006 The renewal chain, as one function
--
-- Found by driving S35 and then S27 in a browser: after a renewal, the meter
-- readings restarted from nothing.
--
-- Meter readings are keyed by tenancy (ADR-008), and a renewal is deliberately
-- a NEW tenancy row (Rule 4.8). Put together, the two rules made the same
-- tenant, who never left the room, look like a new move-in the day their
-- contract renewed: S13 would ask staff to read an "opening" value off the
-- meter and confirm it against the previous occupant's close — where the
-- previous occupant is that same person, one contract earlier.
--
-- The physical meter does not care that a contract was re-signed. So the chain
-- has to follow the renewal links, and it has to do that identically in all
-- three places that derive a previous reading (the entry endpoint, the batch
-- sheet, and the move-out preview) — which is why it is a function in the
-- database rather than three copies of a recursive CTE.
--
-- Requires 001, 002.
-- ============================================================

-- Every tenancy in this contract's renewal chain, in both directions: the
-- ancestors it renewed from, and the successors it was renewed into. Bounded
-- by construction — previous_tenancy_id is UNIQUE where not null, and a
-- tenancy cannot be its own predecessor (both constraints live in 002).
CREATE OR REPLACE FUNCTION tenancy_chain(target UUID)
RETURNS TABLE (tenancy_id UUID)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE back AS (
        SELECT id, previous_tenancy_id FROM tenancies WHERE id = target
        UNION
        SELECT t.id, t.previous_tenancy_id
        FROM tenancies t JOIN back b ON t.id = b.previous_tenancy_id
    ), forward AS (
        SELECT id FROM tenancies WHERE id = target
        UNION
        SELECT t.id
        FROM tenancies t JOIN forward f ON t.previous_tenancy_id = f.id
    )
    SELECT id FROM back
    UNION
    SELECT id FROM forward;
$$;

COMMENT ON FUNCTION tenancy_chain(UUID) IS
  'Rule 4.8: a renewal is a new tenancy row, but the same tenant in the same room. '
  'Anything that follows physical continuity (meter readings) must read across the '
  'whole chain; anything that follows the contract (rent, agreed term, deposit) must not.';
