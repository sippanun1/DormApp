# db/ — schema and constraint verification

SQL is the source of truth for the schema. Prisma is pulled from the database
(`prisma db pull`) and used for queries only — it never owns a migration.

```
db/
  migrations/
    001_initial_schema.sql   ← Master Document §4, transcribed
    002_scope_delta.sql      ← §17.2 reconciliation (§4 is incomplete alone)
    003_timezone.sql         ← bangkok_today(); the pooler is UTC and cannot be changed
    004_trigger_timezone.sql ← the one trigger in 001 that still used CURRENT_DATE
    005_deposit_settlement.sql ← S27: move-out settlement, with rule 4's floor in the schema
    006_tenancy_chain.sql    ← tenancy_chain(): renewals are new rows, the meter is not
    007_announcements_requests.sql ← S41/S42, the two tables 002 deliberately deferred
    008_user_permissions.sql ← S26: rule 6's per-person checkboxes (role stays, and why)
    009_notifications.sql    ← Rule 6.13's proof a tenant was told; LINE state as columns on it
    010_tenant_link.sql      ← how a tenant proves who they are: a staff-issued code
    011_tenant_link_lifetime.sql ← that code becomes a setup token: multi-use, capped at the contract
    012_room_transfer.sql    ← S37: the meter chain follows the ROOM, not the contract
  tests/
    constraint_tests.sql     ← 32 assertions; the DB must reject bad data by itself
```

## Running

Order matters, and **001 must never be run without 002** — on its own it builds
a `tenancies` table with no rent column.

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 \
  -f db/migrations/001_initial_schema.sql \
  -f db/migrations/002_scope_delta.sql \
  -f db/migrations/003_timezone.sql \
  -f db/migrations/004_trigger_timezone.sql \
  -f db/migrations/005_deposit_settlement.sql \
  -f db/migrations/006_tenancy_chain.sql \
  -f db/migrations/007_announcements_requests.sql \
  -f db/migrations/008_user_permissions.sql \
  -f db/migrations/009_notifications.sql \
  -f db/migrations/010_tenant_link.sql \
  -f db/migrations/011_tenant_link_lifetime.sql \
  -f db/migrations/012_room_transfer.sql

psql "$DIRECT_URL" -f db/tests/constraint_tests.sql
```

The test file wraps everything in a transaction and rolls back, so it is safe
to run against a database with data — but run it against a scratch database
anyway.

**Building a scratch database to run the API against** (how ADR-021 was verified
without touching the live one): apply all migrations, then seed — and then
**re-run 008's staff-permission backfill by hand.** That INSERT grants the seven
delegable keys to `users.role = 'staff'`, and on a fresh database it runs before
any user exists, so it grants nothing. The live database had users when 008 ran
and does not have this problem. Without the backfill `user_permissions` is
empty, staff hit `requirePermission` 403s, and the payments and reports sections
of `smoke.sh` fail for a reason that has nothing to do with the code. Every line prints `PASS` or `FAIL`. **Any `FAIL` means the schema is
wrong: stop.**

Verified 2026-08-10 on PostgreSQL 16.14 — 26/26 pass.
Re-verified 2026-08-16 against the live Supabase database (**PostgreSQL 17.6**),
all eight migrations applied — 26/26 pass.
Re-verified 2026-08-22 with 012 applied — **51/51 pass** (45 before; the six new
ones are the transfer's NOT NULL openings, one move per contract per day, a
move to the same room, and the two functions 012 adds — proving the meter chain
follows the room and that a transfer month counts as two of them).
Earlier the same day with 011 applied — **45/45 pass** (37 before; the eight
new ones are the contract-term cap on a link code, in both directions, the
redemption counter's agreement with `first_used_at`, revoking a code that has
already been used, and `tenants.app_linked_at` being a fact of its own).
Earlier, 2026-08-20 with 010 applied — **37/37 pass**. Earlier, 2026-08-18 with 009 — **32/32** (the six new assertions
are Rule 6.13 and rule 15, below).

## Why 006 exists

Two rules that are each right on their own collide: meter readings are keyed by
tenancy (ADR-008), and a renewal is a NEW tenancy row (Rule 4.8). Together they
made a tenant who never left the room look like a new move-in the day their
contract renewed — S13 asked for an "opening" reading and made staff confirm it
against that same person's previous close.

`tenancy_chain(uuid)` returns every tenancy in a renewal chain, and the three
places that derive a previous reading all go through it. It is a function in the
database rather than three copies of a recursive CTE because the derivation has
to be identical in all three: the number shown locked on the sheet is the number
the entry endpoint will accept.

Anything that follows *physical* continuity (meters) reads the chain. Anything
that follows the *contract* (rent, agreed term, deposit) must not.

## Why 005 exists

Master Document §3.4 deferred *itemised* deposit deductions to Phase 2 on the
stated assumption that "Phase 1 doesn't include checkout/deposit-return flows".
That assumption stopped being true when the owner asked for S27 and approved it
with the rest of the prototype. 005 adds one settlement row per tenancy — not
the Phase 2 itemised ledger, which stays additive on top of it.

Never-violate rule 4 lives in that table rather than only in the API:
`refund_amount` is a generated column that floors at zero, so no endpoint
written later can produce a negative refund, and `excess_waived` records what
was written off. There is no column anywhere that could carry a former tenant's
shortfall forward, which is the point.

## Why 009 exists

Business Rule 6.13 makes the in-app notification the *proof a tenant was told*,
and that proof did not exist. 007 stored a `send_line` flag, the announcements
screen told staff the message had gone out, and nothing was written down
anywhere, on any channel. 009 is that record — Phase 1 of
`docs/LINE_INTEGRATION_PLAN.md`, and worth having even if LINE never happens.

Three shapes in it are rules rather than preferences:

- **LINE delivery state is three columns on the notification**, not a second
  table (never-violate rule 15: in-app is the record, LINE is a copy). A second
  table could hold a LINE message with no in-app record behind it. Columns
  cannot. This mirrors 007, which has a `send_line` flag and deliberately no
  `in_app` one.
- **`notification_prefs.channel` has a `CHECK (channel = 'line')`.** Rule 6.13
  says in-app cannot be switched off, so the database gives it no value that
  could mean "off". A future channel widens the CHECK; in-app never appears in
  it. This is the same technique as 008's missing permission keys — the absence
  *is* the rule.
- **`UNIQUE (tenant_id, event, ref_id)`, with `ref_id NOT NULL`.** Every emit
  point inserts with `ON CONFLICT DO NOTHING` and none of them checks first, so
  a retried batch, a double-clicked verify button or a reminder tick that runs
  twice in a day writes one row. The key is only total because `ref_id` cannot
  be NULL — NULLs do not conflict with each other.

The notification is written **in the same statement** as the event it is about
(`apps/api/src/notify/emit.ts` returns a CTE, it never runs its own query), so
an invoice cannot exist without the notice that it exists. `thai_baht()`,
`thai_date()` and `thai_month()` live here for the same reason: the body is
composed inside that statement, and ฿-with-commas and the two-digit Buddhist
year are conventions, not per-call-site choices.

## Why 002 exists

§4 of the Master Document was frozen before screens S26–S46 were added, and
§17.2 records that its schema implications were never written back into §4.
The gaps that mattered enough to fix before any data exists:

| Gap in §4 | Why it could not wait |
|---|---|
| `tenancies` had no rent column | Never-violate rule 2 freezes contract rent for the contract's life, and it had nowhere to live. Every invoice would have re-derived rent from the room's *current* price — the exact thing rule 2 forbids |
| `tenancies` had no `agreed_months` | Rule 12: it is what early termination is measured against |
| `meter_readings` was `UNIQUE (tenancy_id, meter_type, reading_period)` | Rule 13: a room transfer keeps the same tenancy, so a transfer month needs two readings per type in one period. §4's constraint rejected the second |
| No `key_deposit` on `bookings` | Rule 5: เงินประกัน and มัดจำกุญแจ are never merged. Separate columns on separate tables makes an accidental `SUM` of the two impossible |
| No renewal link | Rule 12: renewal is a *new* tenancy, never an extension. `previous_tenancy_id` is the only thing making that history readable |
| `REVOKE` statements commented out | ADR-006 calls append-only tables the compensating control for running without RLS. A commented-out REVOKE is not a control |

Deferred deliberately, because they are standalone tables with no foreign key
into the money model and so carry no migration risk: `cash_entries` (S39),
`announcements` + `announcement_reads` (S41), `requests` (S42),
`notification_prefs` (S38). They land with their endpoints — 007 and 009 are
that landing.

## Two things the tests surfaced for the owner

1. **Invoice numbers will have gaps.** `nextval()` is non-transactional — that
   is what makes it collision-proof, and it also means a failed generation
   consumes a number permanently. Invoice #1,047 not existing is normal. The
   owner should confirm they accept non-contiguous numbering, and decide the
   display format (plain `1047`, or a per-year `2569-0001` that resets) —
   invoice numbers are permanent on receipts and cannot be reformatted later.
2. **`guest_registrations` has no delete path**, by design (ADR-006). The PDPA
   retention rule (§6.2, blocking pre-launch) will need a purge mechanism
   running outside `amanew_app`. Do not solve it by granting `DELETE`.

## Why 010 exists

`tenants.line_user_id` has been in the schema since `001:88` — nullable, and
never written by anything. 010 is the migration that finally writes it, which
makes it the first moment the column can be *wrong*: without
`uq_tenants_line_user`, one LINE account could redeem codes for two tenants and
would then receive both their bills.

The credential itself is a six-character code issued across the desk (owner
decision 2026-08-17, Phase 2 of `docs/LINE_INTEGRATION_PLAN.md`). Three things
about it are the database's business rather than the generator's:

* **The alphabet is a CHECK.** No O/0, I/1 or S/5 — it is read aloud and written
  on paper. A code that could not have come from the generator cannot be stored.
* **`expires_at > created_at`**, so a code cannot be born expired. This also
  means ageing a row in a test has to move *both* columns; moving only the
  expiry is rejected, and a test that ignores the error silently proves nothing.
* **`used_by_line_user_id` implies `used_at`.** Otherwise "unused" and "never
  redeemed" could drift apart, and the API's single-use check would be reading a
  column that means nothing.

There is deliberately **no `tenants.password_hash`**. CLAUDE.md's "tenant login
is phone + password" was written for the prototype and never had a column behind
it; a password is a credential the office would end up resetting over the phone,
which is the same trust as the code with worse storage.
