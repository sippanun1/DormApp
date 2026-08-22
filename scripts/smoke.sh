#!/usr/bin/env bash
# Regression pass — run after EVERY change, not just when touching the new thing.
#
# A new endpoint cannot be trusted not to have broken an old one: requireAuth,
# requireRole, the error handler and the Prisma client sit under all of them.
#
#   ./scripts/smoke.sh              typecheck + every API section
#   ./scripts/smoke.sh --with-db    also run the 26 schema constraint tests
#   ./scripts/smoke.sh --only auth  one section only
#            (rooms|bookings|tenancies|meters|invoices|payments|staff|comms|notify|tenant|line|reports|renewal|checkout|settings)
#
# Scope the run to what the change can reach — CLAUDE.md has the table. Shared
# middleware, env or the error handler means everything; one endpoint's own
# logic means its section.
#
# Assumes the seed has been run. Starts its own API on PORT+100 so it never
# collides with a dev server you already have open.

set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0
FAIL=0
API_PORT=3101
BASE="http://localhost:$API_PORT/api/v1"

WITH_DB=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-db) WITH_DB=1 ;;
    --only) shift; ONLY="${1:-}" ;;
  esac
  shift
done
run_section() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }

ok()   { printf '  PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected $3, got $2)"; fi; }

# --- static ------------------------------------------------------------------
# Smoke rows use reserved phone prefixes so they can always be identified and
# removed, even when a previous run was killed before its own cleanup (a piped
# `| head` is enough to do that). Leftovers otherwise hold the test dates and
# the next run fails for a reason that has nothing to do with the code.
# 0999x, not 09999: the tenant section has used 09998 since Phase 2 and the
# `line` section uses 09997, so a narrower pattern silently left both behind —
# 11 tenants had accumulated by 2026-08-21. A reserved prefix only works if the
# purge covers all of it.
SMOKE_PHONES="phone LIKE '0999%' OR phone LIKE '09888%'"
PURGE_ERR=$(mktemp)
purge_smoke_rows() {
  psql "$DIRECT_URL" -q -c "
    -- Before the tenancies it points at: the meter-replacement audit row is
    -- counted by an assertion mid-run, so a leftover reads as a regression.
    delete from audit_log where action = 'meter_replaced'
      and (detail->>'tenancy_id')::uuid in
        (select id from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES));
    -- S37's own audit row, keyed by entity_id rather than a detail field.
    delete from audit_log where action = 'room_transferred'
      and entity_id in
        (select id from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES));
    delete from guest_registrations where booking_id in
      (select id from bookings where tenant_id in (select id from tenants where $SMOKE_PHONES));
    delete from bookings  where tenant_id in (select id from tenants where $SMOKE_PHONES);
    delete from meter_reading_corrections where meter_reading_id in
      (select id from meter_readings where tenancy_id in
        (select id from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES)));
    delete from invoice_status_history where invoice_id in
      (select id from invoices where tenancy_id in
        (select id from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES)));
    delete from payments where invoice_id in
      (select id from invoices where tenancy_id in
        (select id from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES)));
    delete from invoices where tenancy_id in
      (select id from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES));
    delete from meter_readings where tenancy_id in
      (select id from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES));
    -- notifications.tenant_id is ON DELETE RESTRICT (the proof a tenant was
    -- told outlives their bills), so it has to go before the tenant does — and
    -- the announcement notices belong to REAL seeded tenants, which is why
    -- they are matched through the smoke announcement rather than the phone.
    delete from notification_prefs where tenant_id in (select id from tenants where $SMOKE_PHONES);
    delete from notifications where event = 'announcement' and ref_id in
      (select id from announcements where title LIKE 'สโมค%');
    delete from notifications where tenant_id in (select id from tenants where $SMOKE_PHONES);
    delete from deposit_settlements where tenancy_id in
      (select id from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES));
    -- tenancy_room_history.tenancy_id is a plain RESTRICT FK (002), so like
    -- the requests delete below it MUST precede the tenancies delete. psql -c
    -- runs this whole block as one implicit transaction: one FK error rolls
    -- back the ENTIRE purge and every later run starts dirty.
    -- (No backticks in this string, ever: it is inside double quotes and bash
    -- would run the contents as a command.)
    delete from tenancy_room_history where tenancy_id in
      (select id from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES));
    delete from tenancies where tenant_id in (select id from tenants where $SMOKE_PHONES);
    -- requests.tenant_id is a plain RESTRICT FK, so this MUST precede the
    -- tenants delete. It did not, and because psql -c runs the whole block as
    -- one implicit transaction, that one error rolled the ENTIRE purge back:
    -- every run left its rows behind and the next run failed on totals that had
    -- nothing to do with the code (found 2026-08-19). Matched by tenant here as
    -- well as by title below — a request the comms section files for a smoke
    -- tenant does not necessarily carry a สโมค detail.
    delete from requests where tenant_id in (select id from tenants where $SMOKE_PHONES);
    delete from tenants where $SMOKE_PHONES;
    -- The settings section's own markers: a rate starting in 2030 and a price
    -- of 9999 are values no real price list holds. Cleaned here rather than at
    -- the end of that section, so an interrupted run (or one without --with-db)
    -- does not leave the next one failing on a duplicate.
    delete from audit_log where action = 'rate_added' and detail->>'effective_from' = '2030-01-01';
    delete from audit_log where action = 'price_changed' and detail->'to'->>'rent' = '9999';
    delete from utility_rates where effective_from = DATE '2030-01-01';
    delete from requests where detail LIKE 'สโมค%';
    delete from announcements where title LIKE 'สโมค%';
    delete from audit_log where entity_id in (select id from users where phone LIKE '09777%');
    delete from user_permissions where user_id in (select id from users where phone LIKE '09777%');
    delete from users where phone LIKE '09777%';" >/dev/null 2>"$PURGE_ERR"
  # A purge that fails is worse than no purge: the run continues against another
  # run's rows and reports failures the change did not cause. It was silent for
  # exactly that reason before — never send this to /dev/null.
  if [ -s "$PURGE_ERR" ]; then
    printf '  WARN  smoke cleanup failed — the next run will start dirty:\n' >&2
    sed 's/^/        /' "$PURGE_ERR" >&2
  fi
}
# The API sections generate invoices, and nextval is non-transactional, so a run
# leaves the sequence advanced even after its rows are deleted. Put it back when
# the table is empty: the owner's first real invoice should be #1, and until
# real data exists there is nothing for a gap to mean.
reset_invoice_seq() {
  [ "$(psql "$DIRECT_URL" -At -c 'select count(*) from invoices' 2>/dev/null)" = "0" ] &&
    psql "$DIRECT_URL" -q -c 'alter sequence invoice_number_seq restart with 1' >/dev/null 2>&1
}

if [ -f .env ]; then set -a; . ./.env; set +a; purge_smoke_rows; fi
# API_PID is set when this run starts its own API, below. Killing by PID rather
# than `pkill -f "tsx watch src/index.ts"`, which matched ANY dev API on the
# machine — including the one `scripts/browser-drive.js` needs on port 3000/3001,
# so running the two in the same session killed the driver's server mid-pass and
# looked like a flaky screen (found 2026-08-21).
#
# Killing that PID alone was not enough: it is the `npm run dev` wrapper, and the
# `tsx watch` child it spawns survives and keeps $API_PORT bound. The next run's
# API then dies with EADDRINUSE and every request is answered by the PREVIOUS
# run's process — which still holds a tripped rate limiter, so the whole suite
# fails on 401s that have nothing to do with the code (found 2026-08-22).
# Freeing the port by port number is the narrow fix: 3101 is this script's own,
# and nothing else on the machine listens there.
API_PID=""
free_api_port() { fuser -k -TERM "$API_PORT/tcp" >/dev/null 2>&1 || true; }
trap 'purge_smoke_rows; reset_invoice_seq; rm -f "$PURGE_ERR"; [ -n "$API_PID" ] && kill "$API_PID" >/dev/null 2>&1; free_api_port' EXIT

echo "== rules =="
# ADR-009. The ban on CURRENT_DATE is only worth anything if something checks it:
# a query using it works fine in an afternoon test and is wrong every morning
# before 07:00, when Supabase's UTC connection is still on yesterday.
banned=$(grep -rnE '\b(CURRENT_DATE|CURRENT_TIMESTAMP)\b|now\(\)::date' apps/api/src db/migrations \
  --include='*.ts' --include='*.sql' 2>/dev/null |
  # 001 is a frozen transcription of §4 and is superseded by 004; 003 defines the
  # replacement and 004 documents what it replaced.
  grep -vE '00[134]_(timezone|initial_schema|trigger_timezone)\.sql' |
  # Comments explaining the rule are not violations of it: SQL --, and TS //,
  # /* and the * continuation lines of a JSDoc block.
  grep -vE ':[0-9]+: *(--|//|\*|/\*)')
if [ -z "$banned" ]; then
  ok "no CURRENT_DATE outside 003_timezone.sql (use bangkok_today)"
else
  bad "CURRENT_DATE used — see ADR-009 / CLAUDE.md"
  echo "$banned" | sed 's/^/        /'
fi

echo "== typecheck =="
npm run typecheck --workspace=apps/api >/dev/null 2>&1 && ok "api typecheck" || bad "api typecheck"
npm run typecheck --workspace=apps/web >/dev/null 2>&1 && ok "web typecheck" || bad "web typecheck"

# --- database ----------------------------------------------------------------
if [ "$WITH_DB" = "1" ]; then
  echo "== schema constraints =="
  set -a; . ./.env; set +a
  # Reset BEFORE the suite, not after: one of its assertions is that the first
  # invoice number is 1, and a previous run's invoice tests will have consumed
  # numbers (nextval is non-transactional). Resetting afterwards leaves the
  # assertion failing for exactly one run, which reads as a phantom regression.
  [ "$(psql "$DIRECT_URL" -At -c 'select count(*) from invoices')" = "0" ] &&
    psql "$DIRECT_URL" -q -c 'alter sequence invoice_number_seq restart with 1' >/dev/null 2>&1
  out=$(psql "$DIRECT_URL" -f db/tests/constraint_tests.sql 2>&1)
  n_fail=$(echo "$out" | grep -c '^FAIL')
  n_pass=$(echo "$out" | grep -c '^PASS')
  # A suite that produced no results has not passed — it did not run. Reporting
  # "0 tests passed" as green is the one failure mode a smoke test must not have.
  if [ "$n_pass" -lt 51 ]; then
    bad "constraint suite did not run ($n_pass passed, expected 51)"
    echo "$out" | grep -E '^(psql|ERROR)' | head -3 | sed 's/^/        /'
  elif [ "$n_fail" -gt 0 ]; then
    bad "$n_fail constraint tests failed"
    echo "$out" | grep '^FAIL' | sed 's/^/        /'
  else
    ok "$n_pass constraint tests"
  fi
  # The suite burns invoice numbers (nextval is non-transactional), so put the
  # sequence back — the owner's first real invoice should be #1.
  [ "$(psql "$DIRECT_URL" -At -c 'select count(*) from invoices')" = "0" ] &&
    psql "$DIRECT_URL" -q -c 'alter sequence invoice_number_seq restart with 1' >/dev/null 2>&1
fi

# --- API ---------------------------------------------------------------------
echo "== api =="
# The suite logs in far more often than a person does — three seed users, plus
# one per section that creates a user — so it runs with a raised login limit and
# tests the limiter explicitly against that number below. Leaving it at the
# production default of 5 makes every later section fail with a 429 that has
# nothing to do with what it is testing.
SMOKE_LOGIN_LIMIT=30
# Same reasoning for redeeming a link code: the tenant section redeems far more
# often than a tenant ever would, and the limiter is per-IP so every request in
# a run shares one key. Raised here and asserted explicitly against this number
# at the end of the tenant section, where tripping it can no longer poison
# anything. The store is in-memory and this run starts its own API, so a tripped
# window never survives into the next run.
SMOKE_REDEEM_LIMIT=25
# LINE: fake credentials so the webhook has something to verify against, and a
# send interval long enough that the API's own timer never fires during a run —
# the notify section asserts rows are still `pending`, and a background sender
# would drain them. The `line` section drives the sender explicitly instead.
# LINE_DRY_RUN=1 is belt and braces on top of NODE_ENV: nothing may reach a real
# phone from a test, ever.
SMOKE_LINE_SECRET=smoke-channel-secret
# And free it before starting, not only on the way out: an interrupted run
# (Ctrl-C between the two traps) leaves the child holding the port too.
free_api_port
PORT=$API_PORT LOGIN_RATE_LIMIT_ATTEMPTS=$SMOKE_LOGIN_LIMIT \
  TENANT_REDEEM_RATE_LIMIT_ATTEMPTS=$SMOKE_REDEEM_LIMIT \
  LINE_CHANNEL_SECRET=$SMOKE_LINE_SECRET LINE_CHANNEL_ACCESS_TOKEN=smoke-access-token \
  LINE_DRY_RUN=1 LINE_SEND_INTERVAL_SEC=86400 REMINDER_TICK_SEC=86400 \
  npm run dev --workspace=apps/api >/tmp/amanew-smoke.log 2>&1 &
API_PID=$!
for _ in $(seq 1 30); do curl -fs "$BASE/health" >/dev/null 2>&1 && break; sleep 1; done

token() {
  curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$1\",\"password\":\"${SEED_PASSWORD:-amanew1234}\"}" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).token||'')}catch(e){}})"
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check "health 200" "$(code "$BASE/health")" "200"
check "health pinned to Asia/Bangkok" "$(curl -s "$BASE/health" | grep -c 'Asia/Bangkok')" "1"

ADMIN=$(token 0800000001); STAFF=$(token 0800000002); WORKER=$(token 0800000003)
[ -n "$ADMIN" ] && ok "admin login" || bad "admin login"
[ -n "$STAFF" ] && ok "staff login" || bad "staff login"
[ -n "$WORKER" ] && ok "worker login" || bad "worker login"

check "no token → 401" "$(code "$BASE/auth/me")" "401"
check "bad token → 401" "$(code "$BASE/auth/me" -H 'Authorization: Bearer nonsense')" "401"
check "/auth/me with token → 200" "$(code "$BASE/auth/me" -H "Authorization: Bearer $ADMIN")" "200"

# Wrong password and unknown phone must be indistinguishable (no phone oracle).
# Runs here, before any section spends a login attempt: the limiter is per-IP,
# and a section that logs a new user in pushes this past the limit, at which
# point it compares a 401 against a 429 and fails for the wrong reason.
# A body we could not read is the caller's fault, not ours. Every endpoint used
# to answer 500 to this and log it as unhandled — found while probing production
# on 2026-08-22. Asserted on an endpoint that needs no token, so it is testing
# the error handler and not an auth path.
check "malformed JSON → 400, not 500" \
  "$(code -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d 'not json at all')" "400"
check "and the message is ours, not body-parser's English one" \
  "$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d 'not json at all' | grep -c 'รูปแบบข้อมูล')" "1"
# The narrowness matters: a JSON.parse failure in our OWN code is a real bug and
# must keep its 500, which is why the handler matches body-parser's `type`
# rather than `instanceof SyntaxError`.
check "an oversized body → 413" \
  "$(node -e "process.stdout.write(JSON.stringify({phone:'0'.repeat(3*1024*1024)}))" | curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' --data-binary @-)" "413"

wrong=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"phone":"0800000001","password":"wrong"}')
unknown=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"phone":"0899999999","password":"wrong"}')
[ "$wrong" = "$unknown" ] && ok "login is not a phone-number oracle" || bad "login reveals whether a phone exists"


if run_section rooms; then
check "rooms without token → 401" "$(code "$BASE/dashboard/rooms")" "401"
check "rooms as staff → 200" "$(code "$BASE/dashboard/rooms" -H "Authorization: Bearer $STAFF")" "200"

rooms_json=$(curl -s "$BASE/dashboard/rooms" -H "Authorization: Bearer $ADMIN")
check "60 rooms" "$(echo "$rooms_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).rooms.length))")" "60"
check "39 double / 21 single" \
  "$(echo "$rooms_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).rooms;console.log(r.filter(x=>x.room_type==='double').length+'/'+r.filter(x=>x.room_type==='single').length)})")" \
  "39/21"
check "42 monthly / 18 daily" \
  "$(echo "$rooms_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).rooms;console.log(r.filter(x=>x.rental_type==='monthly').length+'/'+r.filter(x=>x.rental_type==='daily').length)})")" \
  "42/18"

# S28's board. A worker has no business with arrivals, contracts or money.
check "today board as staff → 200" "$(code "$BASE/dashboard/today" -H "Authorization: Bearer $STAFF")" "200"
check "today board is not for workers → 403" "$(code "$BASE/dashboard/today" -H "Authorization: Bearer $WORKER")" "403"
check "today board carries all five sections" \
  "$(curl -s "$BASE/dashboard/today" -H "Authorization: Bearer $ADMIN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(['arrivals','departures','expiring','pending_verifications','overdue_invoices'].every(k=>k in j))})")" \
  "true"

# §5.3 — the worker shape must never carry a name, a phone or a price.
worker_json=$(curl -s "$BASE/dashboard/rooms" -H "Authorization: Bearer $WORKER")
check "worker response leaks nothing" \
  "$(echo "$worker_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const banned=['occupant','rent','nightly','tenancy_id','booking_id','id'];const keys=new Set(j.rooms.flatMap(r=>Object.keys(r)));console.log(banned.some(b=>keys.has(b))||('summary' in j)?'LEAK':'clean')})")" \
  "clean"
fi

# --- bookings (Week 3) -------------------------------------------------------
# Every row this section writes is rolled back at the end, so the smoke test
# never leaves demo bookings behind in a database the owner will look at.
if run_section bookings; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  PHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  check "tenant lookup, unknown phone → 404" "$(code "$BASE/tenants?phone=$PHONE" -H "$AH")" "404"
  TID=$(post /tenants "{\"full_name\":\"สโมคเทสต์\",\"phone\":\"$PHONE\"}" | jget ".tenant.id")
  [ -n "$TID" ] && ok "create tenant" || bad "create tenant"
  check "duplicate phone → 409" "$(postcode /tenants "{\"full_name\":\"ซ้ำ\",\"phone\":\"$PHONE\"}")" "409"
  check "tenant lookup now → 200" "$(code "$BASE/tenants?phone=$PHONE" -H "$AH")" "200"

  DAILY=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='daily').id")
  MONTHLY=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly').id")
  D1="2027-03-01"; D2="2027-03-04"

  BID=$(post /bookings "{\"room_id\":\"$DAILY\",\"tenant_id\":\"$TID\",\"check_in_date\":\"$D1\",\"check_out_date\":\"$D2\"}" | jget ".booking.id")
  [ -n "$BID" ] && ok "create booking" || bad "create booking"
  check "monthly room refuses a daily booking → 409" \
    "$(postcode /bookings "{\"room_id\":\"$MONTHLY\",\"tenant_id\":\"$TID\",\"check_in_date\":\"$D1\",\"check_out_date\":\"$D2\"}")" "409"
  # ADR-002: the EXCLUDE constraint does the rejecting, translated to a 409.
  check "overlapping dates → 409" \
    "$(postcode /bookings "{\"room_id\":\"$DAILY\",\"tenant_id\":\"$TID\",\"check_in_date\":\"2027-03-02\",\"check_out_date\":\"2027-03-06\"}")" "409"
  check "back-to-back booking → 201" \
    "$(postcode /bookings "{\"room_id\":\"$DAILY\",\"tenant_id\":\"$TID\",\"check_in_date\":\"$D2\",\"check_out_date\":\"2027-03-06\"}")" "201"

  # ADR-011: there is no way to check in without a guest registration.
  check "check-in without guest data → 400" "$(postcode "/bookings/$BID/check-in" '{}')" "400"
  check "check-in with guest data → 200" \
    "$(postcode "/bookings/$BID/check-in" '{"key_deposit":200,"guest_id_type":"thai_id","guest_id_number":"1234567890123","guest_address":"ศรีสะเกษ"}')" "200"
  check "check-in twice → 409" \
    "$(postcode "/bookings/$BID/check-in" '{"guest_id_type":"thai_id","guest_id_number":"1","guest_address":"x"}')" "409"
  check "check-out → 200" "$(postcode "/bookings/$BID/check-out" '{}')" "200"
  check "check-out twice → 409" "$(postcode "/bookings/$BID/check-out" '{}')" "409"

  if [ "$WITH_DB" = "1" ]; then
    orphans=$(psql "$DIRECT_URL" -At -c "select count(*) from bookings b left join guest_registrations g on g.booking_id=b.id where b.status in ('checked_in','checked_out') and g.id is null")
    check "no checked-in booking without a registration" "$orphans" "0"
    psql "$DIRECT_URL" -q -c "delete from guest_registrations where booking_id in (select id from bookings where tenant_id in (select id from tenants where phone='$PHONE'));
      delete from bookings where tenant_id in (select id from tenants where phone='$PHONE');
      delete from tenants where phone='$PHONE';" >/dev/null 2>&1 &&
      ok "smoke data cleaned up" || bad "smoke data left behind"
  fi
fi

# --- tenancies (Week 4) ------------------------------------------------------
if run_section tenancies; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  TPHONE="09888$(printf '%05d' $((RANDOM % 100000)))"
  TTID=$(post /tenants "{\"full_name\":\"สโมคสัญญา\",\"phone\":\"$TPHONE\"}" | jget ".tenant.id")
  MROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  DROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='daily').id")

  # bangkok_today(), not the server's date: for seven hours a day Supabase's
  # pooled connection is on yesterday, which used to reject a same-day move-out.
  TODAY=$(node -e "console.log(new Date(Date.now()+7*3600e3).toISOString().slice(0,10))")

  TNID=$(post /tenancies "{\"room_id\":\"$MROOM\",\"tenant_id\":\"$TTID\",\"start_date\":\"$TODAY\",\"agreed_months\":12,\"deposit_amount\":4500}" | jget ".tenancy.id")
  [ -n "$TNID" ] && ok "create tenancy" || bad "create tenancy"
  check "second tenancy on the same room → 409" \
    "$(postcode /tenancies "{\"room_id\":\"$MROOM\",\"tenant_id\":\"$TTID\",\"start_date\":\"$TODAY\",\"agreed_months\":6}")" "409"
  check "agreed_months = 0 → 400" \
    "$(postcode /tenancies "{\"room_id\":\"$MROOM\",\"tenant_id\":\"$TTID\",\"start_date\":\"$TODAY\",\"agreed_months\":0}")" "400"
  check "daily room refuses a monthly contract → 409" \
    "$(postcode /tenancies "{\"room_id\":\"$DROOM\",\"tenant_id\":\"$TTID\",\"start_date\":\"$TODAY\",\"agreed_months\":12}")" "409"
  check "rent defaults to the standard price, unflagged" \
    "$(curl -s "$BASE/tenancies/$TNID" -H "$AH" | jget ".tenancy.rent_overridden")" "false"
  # Rule 2: the contract rent is frozen; the room's current price may move past it.
  check "contract rent is 4500" "$(curl -s "$BASE/tenancies/$TNID" -H "$AH" | jget ".tenancy.monthly_rent")" "4500"
  check "same-day move-out → 200 (bangkok_today)" "$(postcode "/tenancies/$TNID/end" '{}')" "200"
  check "move-out twice → 409" "$(postcode "/tenancies/$TNID/end" '{}')" "409"

  if [ "$WITH_DB" = "1" ]; then
    psql "$DIRECT_URL" -q -c "delete from tenancies where tenant_id in (select id from tenants where phone='$TPHONE');
      delete from tenants where phone='$TPHONE';" >/dev/null 2>&1 &&
      ok "tenancy smoke data cleaned up" || bad "tenancy smoke data left behind"
    check "bangkok_today() is not the server date" \
      "$(psql "$DIRECT_URL" -At -c 'select bangkok_today() = (now() AT TIME ZONE '"'"'Asia/Bangkok'"'"')::date')" "t"
  fi
fi

# --- meters & room types (Week 5) --------------------------------------------
if run_section meters; then
  AH="Authorization: Bearer $ADMIN"
  SH="Authorization: Bearer $STAFF"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  MPHONE="09888$(printf '%05d' $((RANDOM % 100000)))"
  MTID=$(post /tenants "{\"full_name\":\"สโมคมิเตอร์\",\"phone\":\"$MPHONE\"}" | jget ".tenant.id")
  MROOM2=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  TODAY2=$(node -e "console.log(new Date(Date.now()+7*3600e3).toISOString().slice(0,10))")
  MTEN=$(post /tenancies "{\"room_id\":\"$MROOM2\",\"tenant_id\":\"$MTID\",\"start_date\":\"$TODAY2\",\"agreed_months\":12}" | jget ".tenancy.id")

  check "room-types lookup → 200" "$(code "$BASE/room-types" -H "$AH")" "200"

  READ='{"reading_period":"2026-08-01","readings":[{"meter_type":"electric","old_reading":1000,"new_reading":1150},{"meter_type":"water","old_reading":50,"new_reading":58}]}'
  RES=$(post "/tenancies/$MTEN/meter-readings" "$READ")
  # ฿9/unit electric: 150 units = ฿1,350. Rate is captured per row so the cost
  # is frozen against later tariff changes.
  check "both meters saved, electric cost 1350" \
    "$(echo "$RES" | jget ".readings.find(r=>r.meter_type==='electric').computed_cost")" "1350"
  check "water cost 200 (8 units x 25)" \
    "$(echo "$RES" | jget ".readings.find(r=>r.meter_type==='water').computed_cost")" "200"
  # ADR-015: a duplicate anywhere in the batch fails the whole request.
  check "duplicate period → 409" "$(postcode "/tenancies/$MTEN/meter-readings" "$READ")" "409"
  check "current below previous → 400" \
    "$(postcode "/tenancies/$MTEN/meter-readings" '{"reading_period":"2026-09-01","readings":[{"meter_type":"electric","old_reading":1150,"new_reading":900}]}')" "400"
  check "estimated reading accepted and flagged" \
    "$(post "/tenancies/$MTEN/meter-readings" '{"reading_period":"2026-09-01","readings":[{"meter_type":"electric","old_reading":1150,"new_reading":1300,"is_estimated":true}]}' | jget ".readings[0].is_estimated")" "true"

  # ADR-008, the two moments. Within a tenancy the chain decides: omit
  # old_reading and the server derives it, send a wrong one and it refuses.
  check "continuing month derives old_reading (1300)" \
    "$(post "/tenancies/$MTEN/meter-readings" '{"reading_period":"2026-10-01","readings":[{"meter_type":"electric","new_reading":1400}]}' | jget ".readings[0].computed_cost")" "900"
  check "mismatched old_reading refused → 409" \
    "$(postcode "/tenancies/$MTEN/meter-readings" '{"reading_period":"2026-11-01","readings":[{"meter_type":"electric","old_reading":999,"new_reading":1500}]}')" "409"

  # Owner's practice: the crossing month is an estimate from last month's
  # figure, and the new meter then starts its own chain from whatever the dial
  # shows — the one legitimate case for a number lower than last month.
  check "replaced meter without a baseline → 400" \
    "$(postcode "/tenancies/$MTEN/meter-readings" '{"reading_period":"2026-11-01","readings":[{"meter_type":"electric","new_reading":60,"meter_replaced":true}]}')" "400"
  check "replaced meter re-bases the chain → 201" \
    "$(postcode "/tenancies/$MTEN/meter-readings" '{"reading_period":"2026-11-01","readings":[{"meter_type":"electric","old_reading":0,"new_reading":60,"meter_replaced":true}]}')" "201"
  check "next month derives from the NEW chain (60)" \
    "$(post "/tenancies/$MTEN/meter-readings" '{"reading_period":"2026-11-15","readings":[{"meter_type":"electric","new_reading":210}]}' | jget ".readings[0].computed_cost")" "1350"
  if [ "$WITH_DB" = "1" ]; then
    check "the re-base is recorded in audit_log" \
      "$(psql "$DIRECT_URL" -At -c "select count(*) from audit_log where action='meter_replaced'")" "1"
    psql "$DIRECT_URL" -q -c "delete from audit_log where action='meter_replaced'" >/dev/null 2>&1
  fi

  # A new tenancy on the same room must not inherit the old closing value.
  postcode "/tenancies/$MTEN/end" '{}' >/dev/null
  MPHONE2="09888$(printf '%05d' $((RANDOM % 100000)))"
  MTID2=$(post /tenants "{\"full_name\":\"สโมคมิเตอร์สอง\",\"phone\":\"$MPHONE2\"}" | jget ".tenant.id")
  MTEN2=$(post /tenancies "{\"room_id\":\"$MROOM2\",\"tenant_id\":\"$MTID2\",\"start_date\":\"$TODAY2\",\"agreed_months\":12}" | jget ".tenancy.id")
  check "opening reading is not derived → 400" \
    "$(postcode "/tenancies/$MTEN2/meter-readings" '{"reading_period":"2026-12-01","readings":[{"meter_type":"electric","new_reading":1500}]}')" "400"
  check "opening below previous tenant's close → 409" \
    "$(postcode "/tenancies/$MTEN2/meter-readings" '{"reading_period":"2026-12-01","readings":[{"meter_type":"electric","old_reading":1200,"new_reading":1500}]}')" "409"
  check "opening above previous close needs confirmation → 409" \
    "$(postcode "/tenancies/$MTEN2/meter-readings" '{"reading_period":"2026-12-01","readings":[{"meter_type":"electric","old_reading":1420,"new_reading":1500}]}')" "409"
  check "opening accepted when confirmed → 201" \
    "$(postcode "/tenancies/$MTEN2/meter-readings" '{"reading_period":"2026-12-01","readings":[{"meter_type":"electric","old_reading":1420,"new_reading":1500,"confirm_opening":true}]}')" "201"

  MRID=$(echo "$RES" | jget ".readings.find(r=>r.meter_type==='electric').id")
  check "staff cannot correct a reading → 403" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/meter-readings/$MRID/correct" -H "$SH" -H "$JH" -d '{"corrected_old_reading":1000,"corrected_new_reading":1100,"reason":"x"}')" "403"
  check "correction requires a reason → 400" \
    "$(postcode "/meter-readings/$MRID/correct" '{"corrected_old_reading":1000,"corrected_new_reading":1100,"reason":""}')" "400"
  check "admin correction → 201" \
    "$(postcode "/meter-readings/$MRID/correct" '{"corrected_old_reading":1000,"corrected_new_reading":1100,"reason":"อ่านผิด"}')" "201"
  # ADR-006: the original row is never mutated, the correction sits beside it.
  check "original reading unchanged (1150)" \
    "$(curl -s "$BASE/meter-readings/$MRID" -H "$AH" | jget ".reading.new_reading")" "1150"
  check "correction is visible on the reading" \
    "$(curl -s "$BASE/meter-readings/$MRID" -H "$AH" | jget ".reading.corrections.length")" "1"

  # The batch sheet's data (S13). One row per active tenancy, and the two
  # ADR-008 moments visible side by side on the same room.
  PEND="$BASE/meter-readings/pending?reading_period=2027-01-01"
  check "pending sheet lists active tenancies only" \
    "$(curl -s "$PEND" -H "$AH" | jget ".tenancies.filter(t=>t.tenancy_id==='$MTEN').length")" "0"
  check "continuing meter carries the chain's previous reading (1500)" \
    "$(curl -s "$PEND" -H "$AH" | jget ".tenancies.find(t=>t.tenancy_id==='$MTEN2').meters.electric.previous_reading")" \
    "1500"
  check "a meter with no history is an opening reading, not a pre-fill" \
    "$(curl -s "$PEND" -H "$AH" | jget ".tenancies.find(t=>t.tenancy_id==='$MTEN2').meters.water.is_opening")" "true"

  # ADR-004: the trigger refuses, not application code.
  check "rental-type change under an active tenancy → 409" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/rooms/$MROOM2/rental-type" -H "$AH" -H "$JH" -d '{"new_type":"daily"}')" "409"
  check "staff cannot change rental type → 403" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/rooms/$MROOM2/rental-type" -H "$SH" -H "$JH" -d '{"new_type":"daily"}')" "403"

  # Both tenancies opened on this room must be closed, or the trigger is right
  # to keep refusing and the next check fails for the wrong reason.
  postcode "/tenancies/$MTEN/end" '{}' >/dev/null
  postcode "/tenancies/$MTEN2/end" '{}' >/dev/null
  check "rental-type change once the room is free → 200" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/rooms/$MROOM2/rental-type" -H "$AH" -H "$JH" -d '{"new_type":"daily"}')" "200"
  curl -s -o /dev/null -X PATCH "$BASE/rooms/$MROOM2/rental-type" -H "$AH" -H "$JH" -d '{"new_type":"monthly"}'
fi

# --- invoices (Week 6) -------------------------------------------------------
if run_section invoices; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  IPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  ITID=$(post /tenants "{\"full_name\":\"สโมคบิล\",\"phone\":\"$IPHONE\"}" | jget ".tenant.id")
  IROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  # A period well in the past, so the live late fee is large and deterministic.
  PERIOD="2026-01-01"
  ITEN=$(post /tenancies "{\"room_id\":\"$IROOM\",\"tenant_id\":\"$ITID\",\"start_date\":\"$PERIOD\",\"agreed_months\":12,\"monthly_rent\":4500}" | jget ".tenancy.id")

  # ADR-015: one utility on file is not "ready".
  # Opening values deliberately high, and confirmed: an earlier section may have
  # left readings on this room, and an opening BELOW the previous tenant's close
  # is refused by design (section 4.2). Consumption is what the totals assert —
  # 150 units electric, 8 units water — so the absolute values are free.
  post "/tenancies/$ITEN/meter-readings" "{\"reading_period\":\"$PERIOD\",\"readings\":[{\"meter_type\":\"electric\",\"old_reading\":9000,\"new_reading\":9150,\"confirm_opening\":true}]}" >/dev/null
  check "one utility only → generate blocked 400" \
    "$(postcode "/tenancies/$ITEN/invoices" "{\"billing_period\":\"$PERIOD\"}")" "400"
  check "not ready with one utility" \
    "$(curl -s "$BASE/invoices/ready?billing_period=$PERIOD" -H "$AH" | jget ".ready.filter(x=>x.tenancy_id==='$ITEN').length")" "0"

  post "/tenancies/$ITEN/meter-readings" "{\"reading_period\":\"$PERIOD\",\"readings\":[{\"meter_type\":\"water\",\"old_reading\":900,\"new_reading\":908,\"confirm_opening\":true}]}" >/dev/null
  check "ready once both utilities are on file" \
    "$(curl -s "$BASE/invoices/ready?billing_period=$PERIOD" -H "$AH" | jget ".ready.filter(x=>x.tenancy_id==='$ITEN').length")" "1"

  IID=$(post "/tenancies/$ITEN/invoices" "{\"billing_period\":\"$PERIOD\"}" | jget ".invoice.id")
  [ -n "$IID" ] && ok "generate invoice" || bad "generate invoice"
  # rent 4500 + electric 150x9 (1350) + water 8x25 (200) = 6050
  check "total = rent + both utilities (6050)" \
    "$(curl -s "$BASE/invoices/$IID" -H "$AH" | jget ".invoice.total_amount")" "6050"
  check "due date is the 5th of the next month" \
    "$(curl -s "$BASE/invoices/$IID" -H "$AH" | jget ".invoice.due_date.slice(0,10)")" "2026-02-05"
  check "duplicate period → 409" "$(postcode "/tenancies/$ITEN/invoices" "{\"billing_period\":\"$PERIOD\"}")" "409"

  # ADR-009: live while unpaid, and it must match 50 x days past due.
  EXPECTED_FEE=$(node -e "
    const due=new Date('2026-02-05T00:00:00+07:00');
    const today=new Date(new Date(Date.now()+7*3600e3).toISOString().slice(0,10)+'T00:00:00+07:00');
    console.log(Math.max(0,Math.round((today-due)/86400000))*50)")
  check "live late fee = 50/day past due ($EXPECTED_FEE)" \
    "$(curl -s "$BASE/invoices/$IID" -H "$AH" | jget ".invoice.late_fee_live")" "$EXPECTED_FEE"
  check "not frozen yet" "$(curl -s "$BASE/invoices/$IID" -H "$AH" | jget ".invoice.late_fee_is_frozen")" "false"
  check "amount due = total + live fee" \
    "$(curl -s "$BASE/invoices/$IID" -H "$AH" | jget ".invoice.amount_due")" "$((6050 + EXPECTED_FEE))"
  check "utility lines are itemised" \
    "$(curl -s "$BASE/invoices/$IID" -H "$AH" | jget ".utility_lines.length")" "2"
  # ADR-005
  check "editing an issued invoice refused → 409" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/invoices/$IID" -H "$AH" -H "$JH" -d '{"total_amount":1}')" "409"
  check "filter by tenancy" \
    "$(curl -s "$BASE/invoices?tenancy_id=$ITEN" -H "$AH" | jget ".invoices.length")" "1"
  check "filter by status" \
    "$(curl -s "$BASE/invoices?tenancy_id=$ITEN&status=paid" -H "$AH" | jget ".invoices.length")" "0"

  # Section 7's test: concurrent batch runs must not double-invoice, and the
  # sequence must not collide.
  P2="2026-02-01"
  post "/tenancies/$ITEN/meter-readings" "{\"reading_period\":\"$P2\",\"readings\":[{\"meter_type\":\"electric\",\"new_reading\":9300},{\"meter_type\":\"water\",\"new_reading\":916}]}" >/dev/null
  # Wait on these PIDs specifically: a bare `wait` would also wait on the API
  # dev server this script started in the background, and never return.
  batch_pids=""
  for _ in $(seq 1 10); do
    post /invoices/batch "{\"billing_period\":\"$P2\"}" >/dev/null &
    batch_pids="$batch_pids $!"
  done
  for pid in $batch_pids; do wait "$pid"; done
  if [ "$WITH_DB" = "1" ]; then
    check "10 concurrent batch runs → exactly 1 invoice" \
      "$(psql "$DIRECT_URL" -At -c "select count(*) from invoices where tenancy_id='$ITEN' and billing_period='$P2'")" "1"
    check "invoice numbers are unique" \
      "$(psql "$DIRECT_URL" -At -c "select count(*) - count(distinct invoice_number) from invoices")" "0"
    psql "$DIRECT_URL" -q -c "delete from invoice_status_history where invoice_id in (select id from invoices where tenancy_id='$ITEN'); delete from invoices where tenancy_id='$ITEN';" >/dev/null 2>&1
  fi
fi

# --- payments & verification (Week 7) ----------------------------------------
if run_section payments; then
  AH="Authorization: Bearer $ADMIN"
  SH="Authorization: Bearer $STAFF"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  spostcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$SH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  # One tenancy, two invoices: one to verify, one to reject.
  PPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  PTID=$(post /tenants "{\"full_name\":\"สโมคชำระเงิน\",\"phone\":\"$PPHONE\"}" | jget ".tenant.id")
  PROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  PP1="2026-03-01"; PP2="2026-04-01"
  PTEN=$(post /tenancies "{\"room_id\":\"$PROOM\",\"tenant_id\":\"$PTID\",\"start_date\":\"$PP1\",\"agreed_months\":12,\"monthly_rent\":4500}" | jget ".tenancy.id")
  post "/tenancies/$PTEN/meter-readings" "{\"reading_period\":\"$PP1\",\"readings\":[{\"meter_type\":\"electric\",\"old_reading\":8000,\"new_reading\":8150,\"confirm_opening\":true},{\"meter_type\":\"water\",\"old_reading\":800,\"new_reading\":808,\"confirm_opening\":true}]}" >/dev/null
  post "/tenancies/$PTEN/meter-readings" "{\"reading_period\":\"$PP2\",\"readings\":[{\"meter_type\":\"electric\",\"new_reading\":8300},{\"meter_type\":\"water\",\"new_reading\":816}]}" >/dev/null
  PINV=$(post "/tenancies/$PTEN/invoices" "{\"billing_period\":\"$PP1\"}" | jget ".invoice.id")
  PINV2=$(post "/tenancies/$PTEN/invoices" "{\"billing_period\":\"$PP2\"}" | jget ".invoice.id")

  # 4500 + 150x9 + 8x25 = 6050, plus whatever the live fee is today.
  DUE=$(curl -s "$BASE/invoices/$PINV" -H "$AH" | jget ".invoice.amount_due")
  [ -n "$DUE" ] && ok "invoice ready to pay (฿$DUE)" || bad "invoice ready to pay"

  # §5's slip rules, before any money moves.
  check "transfer without a slip → 400" \
    "$(postcode "/invoices/$PINV/payments" "{\"amount\":$DUE,\"payment_method\":\"transfer\"}")" "400"
  check "a slip path we did not issue → 400" \
    "$(postcode "/invoices/$PINV/payments" "{\"amount\":$DUE,\"payment_method\":\"transfer\",\"slip_file_url\":\"http://evil/x.jpg\"}")" "400"
  # Rule 1 — from both sides, so "under" and "over" are equally refused.
  check "partial payment → 400" \
    "$(postcode "/invoices/$PINV/payments" "{\"amount\":100,\"payment_method\":\"cash\"}")" "400"
  check "overpayment → 400" \
    "$(postcode "/invoices/$PINV/payments" "{\"amount\":$((${DUE%.*} + 100)),\"payment_method\":\"cash\"}")" "400"

  # Byte sniffing: the declared MIME type is the client's opinion, not evidence.
  TXT=$(mktemp /tmp/amanew-slip-XXXX.jpg); printf 'not an image' > "$TXT"
  PNG=$(mktemp /tmp/amanew-slip-XXXX.png)
  node -e "require('fs').writeFileSync('$PNG',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'))"
  check "a text file named .jpg → 400" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/payments/slips" -H "$SH" -F "slip=@$TXT;type=image/jpeg")" "400"
  SLIP=$(curl -s -X POST "$BASE/payments/slips" -H "$SH" -F "slip=@$PNG" | jget ".slip_file_url")
  [ -n "$SLIP" ] && ok "slip uploaded to private storage" || bad "slip upload"
  rm -f "$TXT" "$PNG"

  # Staff record the payment (ADR-007: they may record, never confirm).
  PAY=$(curl -s -X POST "$BASE/invoices/$PINV/payments" -H "$SH" -H "$JH" \
    -d "{\"amount\":$DUE,\"payment_method\":\"transfer\",\"slip_file_url\":\"$SLIP\"}" | jget ".payment.id")
  [ -n "$PAY" ] && ok "staff submit payment" || bad "staff submit payment"
  check "invoice now awaiting verification" \
    "$(curl -s "$BASE/invoices/$PINV" -H "$AH" | jget ".invoice.status")" "pending_verification"
  # ADR-009: the fee stops moving the moment the slip is in.
  check "late fee frozen at submission" \
    "$(curl -s "$BASE/invoices/$PINV" -H "$AH" | jget ".invoice.late_fee_is_frozen")" "true"
  check "a second slip on the same bill → 409" \
    "$(postcode "/invoices/$PINV/payments" "{\"amount\":$DUE,\"payment_method\":\"cash\"}")" "409"

  check "queue is admin-only → 403" "$(code "$BASE/payments/pending" -H "$SH")" "403"
  check "payment is in the queue" \
    "$(curl -s "$BASE/payments/pending" -H "$AH" | jget ".pending.filter(p=>p.id==='$PAY').length")" "1"
  check "queue is oldest first" \
    "$(curl -s "$BASE/payments/pending" -H "$AH" | jget ".pending.every((p,i,a)=>i===0||a[i-1].submitted_at<=p.submitted_at)")" "true"
  check "slip is served as a signed URL, not a public path" \
    "$(curl -s "$BASE/payments/$PAY" -H "$AH" | jget ".slip_url.includes('token=')")" "true"

  # ADR-007, both halves. Express first.
  check "staff cannot verify → 403" "$(spostcode "/payments/$PAY/verify" '{}')" "403"
  check "admin verify → 200" "$(postcode "/payments/$PAY/verify" '{}')" "200"
  check "invoice is paid" "$(curl -s "$BASE/invoices/$PINV" -H "$AH" | jget ".invoice.status")" "paid"
  check "verify twice → 409" "$(postcode "/payments/$PAY/verify" '{}')" "409"
  check "paid bill refuses another payment → 409" \
    "$(postcode "/invoices/$PINV/payments" "{\"amount\":$DUE,\"payment_method\":\"cash\"}")" "409"

  # Rejection, on the second invoice. Cash needs no slip (owner decision).
  DUE2=$(curl -s "$BASE/invoices/$PINV2" -H "$AH" | jget ".invoice.amount_due")
  PAY2=$(curl -s -X POST "$BASE/invoices/$PINV2/payments" -H "$SH" -H "$JH" \
    -d "{\"amount\":$DUE2,\"payment_method\":\"cash\"}" | jget ".payment.id")
  [ -n "$PAY2" ] && ok "cash payment without a slip" || bad "cash payment without a slip"
  check "reject without a reason → 400" "$(postcode "/payments/$PAY2/reject" '{"reason":"  "}')" "400"
  check "staff cannot reject → 403" "$(spostcode "/payments/$PAY2/reject" '{"reason":"ยอดไม่ตรง"}')" "403"
  check "admin reject → 200" "$(postcode "/payments/$PAY2/reject" '{"reason":"ยอดไม่ตรงกับสลิป"}')" "200"
  check "invoice is rejected" "$(curl -s "$BASE/invoices/$PINV2" -H "$AH" | jget ".invoice.status")" "rejected"
  # The fee has to keep running on a bill nobody has settled.
  check "late fee is live again after rejection" \
    "$(curl -s "$BASE/invoices/$PINV2" -H "$AH" | jget ".invoice.late_fee_is_frozen")" "false"
  # The rejected attempt is the record a dispute is settled from.
  check "rejected payment is kept, not deleted" \
    "$(curl -s "$BASE/invoices/$PINV2/payments" -H "$AH" | jget ".payments.length")" "1"
  check "rejected payment leaves the queue" \
    "$(curl -s "$BASE/payments/pending" -H "$AH" | jget ".pending.filter(p=>p.id==='$PAY2').length")" "0"
  DUE2B=$(curl -s "$BASE/invoices/$PINV2" -H "$AH" | jget ".invoice.amount_due")
  check "tenant can pay again after a rejection → 201" \
    "$(postcode "/invoices/$PINV2/payments" "{\"amount\":$DUE2B,\"payment_method\":\"cash\"}")" "201"

  if [ "$WITH_DB" = "1" ]; then
    # §7's Week 7 test: the database must refuse a staff verification on its own,
    # with the API removed from the picture entirely.
    STAFF_ID=$(psql "$DIRECT_URL" -At -c "select id from users where role='staff' limit 1")
    trg=$(psql "$DIRECT_URL" -At -c "update payments set verified_by='$STAFF_ID', verified_at=now() where id='$PAY2'" 2>&1)
    case "$trg" in *'Only admin users may verify payments'*) ok "DB trigger refuses staff verification" ;;
      *) bad "DB trigger allowed a staff verification ($trg)" ;; esac
    check "the reason is on the status history" \
      "$(psql "$DIRECT_URL" -At -c "select reason from invoice_status_history where invoice_id='$PINV2' and new_status='rejected'")" \
      "ยอดไม่ตรงกับสลิป"
    psql "$DIRECT_URL" -q -c "delete from payments where invoice_id in ('$PINV','$PINV2');
      delete from invoice_status_history where invoice_id in ('$PINV','$PINV2');
      delete from invoices where tenancy_id='$PTEN';" >/dev/null 2>&1
  fi
fi

# --- staff & permissions (S26) -----------------------------------------------
# Rule 6: per-person checkboxes, not roles. The test creates a real user, logs
# in as them, and checks what they can and cannot reach — a permission system
# tested only through the owner's token proves nothing.
if run_section staff; then
  AH="Authorization: Bearer $ADMIN"
  SH="Authorization: Bearer $STAFF"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  putcode() { curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  check "staff list is owner-only → 403" "$(code "$BASE/staff" -H "$SH")" "403"
  check "the nine delegable keys are published" \
    "$(curl -s "$BASE/staff" -H "$AH" | jget ".permission_keys.length")" "9"
  # The powers rule 6 calls owner-only must not be delegable at all — no key.
  check "payment verification is not a permission key" \
    "$(curl -s "$BASE/staff" -H "$AH" | jget ".permission_keys.filter(k=>k.includes('verify')).length")" "0"
  check "settings and prices are not permission keys" \
    "$(curl -s "$BASE/staff" -H "$AH" | jget ".permission_keys.filter(k=>k.startsWith('setting')||k.startsWith('price')).length")" "0"
  check "the seven role names are published as presets, not types" \
    "$(curl -s "$BASE/staff" -H "$AH" | jget ".presets" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(s.length>0))")" \
    "true"

  UPHONE="09777$(printf '%05d' $((RANDOM % 100000)))"
  NEWUSER=$(post /staff "{\"name\":\"สโมคพนักงาน\",\"phone\":\"$UPHONE\",\"password\":\"smoketest123\",\"role\":\"staff\",\"permissions\":[\"meter.record\"]}")
  SUID=$(echo "$NEWUSER" | jget ".user.id")
  [ -n "$SUID" ] && ok "owner creates a staff member with one tick" || bad "owner creates a staff member"
  check "a short password → 400" \
    "$(postcode /staff "{\"name\":\"x\",\"phone\":\"0977700001\",\"password\":\"short\"}")" "400"
  check "a duplicate phone → 409" \
    "$(postcode /staff "{\"name\":\"x\",\"phone\":\"$UPHONE\",\"password\":\"smoketest123\"}")" "409"

  UTOKEN=$(curl -s -X POST "$BASE/auth/login" -H "$JH" -d "{\"phone\":\"$UPHONE\",\"password\":\"smoketest123\"}" | jget ".token")
  UH="Authorization: Bearer $UTOKEN"
  [ -n "$UTOKEN" ] && ok "the new staff member can log in" || bad "the new staff member can log in"

  # One tick, and only that tick.
  check "granted: the meter sheet → 200" "$(code "$BASE/meter-readings/pending?reading_period=2026-08-01" -H "$UH")" "200"
  check "not granted: the invoice list → 403" "$(code "$BASE/invoices" -H "$UH")" "403"
  check "not granted: the requests inbox → 403" "$(code "$BASE/requests" -H "$UH")" "403"
  check "never delegable: the verification queue → 403" "$(code "$BASE/payments/pending" -H "$UH")" "403"
  check "never delegable: the audit log → 403" "$(code "$BASE/audit-log" -H "$UH")" "403"
  # The shared baseline every desk user needs, with or without ticks.
  check "still allowed: the room grid → 200" "$(code "$BASE/dashboard/rooms" -H "$UH")" "200"

  # The tick list is replaced wholesale, which is what the screen shows.
  check "owner grants two more → 200" \
    "$(putcode "/staff/$SUID/permissions" '{"permissions":["meter.record","invoice.generate"]}')" "200"
  check "now granted: the invoice list → 200" "$(code "$BASE/invoices" -H "$UH")" "200"
  check "removing a tick takes the access away" \
    "$(putcode "/staff/$SUID/permissions" '{"permissions":["invoice.generate"]}')$(code "$BASE/meter-readings/pending?reading_period=2026-08-01" -H "$UH")" \
    "200403"
  check "an unknown key → 400" "$(putcode "/staff/$SUID/permissions" '{"permissions":["everything"]}')" "400"
  # An admin passes every check already; a tick list on one would be a lie.
  ADMIN_ID=$(curl -s "$BASE/auth/me" -H "$AH" | jget ".user.id")
  check "ticking permissions on the owner → 409" \
    "$(putcode "/staff/$ADMIN_ID/permissions" '{"permissions":["meter.record"]}')" "409"
  check "the owner cannot deactivate themselves → 409" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/staff/$ADMIN_ID" -H "$AH" -H "$JH" -d '{"is_active":false}')" "409"

  check "the permission change is in the audit log" \
    "$(curl -s "$BASE/audit-log?entity_type=user" -H "$AH" | jget ".entries.filter(e=>e.action==='permissions_changed').length > 0")" "true"
  check "and records both sides of it" \
    "$(curl -s "$BASE/audit-log?entity_type=user" -H "$AH" | jget ".entries.find(e=>e.action==='permissions_changed').detail.to.length > 0")" "true"

  if [ "$WITH_DB" = "1" ]; then
    # The catalogue is a CHECK, so a typo'd key cannot become a permission that
    # silently grants nothing.
    bad_key=$(psql "$DIRECT_URL" -At -c "insert into user_permissions (user_id, permission_key, granted_by) values ('$SUID','invoice.delete','$SUID')" 2>&1)
    case "$bad_key" in *check*|*violates*) ok "the DB refuses a permission key that does not exist" ;;
      *) bad "an unknown permission key was accepted ($bad_key)" ;; esac
    psql "$DIRECT_URL" -q -c "delete from audit_log where entity_id = '$SUID';
      delete from user_permissions where user_id = '$SUID';
      delete from users where id = '$SUID';" >/dev/null 2>&1 &&
      ok "staff smoke data cleaned up" || bad "staff smoke data left behind"
  fi
fi

# --- announcements & requests (S41/S42) --------------------------------------
if run_section comms; then
  AH="Authorization: Bearer $ADMIN"
  SH="Authorization: Bearer $STAFF"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  # --- S41. Rule 15: in-app is not a channel choice, so there is no field for
  # it — only LINE can be turned off, and a tenant without LINE still gets it.
  ANN=$(post /announcements '{"title":"สโมค ปิดน้ำชั่วคราว","body":"ทดสอบระบบ","target_type":"floor","target_floors":[3,4],"send_line":true}')
  ANNID=$(echo "$ANN" | jget ".announcement.id")
  [ -n "$ANNID" ] && ok "send a floor announcement" || bad "send a floor announcement"
  check "a floor announcement with no floors → 400" \
    "$(postcode /announcements '{"title":"x","body":"y","target_type":"floor","target_floors":[]}')" "400"
  check "an empty title → 400" "$(postcode /announcements '{"title":"  ","body":"y","target_type":"all"}')" "400"
  check "the LINE copy is recorded as a copy" \
    "$(curl -s "$BASE/announcements" -H "$AH" | jget ".announcements.find(a=>a.id==='$ANNID').send_line")" "true"
  # Targeting is stored as what was chosen, not as an expanded room list — the
  # reach is computed on read and labelled as "right now" on the screen.
  check "reach is computed against occupancy now, not stored" \
    "$(curl -s "$BASE/announcements" -H "$AH" | jget ".announcements.find(a=>a.id==='$ANNID').occupied_rooms_now >= 0")" "true"
  check "staff can send, only the owner can unsend → 403" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/announcements/$ANNID" -H "$SH")" "403"
  check "owner deletes it → 200" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/announcements/$ANNID" -H "$AH")" "200"

  # --- S42. Rule 14: no parts, no costs, and the ช่าง has no account.
  QROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms[0].id")
  QID=$(post /requests "{\"room_id\":\"$QROOM\",\"request_type\":\"repair\",\"detail\":\"สโมค — ก๊อกน้ำรั่ว\"}" | jget ".request.id")
  [ -n "$QID" ] && ok "record a repair request" || bad "record a repair request"
  check "a request starts unassigned" \
    "$(curl -s "$BASE/requests" -H "$AH" | jget ".requests.find(r=>r.id==='$QID').status")" "reported"
  check "an empty detail → 400" \
    "$(postcode /requests "{\"room_id\":\"$QROOM\",\"request_type\":\"repair\",\"detail\":\"   \"}")" "400"
  check "assign to a name, not a user account → 200" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/requests/$QID" -H "$AH" -H "$JH" -d '{"status":"assigned","assigned_to":"ช่างโอ๋"}')" "200"
  # Business Rule 11.1: resolved is the end state, and it must carry its date.
  curl -s -o /dev/null -X PATCH "$BASE/requests/$QID" -H "$AH" -H "$JH" -d '{"status":"resolved"}'
  check "resolving stamps the time it was resolved" \
    "$(curl -s "$BASE/requests" -H "$AH" | jget ".requests.find(r=>r.id==='$QID').resolved_at !== null")" "true"
  # Re-opening must clear it, or the CHECK tying the two together would fail.
  curl -s -o /dev/null -X PATCH "$BASE/requests/$QID" -H "$AH" -H "$JH" -d '{"status":"in_progress"}'
  check "re-opening clears the resolved time" \
    "$(curl -s "$BASE/requests" -H "$AH" | jget ".requests.find(r=>r.id==='$QID').resolved_at")" "null"
  check "a request in progress cannot be deleted → 409" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/requests/$QID" -H "$AH")" "409"
  check "open queue counts it" \
    "$(curl -s "$BASE/requests?status=in_progress" -H "$AH" | jget ".requests.filter(r=>r.id==='$QID').length")" "1"

  if [ "$WITH_DB" = "1" ]; then
    # The constraint, with the API out of the picture: resolved and its
    # timestamp are one fact, not two fields to keep in step by hand.
    bad_row=$(psql "$DIRECT_URL" -At -c "update requests set status='resolved', resolved_at=null where id='$QID'" 2>&1)
    case "$bad_row" in *check*|*violates*) ok "the DB refuses a resolved request with no resolved_at" ;;
      *) bad "a resolved request with no timestamp was accepted ($bad_row)" ;; esac
    psql "$DIRECT_URL" -q -c "delete from requests where detail like 'สโมค%'; delete from announcements where title like 'สโมค%';" >/dev/null 2>&1 &&
      ok "comms smoke data cleaned up" || bad "comms smoke data left behind"
  fi
fi

# --- money reports (S39/S40) -------------------------------------------------
# Builds one real payment end to end (bill → pay → verify) and then asserts the
# reports say exactly that. A report tested against seeded numbers proves only
# that the seed and the query agree with each other.
if run_section reports; then
  AH="Authorization: Bearer $ADMIN"
  SH="Authorization: Bearer $STAFF"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  THIS_MONTH=$(node -e "console.log(new Date(Date.now()+7*3600e3).toISOString().slice(0,7)+'-01')")

  # Every assertion below is a DELTA against this baseline, never an absolute.
  # The payments section verifies a slip earlier in the same run, and a verified
  # slip IS this month's income the moment it exists — so the absolute figures
  # this section used to assert were only ever true under --only reports, and
  # failed in a full run for a reason that had nothing to do with the reports
  # (found 2026-08-19). What the section is actually testing is that ONE payment
  # moves the totals by exactly its own parts.
  summary_field() { curl -s "$BASE/reports/summary?month=$THIS_MONTH" -H "$AH" | jget ".income.$1"; }
  delta() { node -e "process.stdout.write(String(Math.round(($1 - $2) * 100) / 100))"; }

  BASE_SLIPS=$(summary_field slip_count)
  BASE_TOTAL=$(summary_field total)
  BASE_RENT=$(summary_field rent)
  BASE_UTIL=$(summary_field utility)

  GPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  GTID=$(post /tenants "{\"full_name\":\"สโมครายงาน\",\"phone\":\"$GPHONE\"}" | jget ".tenant.id")
  GROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  GPERIOD="2026-06-01"
  GTEN=$(post /tenancies "{\"room_id\":\"$GROOM\",\"tenant_id\":\"$GTID\",\"start_date\":\"$GPERIOD\",\"agreed_months\":12,\"monthly_rent\":4500}" | jget ".tenancy.id")
  post "/tenancies/$GTEN/meter-readings" "{\"reading_period\":\"$GPERIOD\",\"readings\":[{\"meter_type\":\"electric\",\"old_reading\":5000,\"new_reading\":5150,\"confirm_opening\":true},{\"meter_type\":\"water\",\"old_reading\":500,\"new_reading\":508,\"confirm_opening\":true}]}" >/dev/null
  GINV=$(post "/tenancies/$GTEN/invoices" "{\"billing_period\":\"$GPERIOD\"}" | jget ".invoice.id")
  GDUE=$(curl -s "$BASE/invoices/$GINV" -H "$AH" | jget ".invoice.amount_due")
  GPAY=$(curl -s -X POST "$BASE/invoices/$GINV/payments" -H "Authorization: Bearer $STAFF" -H "$JH" \
    -d "{\"amount\":$GDUE,\"payment_method\":\"cash\"}" | jget ".payment.id")

  # Not income yet: the slip exists but nobody has approved it (ADR-007).
  check "an unverified slip is not income" \
    "$(delta "$(summary_field slip_count)" "$BASE_SLIPS")" "0"

  # ...and every category is a NUMBER while that is true. /summary aggregates
  # one month with no GROUP BY, so with nothing verified yet SUM() returns NULL,
  # not 0. S39 formats all four unconditionally: a null blanked the entire
  # screen on an empty database (found 2026-08-19, the owner could not open
  # รายรับ at all). Asserted here rather than on the frontend because the API is
  # what must not send it.
  check "a month with no verified slips reports zero, not null" \
    "$(curl -s "$BASE/reports/summary?month=$THIS_MONTH" -H "$AH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=JSON.parse(s).income;console.log([i.rent,i.utility,i.other,i.late_fee].every(v=>typeof v==='number'))})")" \
    "true"

  curl -s -o /dev/null -X POST "$BASE/payments/$GPAY/verify" -H "$AH" -H "$JH" -d '{}'

  check "reports are owner-only → 403" "$(code "$BASE/reports/summary?month=$THIS_MONTH" -H "$SH")" "403"
  check "verifying the slip makes it income" \
    "$(delta "$(summary_field slip_count)" "$BASE_SLIPS")" "1"
  check "income rises by exactly what was paid" \
    "$(delta "$(summary_field total)" "$BASE_TOTAL")" "$(delta "$GDUE" 0)"
  # rent 4500 + electric 1350 + water 200 (+ any late fee) must sum to the total.
  check "rent is reported from the invoice (4500)" \
    "$(delta "$(summary_field rent)" "$BASE_RENT")" "4500"
  check "utilities are reported from the invoice (1550)" \
    "$(delta "$(summary_field utility)" "$BASE_UTIL")" "1550"
  # rule 1 again, seen from the reporting end: a payment settles an invoice in
  # full, so its parts must reconstruct it exactly — no rounding slack.
  check "categories add up to the money received" \
    "$(curl -s "$BASE/reports/summary?month=$THIS_MONTH" -H "$AH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=JSON.parse(s).income;console.log(Math.round((i.rent+i.utility+i.other+i.late_fee)*100)===Math.round(i.total*100))})")" \
    "true"

  # The month a payment belongs to is the month it was VERIFIED, not the period
  # it settles — that is what reconciles against a bank statement.
  check "the payment counts in the month it was verified, not billed" \
    "$(curl -s "$BASE/reports/income/detail?month=$THIS_MONTH" -H "$AH" | jget ".payments.filter(p=>p.id==='$GPAY').length")" "1"
  check "the June bill is not counted in June's income" \
    "$(curl -s "$BASE/reports/income/detail?month=$GPERIOD" -H "$AH" | jget ".payments.length")" "0"
  check "the six-month trend includes this month" \
    "$(curl -s "$BASE/reports/income?months=6" -H "$AH" | jget ".months.filter(m=>m.month.slice(0,7)==='${THIS_MONTH:0:7}').length")" "1"

  # §15.4: staff recorded it, the owner confirmed it. ADR-007 is only a control
  # if it can be seen holding.
  check "the reconciliation shows who verified" \
    "$(curl -s "$BASE/reports/income/detail?month=$THIS_MONTH" -H "$AH" | jget ".by_staff.length > 0")" "true"
  # Staff recorded this one and the owner confirmed it, so it is NOT self-recorded
  # — asserted on this payment's own verifier row rather than on whichever row
  # happens to be first, which depends on what else ran before this section.
  check "and does not flag a slip two different people handled" \
    "$(curl -s "$BASE/reports/income/detail?month=$THIS_MONTH" -H "$AH" | jget ".payments.filter(p=>p.id==='$GPAY').every(p=>p.submitted_by_name!==p.verified_by_name)")" "true"

  check "occupancy counts the 60 real rooms" \
    "$(curl -s "$BASE/reports/summary?month=$THIS_MONTH" -H "$AH" | jget ".occupancy.total_rooms")" "60"
fi

# --- notifications (Phase 1 of the LINE plan) --------------------------------
# Runs after `reports` deliberately: it verifies a payment, and a verified slip
# IS this month's income the moment it exists (S39). Ahead of the reports
# section it would show up in every total that section asserts.
# Rule 6.13: the in-app notification is the proof a tenant was told. Phase 1
# exposes no endpoint to read it back (that is the tenant app, Phase 2), so
# these assertions go to the database directly — which is also the stronger
# test. The notice must be there because the statement that issued the bill
# wrote it, not because a second query ran afterwards and happened to succeed.
if run_section notify; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }
  nq() { psql "$DIRECT_URL" -At -c "$1" 2>/dev/null; }

  NPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  NTID=$(post /tenants "{\"full_name\":\"สโมคแจ้งเตือน\",\"phone\":\"$NPHONE\"}" | jget ".tenant.id")
  NROOM_PAIR=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant');process.stdout.write(r.id+'|'+r.room_number)})")
  NROOM="${NROOM_PAIR%%|*}"
  NROOMNO="${NROOM_PAIR##*|}"
  NFLOOR="${NROOMNO:0:1}"
  NPERIOD="2026-05-01"
  NTEN=$(post /tenancies "{\"room_id\":\"$NROOM\",\"tenant_id\":\"$NTID\",\"start_date\":\"$NPERIOD\",\"agreed_months\":12,\"monthly_rent\":4500}" | jget ".tenancy.id")

  # Atomicity, from the failing side first: no meter readings means no invoice,
  # and therefore no notice claiming one exists.
  check "a bill that cannot be issued tells nobody → 400" \
    "$(postcode "/tenancies/$NTEN/invoices" "{\"billing_period\":\"$NPERIOD\"}")" "400"
  check "and left no notification behind" \
    "$(nq "select count(*) from notifications where tenant_id='$NTID'")" "0"

  post "/tenancies/$NTEN/meter-readings" "{\"reading_period\":\"$NPERIOD\",\"readings\":[{\"meter_type\":\"electric\",\"old_reading\":7000,\"new_reading\":7150,\"confirm_opening\":true},{\"meter_type\":\"water\",\"old_reading\":700,\"new_reading\":708,\"confirm_opening\":true}]}" >/dev/null
  NINV=$(post "/tenancies/$NTEN/invoices" "{\"billing_period\":\"$NPERIOD\"}" | jget ".invoice.id")
  NTOTAL=$(curl -s "$BASE/invoices/$NINV" -H "$AH" | jget ".invoice.total_amount")
  NDUEDATE=$(curl -s "$BASE/invoices/$NINV" -H "$AH" | jget ".invoice.due_date.slice(0,10)")

  check "issuing a bill records the in-app notice (Rule 6.13)" \
    "$(nq "select count(*) from notifications where tenant_id='$NTID' and event='bill_issued'")" "1"
  check "the notice points at the invoice it is about" \
    "$(nq "select ref_id from notifications where tenant_id='$NTID' and event='bill_issued'")" "$NINV"
  # Rule 15: LINE carries amount and due date, so they are stored as columns —
  # the Phase 3 renderer never has to parse the body to find them.
  check "the amount is structured, not only in the text" \
    "$(nq "select amount::float8 from notifications where tenant_id='$NTID' and event='bill_issued'")" "$NTOTAL"
  check "the due date is structured too" \
    "$(nq "select due_date from notifications where tenant_id='$NTID' and event='bill_issued'")" "$NDUEDATE"
  # The body still has to read like every other screen: ฿ with commas, and the
  # Buddhist year (2026 → 69).
  check "the body is written in ฿ and a Buddhist year" \
    "$(nq "select body LIKE '%฿%' and body LIKE '% 69%' from notifications where tenant_id='$NTID' and event='bill_issued'")" "t"
  check "the room number is the room, not a hardcoded one" \
    "$(nq "select body LIKE 'ห้อง $NROOMNO %' from notifications where tenant_id='$NTID' and event='bill_issued'")" "t"
  check "a bill is a message LINE may carry" \
    "$(nq "select line_status from notifications where tenant_id='$NTID' and event='bill_issued'")" "pending"

  # Idempotency (UNIQUE tenant/event/ref): the same bill cannot be announced
  # twice, so a retried batch or a double-clicked button is harmless.
  check "the same period billed twice → 409" \
    "$(postcode "/tenancies/$NTEN/invoices" "{\"billing_period\":\"$NPERIOD\"}")" "409"
  check "and the tenant is still told exactly once" \
    "$(nq "select count(*) from notifications where tenant_id='$NTID' and event='bill_issued'")" "1"

  # Rejection: the reason has to reach the person who has to send a new slip.
  NAMT=$(curl -s "$BASE/invoices/$NINV" -H "$AH" | jget ".invoice.amount_due")
  NPAY1=$(post "/invoices/$NINV/payments" "{\"amount\":$NAMT,\"payment_method\":\"cash\"}" | jget ".payment.id")
  curl -s -o /dev/null -X POST "$BASE/payments/$NPAY1/reject" -H "$AH" -H "$JH" -d '{"reason":"ยอดโอนไม่ตรง"}'
  check "a rejected slip tells the tenant why" \
    "$(nq "select body LIKE '%ยอดโอนไม่ตรง%' from notifications where tenant_id='$NTID' and event='payment_rejected'")" "t"
  # Rule 15: LINE carries amount and due date only, so a free-text reason is
  # never handed to it. The notice is still the record, in the app.
  check "a rejection is not a message LINE carries" \
    "$(nq "select line_status from notifications where tenant_id='$NTID' and event='payment_rejected'")" "skipped"
  check "and it carries no amount to carry" \
    "$(nq "select amount is null from notifications where tenant_id='$NTID' and event='payment_rejected'")" "t"

  # Verification: the receipt figure, ADR-009's frozen late fee included.
  NAMT2=$(curl -s "$BASE/invoices/$NINV" -H "$AH" | jget ".invoice.amount_due")
  NPAY2=$(post "/invoices/$NINV/payments" "{\"amount\":$NAMT2,\"payment_method\":\"cash\"}" | jget ".payment.id")
  curl -s -o /dev/null -X POST "$BASE/payments/$NPAY2/verify" -H "$AH" -H "$JH" -d '{}'
  check "verifying a slip confirms it to the tenant" \
    "$(nq "select count(*) from notifications where tenant_id='$NTID' and event='payment_verified'")" "1"
  check "the confirmed amount is what was actually settled" \
    "$(nq "select amount::float8 from notifications where tenant_id='$NTID' and event='payment_verified'")" "$NAMT2"
  # Two notices about the same invoice, keyed by their own payment — the
  # idempotency key is per thing, not per invoice.
  check "the rejection and the confirmation are both on file" \
    "$(nq "select count(*) from notifications where tenant_id='$NTID'")" "3"

  # S41: until Phase 1 this screen said "ส่งประกาศแล้ว" with nothing behind it.
  NANN=$(post /announcements "{\"title\":\"สโมค แจ้งเตือน\",\"body\":\"ทดสอบระบบแจ้งเตือน\",\"target_type\":\"floor\",\"target_floors\":[$NFLOOR]}" | jget ".announcement.id")
  check "an announcement reaches the people in the rooms it targeted" \
    "$(nq "select count(*) from notifications where tenant_id='$NTID' and event='announcement' and ref_id='$NANN'")" "1"
  check "it carries the words that were typed, not a template" \
    "$(nq "select title from notifications where tenant_id='$NTID' and event='announcement'")" "สโมค แจ้งเตือน"
  # Targeting is stored on the announcement as what was chosen; who was told is
  # stored here, one row per person, and stays true after they move out.
  check "one row per tenant told, not one per announcement" \
    "$(nq "select count(*) >= 1 from notifications where event='announcement' and ref_id='$NANN'")" "t"
  curl -s -o /dev/null -X DELETE "$BASE/announcements/$NANN" -H "$AH"
  check "unsending it does not unsay it" \
    "$(nq "select count(*) from notifications where event='announcement' and ref_id='$NANN' and tenant_id='$NTID'")" "1"

  # Rule 6.13 has to be unswitchable, not merely unswitched.
  check "in-app cannot be turned off — the DB has no value for it" \
    "$(psql "$DIRECT_URL" -At -c "insert into notification_prefs (tenant_id, channel, event) values ('$NTID','in_app','bill_issued')" 2>&1 | grep -c 'violates check constraint')" "1"
  check "LINE can be, per event" \
    "$(psql "$DIRECT_URL" -At -c "insert into notification_prefs (tenant_id, channel, event, enabled) values ('$NTID','line','announcement',false)" >/dev/null 2>&1; nq "select enabled from notification_prefs where tenant_id='$NTID' and channel='line' and event='announcement'")" "f"

  psql "$DIRECT_URL" -q -c "delete from notifications where event='announcement' and ref_id='$NANN'" >/dev/null 2>&1
fi

# --- reminders (Phase 4 of the LINE plan) -------------------------------------
# The due/overdue tick. Every assertion here is about a date boundary, so the
# section owns its own invoice and moves its due_date rather than waiting for
# the calendar — which is why it is --with-db only.
#
# The tick is driven explicitly through `npm run notify:tick`; the API's own
# timer is set to a day for this run, because a suite that races a timer is a
# suite that fails on a slow machine.
if run_section reminders && [ "$WITH_DB" = "1" ]; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }
  rq() { psql "$DIRECT_URL" -At -c "$1" 2>/dev/null; }
  tick() { npm run notify:tick --workspace=apps/api --silent 2>/dev/null | tail -1; }
  setdue() { psql "$DIRECT_URL" -q -c "update invoices set due_date = bangkok_today() + $1 where id = '$2'" >/dev/null 2>&1; }

  RPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  RTID=$(post /tenants "{\"full_name\":\"สโมคเตือน\",\"phone\":\"$RPHONE\"}" | jget ".tenant.id")
  RROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  RPERIOD="2026-03-01"
  RTEN=$(post /tenancies "{\"room_id\":\"$RROOM\",\"tenant_id\":\"$RTID\",\"start_date\":\"$RPERIOD\",\"agreed_months\":12,\"monthly_rent\":4500}" | jget ".tenancy.id")
  post "/tenancies/$RTEN/meter-readings" "{\"reading_period\":\"$RPERIOD\",\"readings\":[{\"meter_type\":\"electric\",\"old_reading\":100,\"new_reading\":150,\"confirm_opening\":true},{\"meter_type\":\"water\",\"old_reading\":10,\"new_reading\":18,\"confirm_opening\":true}]}" >/dev/null
  RINV=$(post "/tenancies/$RTEN/invoices" "{\"billing_period\":\"$RPERIOD\"}" | jget ".invoice.id")
  [ -n "$RINV" ] && ok "a bill to remind about" || bad "a bill to remind about"

  RLEAD=$(rq "select value from system_settings where key='due_reminder_days'")
  RTOTAL_BEFORE=$(rq "select total_amount from invoices where id='$RINV'")

  # 1. Not due yet, and outside the lead time: nobody is told anything.
  setdue "interval '$((RLEAD + 5)) days'" "$RINV"
  tick >/dev/null
  check "a bill outside the reminder window tells nobody" \
    "$(rq "select count(*) from notifications where tenant_id='$RTID' and event in ('due_reminder','overdue')")" "0"

  # 2. Inside the lead time.
  setdue "interval '$RLEAD days'" "$RINV"
  check "the tick reminds once inside the lead time" "$(tick | jget ".due_reminder")" "1"
  check "and the notice is the record (Rule 6.13)" \
    "$(rq "select count(*) from notifications where tenant_id='$RTID' and event='due_reminder'")" "1"
  check "it points at the invoice it is about" \
    "$(rq "select ref_id from notifications where tenant_id='$RTID' and event='due_reminder'")" "$RINV"
  # Rule 15: due_reminder is in LINE_CARRIES, so the copy is queued, not skipped.
  check "the LINE copy is queued" \
    "$(rq "select line_status from notifications where tenant_id='$RTID' and event='due_reminder'")" "pending"
  check "it carries the bill total, not a late fee" \
    "$(rq "select amount = total_amount from notifications n join invoices i on i.id = n.ref_id where n.tenant_id='$RTID' and n.event='due_reminder'")" "t"

  # 3. Idempotence is 009's unique key, not a "last run" timestamp — which is
  #    what makes an hourly tick, a restart mid-pass and two instances all safe.
  check "ticking again tells them nothing twice" "$(tick | jget ".due_reminder")" "0"
  check "and there is still exactly one notice" \
    "$(rq "select count(*) from notifications where tenant_id='$RTID' and event='due_reminder'")" "1"
  check "nothing is overdue yet" \
    "$(rq "select count(*) from notifications where tenant_id='$RTID' and event='overdue'")" "0"

  # 4. The day the ฿50/day starts. This boundary must agree with LIVE_LATE_FEE:
  #    on the due date itself the system charges nothing, so it says nothing.
  setdue "0" "$RINV"
  check "on the due date itself nobody is called late" "$(tick | jget ".overdue")" "0"
  setdue "-interval '1 day'" "$RINV"
  check "the day the late fee starts, they are told" "$(tick | jget ".overdue")" "1"
  check "ticking again does not nag" "$(tick | jget ".overdue")" "0"
  check "one overdue notice per bill, not per day late" \
    "$(rq "select count(*) from notifications where tenant_id='$RTID' and event='overdue'")" "1"

  # 5. "No cron for money" (CLAUDE.md), asserted rather than asserted-in-comment:
  #    the tick reads invoices and writes none of them. ADR-009's frozen fee is
  #    set at submission and by nothing else.
  check "the tick changed no money on the invoice" \
    "$(rq "select total_amount = $RTOTAL_BEFORE and late_fee_frozen is null from invoices where id='$RINV'")" "t"

  # 6. A tenant who has sent a slip is waiting on the OFFICE. Calling them late
  #    is the office's own delay landing on them.
  psql "$DIRECT_URL" -q -c "update invoices set status='pending_verification' where id='$RINV'" >/dev/null 2>&1
  psql "$DIRECT_URL" -q -c "delete from notifications where tenant_id='$RTID' and event='overdue'" >/dev/null 2>&1
  check "a bill awaiting verification is not chased" "$(tick | jget ".overdue")" "0"
  # A rejected slip means it is owed again, and that is worth saying.
  psql "$DIRECT_URL" -q -c "update invoices set status='rejected' where id='$RINV'" >/dev/null 2>&1
  check "a rejected slip puts the bill back in the chase" "$(tick | jget ".overdue")" "1"

  psql "$DIRECT_URL" -q -c "update invoices set status='unpaid' where id='$RINV'" >/dev/null 2>&1
fi

# --- tenant app (Phase 2 of the LINE plan) ------------------------------------
# The security boundary is what this section exists for. Both tokens are signed
# with the same JWT_SECRET, so `typ` inside the signature is the ONLY thing
# separating a tenant from every staff route — and "rejected" has to mean
# rejected, not "authenticated but found no permission". Both directions are
# asserted, because only one of them being wrong is exactly how this fails.
if run_section tenant; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }
  tq() { psql "$DIRECT_URL" -At -c "$1" 2>/dev/null; }

  TPHONE="09998$(printf '%05d' $((RANDOM % 100000)))"
  TTID=$(post /tenants "{\"full_name\":\"สโมคผู้เช่า\",\"phone\":\"$TPHONE\"}" | jget ".tenant.id")

  CODE=$(curl -s -X POST "$BASE/tenants/$TTID/link-code" -H "$AH" | jget ".link_code.code")
  check "staff can issue a link code" "$(printf '%s' "$CODE" | wc -c | tr -d ' ')" "6"
  check "the code uses the unambiguous alphabet" \
    "$(printf '%s' "$CODE" | grep -cE '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$')" "1"
  check "a worker cannot issue one" \
    "$(code -X POST "$BASE/tenants/$TTID/link-code" -H "Authorization: Bearer $WORKER")" "403"

  check "a wrong code is refused" \
    "$(code -X POST "$BASE/tenant/auth/redeem" -H "$JH" -d '{"code":"ZZZZZZ"}')" "400"

  TTOKEN=$(curl -s -X POST "$BASE/tenant/auth/redeem" -H "$JH" -d "{\"code\":\"$CODE\"}" | jget ".token")
  [ -n "$TTOKEN" ] && ok "a code redeems for a tenant session" || bad "a code redeems for a tenant session"
  TH="Authorization: Bearer $TTOKEN"

  # ADR-021: the code is a setup token, not a one-shot. This is the assertion
  # that changed from 010 — a tenant with a phone AND a laptop used to need two
  # codes, and so did a tenant who wanted both the app and LINE.
  check "the same code redeems again for a second device" \
    "$(code -X POST "$BASE/tenant/auth/redeem" -H "$JH" -d "{\"code\":\"$CODE\"}")" "200"

  # The two directions. Neither is implied by the other.
  check "a tenant token is refused by a staff route" "$(code "$BASE/rooms" -H "$TH")" "403"
  check "a tenant token is refused by the owner's verify queue" "$(code "$BASE/payments/pending" -H "$TH")" "403"
  check "a staff token is refused by the tenant app" "$(code "$BASE/tenant/me" -H "$AH")" "403"
  check "no token is refused by the tenant app" "$(code "$BASE/tenant/me")" "401"

  check "the tenant reads their own record" "$(curl -s "$BASE/tenant/me" -H "$TH" | jget ".me.full_name")" "สโมคผู้เช่า"
  check "the tenant's invoice list → 200" "$(code "$BASE/tenant/invoices" -H "$TH")" "200"
  check "a tenant with no tenancy sees no bills" \
    "$(curl -s "$BASE/tenant/invoices" -H "$TH" | jget ".invoices.length")" "0"

  # Someone else's bill is not "forbidden", it is not found — the tenant_id
  # predicate is in the WHERE clause, so the id in the URL is inert.
  OTHER_INV=$(tq "select id from invoices order by generated_at desc limit 1")
  if [ -n "$OTHER_INV" ]; then
    check "another tenant's bill → 404" "$(code "$BASE/tenant/invoices/$OTHER_INV" -H "$TH")" "404"
  fi

  check "the notification list → 200" "$(code "$BASE/tenant/notifications" -H "$TH")" "200"

  # Rule 15 / rule 6.13: the toggles are LINE-only, and the defaults shown are
  # the ones the Phase 3 sender will actually apply.
  check "bills default to on for LINE" \
    "$(curl -s "$BASE/tenant/notification-prefs" -H "$TH" | jget ".prefs.find(p=>p.event==='bill_issued').enabled")" "true"
  check "announcements default to off" \
    "$(curl -s "$BASE/tenant/notification-prefs" -H "$TH" | jget ".prefs.find(p=>p.event==='announcement').enabled")" "false"
  curl -s -X PUT "$BASE/tenant/notification-prefs" -H "$TH" -H "$JH" -d '{"event":"announcement","enabled":true}' >/dev/null
  check "a toggle is stored" \
    "$(curl -s "$BASE/tenant/notification-prefs" -H "$TH" | jget ".prefs.find(p=>p.event==='announcement').enabled")" "true"
  check "in-app has no togglable pref at all" \
    "$(curl -s "$BASE/tenant/notification-prefs" -H "$TH" | jget ".prefs.filter(p=>p.event==='in_app').length")" "0"

  # The desk's own view. Both badges are read from `tenants`, and the whole
  # point of migration 011 is that they move independently: this tenant has
  # redeemed in a browser and has no LINE account, so exactly one is true.
  LS=$(curl -s "$BASE/tenants/$TTID/link-status" -H "$AH")
  check "the app badge is lit by a browser redemption" "$(echo "$LS" | jget ".status.linked")" "true"
  check "the LINE badge is not lit by one" "$(echo "$LS" | jget ".status.line_linked")" "false"
  check "both redemptions were counted" "$(echo "$LS" | jget ".status.code_redemptions")" "2"

  # Issuing a second code revokes the first: two live codes for one person means
  # the older slip of paper still works and nobody knows who holds it. It is
  # REVOKED, not marked used — under 010 this set the same column the app badge
  # read, so re-issuing to a tenant who had lost their slip made them look
  # linked without anyone having opened anything.
  CODE1=$(curl -s -X POST "$BASE/tenants/$TTID/link-code" -H "$AH" | jget ".link_code.code")
  CODE2=$(curl -s -X POST "$BASE/tenants/$TTID/link-code" -H "$AH" | jget ".link_code.code")
  check "issuing a new code invalidates the previous one" \
    "$(code -X POST "$BASE/tenant/auth/redeem" -H "$JH" -d "{\"code\":\"$CODE1\"}")" "400"
  check "and the newest one still works" \
    "$(code -X POST "$BASE/tenant/auth/redeem" -H "$JH" -d "{\"code\":\"$CODE2\"}")" "200"

  # The owner's two new controls (S04/S44).
  BEFORE_EXP=$(curl -s "$BASE/tenants/$TTID/link-status" -H "$AH" | jget ".status.code_expires_at")
  AFTER_EXP=$(curl -s -X PATCH "$BASE/tenants/$TTID/link-code" -H "$AH" -H "$JH" -d '{"days":3}' | jget ".link_code.expires_at")
  [ -n "$AFTER_EXP" ] && [ "$AFTER_EXP" != "$BEFORE_EXP" ] &&
    ok "extending pushes the expiry out" || bad "extending pushes the expiry out"
  check "a worker cannot extend one" \
    "$(code -X PATCH "$BASE/tenants/$TTID/link-code" -H "Authorization: Bearer $WORKER" -H "$JH" -d '{"days":3}')" "403"

  check "revoking the live code → 200" \
    "$(code -X DELETE "$BASE/tenants/$TTID/link-code" -H "$AH")" "200"
  check "a revoked code no longer redeems" \
    "$(code -X POST "$BASE/tenant/auth/redeem" -H "$JH" -d "{\"code\":\"$CODE2\"}")" "400"
  # Revoking stops NEW devices; it is not a logout. The session already handed
  # out keeps working, which is what a tenant mid-look at their bill expects.
  check "revoking does not end an existing session" "$(code "$BASE/tenant/me" -H "$TH")" "200"
  check "revoking twice is a 404, not a silent success" \
    "$(code -X DELETE "$BASE/tenants/$TTID/link-code" -H "$AH")" "404"
  check "a worker cannot revoke one" \
    "$(code -X DELETE "$BASE/tenants/$TTID/link-code" -H "Authorization: Bearer $WORKER")" "403"

  # The session slides: a token older than a day comes back re-signed in
  # X-Tenant-Token, so a tenant who opens the app at all never has to come to
  # the office for another code. Asserted by minting an aged token with the
  # server's own secret — waiting a day is not a test.
  check "a fresh token is not re-signed" \
    "$(curl -s -o /dev/null -D - "$BASE/tenant/me" -H "$TH" | grep -ci '^x-tenant-token:')" "0"

  AGED=$(node -e "
    const jwt=require('jsonwebtoken');
    const iat=Math.floor(Date.now()/1000)-2*24*60*60;
    process.stdout.write(jwt.sign({sub:'$TTID',name:'สโมคผู้เช่า',typ:'tenant',iat},process.env.JWT_SECRET,{expiresIn:'30d'}));
  ")
  check "a day-old token still works" "$(code "$BASE/tenant/me" -H "Authorization: Bearer $AGED")" "200"

  # ADR-021 D4: sliding follows the TENANCY, so it has to be tested against a
  # tenant who actually lives here. This smoke tenant had no contract until now,
  # which is itself the negative case — asserted first, because it is the one
  # that silently regresses if the lookup is ever dropped.
  NOSLIDE=$(curl -s -o /dev/null -D - "$BASE/tenant/me" -H "Authorization: Bearer $AGED" \
    | tr -d '\r' | awk 'tolower($1)=="x-tenant-token:"{print $2}')
  [ -z "$NOSLIDE" ] && ok "a tenant with no contract does not slide" || bad "a tenant with no contract does not slide"

  TODAY=$(node -e "console.log(new Date(Date.now()+7*3600e3).toISOString().slice(0,10))")
  SROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  STNID=$(post /tenancies "{\"room_id\":\"$SROOM\",\"tenant_id\":\"$TTID\",\"start_date\":\"$TODAY\",\"agreed_months\":12,\"deposit_amount\":4500}" | jget ".tenancy.id")
  [ -n "$STNID" ] && ok "a contract for the sliding tests" || bad "a contract for the sliding tests"

  SLID=$(curl -s -o /dev/null -D - "$BASE/tenant/me" -H "Authorization: Bearer $AGED" \
    | tr -d '\r' | awk 'tolower($1)=="x-tenant-token:"{print $2}')
  [ -n "$SLID" ] && ok "an aged token is re-signed" || bad "an aged token is re-signed"
  [ "$SLID" != "$AGED" ] && ok "the re-signed token is a new one" || bad "the re-signed token is a new one"
  check "the slid token is itself a working session" \
    "$(code "$BASE/tenant/me" -H "Authorization: Bearer $SLID")" "200"
  # Sliding must not widen what the token may reach: it is the same claims,
  # re-dated, and a staff route still refuses it.
  check "the slid token is still tenant-only" "$(code "$BASE/rooms" -H "Authorization: Bearer $SLID")" "403"
  check "a staff token is never re-signed" \
    "$(curl -s -o /dev/null -D - "$BASE/rooms" -H "$AH" | grep -ci '^x-tenant-token:')" "0"

  # Move-out stops the slide but does NOT cut access off: the token already in
  # hand runs out on its own, so a former tenant can still read their last bill
  # and receipt. Rule 3 makes receipts permanent and rule 4 leaves them nothing
  # to owe, so there is nothing to hide from them — what stops is the renewal
  # that would otherwise keep an ex-tenant's session alive indefinitely.
  curl -s -o /dev/null -X POST "$BASE/tenancies/$STNID/end" -H "$AH" -H "$JH" -d '{}'
  ENDED_SLIDE=$(curl -s -o /dev/null -D - "$BASE/tenant/me" -H "Authorization: Bearer $AGED" \
    | tr -d '\r' | awk 'tolower($1)=="x-tenant-token:"{print $2}')
  [ -z "$ENDED_SLIDE" ] && ok "an ended contract stops the slide" || bad "an ended contract stops the slide"
  check "but the token already issued still reads their bill" \
    "$(code "$BASE/tenant/me" -H "Authorization: Bearer $AGED")" "200"

  if [ "$WITH_DB" = "1" ]; then
    # Expiry is the database's clause, not the API's — asserted by ageing a real
    # row rather than by trusting the interval arithmetic that wrote it.
    EXPCODE=$(curl -s -X POST "$BASE/tenants/$TTID/link-code" -H "$AH" | jget ".link_code.code")
    # Both columns move: `CHECK (expires_at > created_at)` rejects an update
    # that only drags the expiry backwards, and psql's error would go to
    # /dev/null — leaving a live code and a test that passes for no reason.
    psql "$DIRECT_URL" -q -c "update tenant_link_codes set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' where code = '$EXPCODE'" >/dev/null 2>&1
    check "an expired code is refused" \
      "$(code -X POST "$BASE/tenant/auth/redeem" -H "$JH" -d "{\"code\":\"$EXPCODE\"}")" "400"
    check "a code outside the alphabet cannot be stored" \
      "$(psql "$DIRECT_URL" -At -c "insert into tenant_link_codes (code, tenant_id, issued_by, expires_at) values ('abc123', '$TTID', (select id from users where role='admin' limit 1), now() + interval '1 hour')" 2>&1 | grep -c 'violates check constraint')" "1"
  fi
fi

# --- room transfer (S37) -----------------------------------------------------
# Never-violate rule 13 / Business Rules 10.1-10.4. The section walks one whole
# transfer because the parts only mean anything together: the contract stays,
# the rent stays, the meter chain has to follow the ROOM rather than the
# contract, and the month has to become billable only once BOTH rooms are read.
#
# That middle one is the reason this feature needed a migration. Every previous
# reading in the system is derived by walking tenancy_chain(), which is right
# for a renewal (006) and silently wrong the moment a contract spans two rooms:
# "the last reading on this chain" becomes a reading of a different physical
# meter. 012 moves the derivation into chain_previous_reading() and scopes it to
# the room.
if run_section transfer; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  XPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  XTID=$(post /tenants "{\"full_name\":\"สโมคย้ายห้อง\",\"phone\":\"$XPHONE\"}" | jget ".tenant.id")
  XPAIR=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s).rooms.filter(x=>x.rental_type==='monthly'&&x.status==='vacant');process.stdout.write([v[0].id,v[0].room_number,v[1].id,v[1].room_number].join('|'))})")
  XFROM_ID="$(echo "$XPAIR" | cut -d'|' -f1)"; XFROM_NO="$(echo "$XPAIR" | cut -d'|' -f2)"
  XTO_ID="$(echo "$XPAIR" | cut -d'|' -f3)";   XTO_NO="$(echo "$XPAIR" | cut -d'|' -f4)"
  XDAILY=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='daily').id")

  XPERIOD="2026-06-01"
  XDAY="2026-06-15"
  XTEN=$(post /tenancies "{\"room_id\":\"$XFROM_ID\",\"tenant_id\":\"$XTID\",\"start_date\":\"$XPERIOD\",\"agreed_months\":12,\"deposit_amount\":9000}" | jget ".tenancy.id")
  [ -n "$XTEN" ] && ok "a contract to move" || bad "a contract to move"

  # Rule 9: previous is auto-filled and locked. In the move-in month there is
  # nothing to fill it from, and ADR-008 says the opening comes off the meter.
  check "no previous reading in the move-in month" \
    "$(curl -s "$BASE/tenancies/$XTEN/transfer-preview" -H "$AH" | jget ".preview.previous_electric")" "null"
  check "so a transfer without the old room's opening is refused" \
    "$(postcode "/tenancies/$XTEN/transfer" "{\"to_room_id\":\"$XTO_ID\",\"transferred_on\":\"$XDAY\",\"closing_electric\":150,\"closing_water\":18,\"opening_electric\":500,\"opening_water\":60}")" "400"

  XBODY="{\"to_room_id\":\"$XTO_ID\",\"transferred_on\":\"$XDAY\",\"reason\":\"สโมค\",\"closing_electric\":150,\"closing_water\":18,\"opening_electric\":500,\"opening_water\":60,\"from_opening_electric\":100,\"from_opening_water\":10}"

  check "a daily room refuses a monthly contract → 409" \
    "$(postcode "/tenancies/$XTEN/transfer" "{\"to_room_id\":\"$XDAILY\",\"transferred_on\":\"$XDAY\",\"closing_electric\":150,\"closing_water\":18,\"opening_electric\":500,\"opening_water\":60,\"from_opening_electric\":100,\"from_opening_water\":10}")" "409"
  check "a closing below the opening is a typo → 400" \
    "$(postcode "/tenancies/$XTEN/transfer" "{\"to_room_id\":\"$XTO_ID\",\"transferred_on\":\"$XDAY\",\"closing_electric\":90,\"closing_water\":18,\"opening_electric\":500,\"opening_water\":60,\"from_opening_electric\":100,\"from_opening_water\":10}")" "400"
  # A transfer is recorded when it happens, not booked ahead: the readings in it
  # are of meters somebody is standing in front of.
  check "a future-dated transfer → 400" \
    "$(postcode "/tenancies/$XTEN/transfer" "{\"to_room_id\":\"$XTO_ID\",\"transferred_on\":\"2099-01-01\",\"closing_electric\":150,\"closing_water\":18,\"opening_electric\":500,\"opening_water\":60,\"from_opening_electric\":100,\"from_opening_water\":10}")" "400"
  check "a worker cannot move anyone" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/tenancies/$XTEN/transfer" -H "Authorization: Bearer $WORKER" -H "$JH" -d "$XBODY")" "403"

  XMOVE=$(post "/tenancies/$XTEN/transfer" "$XBODY")
  check "the transfer lands in the right billing period" "$(echo "$XMOVE" | jget ".transfer.billing_period")" "$XPERIOD"

  # Rule 13, the three things that must NOT have changed.
  XAFTER=$(curl -s "$BASE/tenancies/$XTEN" -H "$AH")
  check "same contract row (not a new one)" "$(echo "$XAFTER" | jget ".tenancy.id")" "$XTEN"
  check "rent unchanged even into another room" "$(echo "$XAFTER" | jget ".tenancy.monthly_rent")" "4500"
  check "deposit carried" "$(echo "$XAFTER" | jget ".tenancy.deposit_amount")" "9000"
  check "and the tenant is in the new room" "$(echo "$XAFTER" | jget ".tenancy.room_number")" "$XTO_NO"

  # The whole reason 012 exists: the next reading measures from the NEW room's
  # own opening, not from the dial they left behind.
  check "the meter chain follows the room, not the contract" \
    "$(curl -s "$BASE/tenancies/$XTEN/transfer-preview" -H "$AH" | jget ".preview.previous_electric")" "500"

  # Rule 10.3: the month is not complete until both rooms are read. Billing it
  # from the old room alone would under-charge, and a receipt makes that
  # permanent.
  check "the transfer month is not billable from one room → 400" \
    "$(postcode "/tenancies/$XTEN/invoices" "{\"billing_period\":\"$XPERIOD\"}")" "400"
  check "and the refusal names the room still to read" \
    "$(post "/tenancies/$XTEN/invoices" "{\"billing_period\":\"$XPERIOD\"}" | grep -c "$XTO_NO")" "1"
  check "nor is it offered on the ready list" \
    "$(curl -s "$BASE/invoices/ready?billing_period=$XPERIOD" -H "$AH" | jget ".ready.filter(r=>r.tenancy_id==='$XTEN').length")" "0"

  # No typed opening needed here: 012 supplies it from the transfer record, so
  # staff are not asked to remember a number from two weeks ago.
  check "the new room's reading needs no typed opening" \
    "$(postcode "/tenancies/$XTEN/meter-readings" "{\"reading_period\":\"$XPERIOD\",\"readings\":[{\"meter_type\":\"electric\",\"new_reading\":560},{\"meter_type\":\"water\",\"new_reading\":66}]}")" "201"
  check "now the month is billable" \
    "$(postcode "/tenancies/$XTEN/invoices" "{\"billing_period\":\"$XPERIOD\"}")" "201"

  XINV=$(curl -s "$BASE/invoices?billing_period=$XPERIOD" -H "$AH" | jget ".invoices.find(i=>i.tenancy_id==='$XTEN').id")
  XDETAIL=$(curl -s "$BASE/invoices/$XINV" -H "$AH")
  check "one bill, four utility lines — two rooms, two meters" \
    "$(echo "$XDETAIL" | jget ".utility_lines.length")" "4"
  check "each line says which room it is for" \
    "$(echo "$XDETAIL" | jget ".utility_lines.filter(l=>l.room_number).length")" "4"
  check "both rooms appear on the one bill" \
    "$(echo "$XDETAIL" | jget ".utility_lines.map(l=>l.room_number).filter((v,i,a)=>a.indexOf(v)===i).length")" "2"
  check "the bill knows the move happened" "$(echo "$XDETAIL" | jget ".transfers.length")" "1"
  # ฿9/unit electric, ฿25/unit water: old room 50 units + 8, new room 60 + 6.
  check "utilities are the sum of both periods (฿1,340)" \
    "$(echo "$XDETAIL" | jget ".invoice.utility_charge")" "1340"

  # The month's meters may already have been walked before the move. That
  # collides with the readings the transfer itself writes, and the generic
  # mapper would report it as "room occupied" — the wrong problem entirely.
  check "moving after the month is already read → 409" \
    "$(postcode "/tenancies/$XTEN/transfer" "{\"to_room_id\":\"$XFROM_ID\",\"transferred_on\":\"2026-06-20\",\"closing_electric\":600,\"closing_water\":70,\"opening_electric\":160,\"opening_water\":20,\"confirm_opening\":true}")" "409"
  check "and it says the meter is the problem, not the room" \
    "$(post "/tenancies/$XTEN/transfer" "{\"to_room_id\":\"$XFROM_ID\",\"transferred_on\":\"2026-06-20\",\"closing_electric\":600,\"closing_water\":70,\"opening_electric\":160,\"opening_water\":20,\"confirm_opening\":true}" | grep -c "จดมิเตอร์")" "1"

  # One move per contract per day (012's unique index): a second identical
  # transfer would make "which room were they in" unanswerable.
  check "the same move twice → 409" \
    "$(postcode "/tenancies/$XTEN/transfer" "{\"to_room_id\":\"$XFROM_ID\",\"transferred_on\":\"$XDAY\",\"closing_electric\":600,\"closing_water\":70,\"opening_electric\":160,\"opening_water\":20,\"confirm_opening\":true}")" "409"
fi

# --- renewal (S35) -----------------------------------------------------------
# --- line (Phase 3: the LINE channel) ----------------------------------------
# Nothing here can reach LINE: the API under test runs with LINE_DRY_RUN=1 and
# fake credentials, so `pushMessage` logs instead of sending. What is asserted
# is everything around the push — the signature, the binding, the preferences,
# the quota and the claim.
if run_section line; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }
  lq() { psql "$DIRECT_URL" -At -c "$1" 2>/dev/null; }
  # LINE signs the body it sent, so the signature is over these exact bytes.
  sign() { node -e "
    const c=require('crypto');
    process.stdout.write(c.createHmac('sha256','$SMOKE_LINE_SECRET').update(process.argv[1]).digest('base64'));
  " "$1"; }
  hook() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/line/webhook" -H "$JH" \
    -H "X-Line-Signature: $2" -d "$1"; }

  # Phase 5's staff surfaces. The link-code endpoints themselves are asserted in
  # the `tenant` section; what is new here is the owner's view of the channel.
  check "LINE usage is readable by the owner" "$(code "$BASE/reports/line-usage" -H "$AH")" "200"
  check "a worker cannot read it" "$(code "$BASE/reports/line-usage" -H "Authorization: Bearer $WORKER")" "403"
  check "it reports the cap the sender actually applies" \
    "$(curl -s "$BASE/reports/line-usage" -H "$AH" | jget ".usage.cap")" "300"
  check "and whether the channel is configured at all" \
    "$(curl -s "$BASE/reports/line-usage" -H "$AH" | jget ".usage.configured")" "true"
  check "the tenant register says who has LINE" \
    "$(curl -s "$BASE/tenants/directory" -H "$AH" | jget ".tenants.every(t=>'line_linked' in t)")" "true"

  BODY='{"events":[]}'
  check "the webhook refuses an unsigned request" "$(hook "$BODY" '')" "403"
  check "the webhook refuses a wrong signature" "$(hook "$BODY" 'ZGVhZGJlZWY=')" "403"
  # A signature over different bytes must fail: this is the check that catches a
  # webhook verifying `JSON.stringify(req.body)` instead of what LINE sent.
  check "a signature over other bytes is refused" "$(hook "$BODY" "$(sign '{"events":[{"type":"message"}]}')")" "403"
  check "a correct signature is accepted" "$(hook "$BODY" "$(sign "$BODY")")" "200"

  if [ "$WITH_DB" = "1" ]; then
    LPHONE="09997$(printf '%05d' $((RANDOM % 100000)))"
    LTID=$(post /tenants "{\"full_name\":\"สโมคไลน์\",\"phone\":\"$LPHONE\"}" | jget ".tenant.id")
    LUID="Usmoke$(printf '%08d' $((RANDOM % 100000000)))"

    # Binding: the same code the browser redeems, sent in the chat instead.
    LCODE=$(curl -s -X POST "$BASE/tenants/$LTID/link-code" -H "$AH" | jget ".link_code.code")
    MSG="{\"events\":[{\"type\":\"message\",\"replyToken\":\"smoketoken\",\"source\":{\"userId\":\"$LUID\"},\"message\":{\"type\":\"text\",\"text\":\"$LCODE\"}}]}"
    check "a signed message is accepted" "$(hook "$MSG" "$(sign "$MSG")")" "200"
    # The webhook answers LINE first and works afterwards, so poll rather than
    # assert immediately — asserting on the same tick tests the scheduler.
    for _ in $(seq 1 20); do
      [ "$(lq "select line_user_id from tenants where id='$LTID'")" = "$LUID" ] && break; sleep 0.5
    done
    check "sending the code in the chat binds the LINE account" \
      "$(lq "select line_user_id from tenants where id='$LTID'")" "$LUID"
    check "the binding records which LINE account used it" \
      "$(lq "select used_by_line_user_id from tenant_link_codes where code='$LCODE'")" "$LUID"

    # ADR-021: the same slip still works in the browser afterwards. Under 010 a
    # LINE bind spent the code, so a tenant who wanted both had to come back for
    # a second one — and the desk could not see that they had, because both
    # badges were derived from the one timestamp the bind had just set.
    check "the same code still links a device in the browser" \
      "$(code -X POST "$BASE/tenant/auth/redeem" -H "$JH" -d "{\"code\":\"$LCODE\"}")" "200"
    check "now both badges are true, from two columns" \
      "$(lq "select (app_linked_at is not null) and (line_user_id is not null) from tenants where id='$LTID'")" "t"

    # D5, the hazard multi-use created: while the code is still live, a SECOND
    # LINE account could otherwise send it and quietly take over where this
    # tenant's bill notices go. `uq_tenants_line_user` does not stop that — it
    # stops one account claiming two tenants, not two accounts claiming one.
    LUID2="Usmoke$(printf '%08d' $((RANDOM % 100000000)))"
    REDS=$(lq "select redemptions from tenant_link_codes where code='$LCODE'")
    MSG3="{\"events\":[{\"type\":\"message\",\"replyToken\":\"smoketoken\",\"source\":{\"userId\":\"$LUID2\"},\"message\":{\"type\":\"text\",\"text\":\"$LCODE\"}}]}"
    hook "$MSG3" "$(sign "$MSG3")" >/dev/null
    sleep 2
    check "a second LINE account cannot take over the binding" \
      "$(lq "select line_user_id from tenants where id='$LTID'")" "$LUID"
    # The refusal rolls back, so it must not even cost a redemption.
    check "and the refused attempt spent nothing" \
      "$(lq "select redemptions from tenant_link_codes where code='$LCODE'")" "$REDS"

    # One LINE account cannot claim two tenants (010's unique index). The second
    # tenant's code must survive the attempt — the whole statement rolls back.
    OTID=$(post /tenants "{\"full_name\":\"สโมคไลน์สอง\",\"phone\":\"09997$(printf '%05d' $((RANDOM % 100000)))\"}" | jget ".tenant.id")
    OCODE=$(curl -s -X POST "$BASE/tenants/$OTID/link-code" -H "$AH" | jget ".link_code.code")
    MSG2="{\"events\":[{\"type\":\"message\",\"replyToken\":\"smoketoken\",\"source\":{\"userId\":\"$LUID\"},\"message\":{\"type\":\"text\",\"text\":\"$OCODE\"}}]}"
    hook "$MSG2" "$(sign "$MSG2")" >/dev/null
    # A fixed wait, not a poll: the attempt rolls back in full, so there is no
    # row change to watch for — the assertion is precisely that nothing moved.
    sleep 2
    check "one LINE account cannot claim a second tenant" \
      "$(lq "select coalesce(line_user_id,'none') from tenants where id='$OTID'")" "none"
    check "and that tenant's code was not spent by the attempt" \
      "$(lq "select first_used_at is null from tenant_link_codes where code='$OCODE'")" "t"

    # --- the sender ---------------------------------------------------------
    # Rows are inserted directly: what is under test is delivery, not emission,
    # and the emit points already have their own section.
    # head -1: psql prints the INSERT command tag after the RETURNING row, and
    # an id with "INSERT 0 1" stuck to it is not a uuid — every later lookup
    # then returns empty and the assertions fail for the wrong reason.
    ins() { lq "insert into notifications (tenant_id, event, ref_id, title, body, amount, due_date, line_status)
                values ('$1', '$2', gen_random_uuid(), 'สโมค', 'สโมคทดสอบ', 4150, current_date + 5, 'pending')
                returning id" | head -1; }
    # The drain is its own process, so it needs the same fake credentials the API
    # got: without them `lineConfigured` is false, the sender returns
    # immediately, and every assertion below fails against a row still pending.
    LINE_ENV="LINE_CHANNEL_SECRET=$SMOKE_LINE_SECRET LINE_CHANNEL_ACCESS_TOKEN=smoke-access-token LINE_DRY_RUN=1"
    drain() { env $LINE_ENV npm run --silent line:drain --workspace=apps/api 2>/dev/null | tail -1; }

    N_BILL=$(ins "$LTID" bill_issued)
    N_ANN=$(ins "$LTID" announcement)
    NOLINE=$(post /tenants "{\"full_name\":\"สโมคไม่มีไลน์\",\"phone\":\"09997$(printf '%05d' $((RANDOM % 100000)))\"}" | jget ".tenant.id")
    N_NONE=$(ins "$NOLINE" bill_issued)

    OUT=$(drain)
    check "the drain ran in dry-run" "$(printf '%s' "$OUT" | jget ".dryRun")" "true"
    # Without this the suite can pass while doing nothing: an unconfigured
    # sender returns {sent:0} immediately, which looks like an empty queue.
    check "and it had credentials to send with" "$(printf '%s' "$OUT" | jget ".configured")" "true"
    check "a bill reaches a linked tenant" "$(lq "select line_status from notifications where id='$N_BILL'")" "sent"
    check "and it is stamped with when" "$(lq "select line_sent_at is not null from notifications where id='$N_BILL'")" "t"
    # The owner's default: announcements are off unless the tenant asks for them.
    check "an announcement is skipped by default" "$(lq "select line_status from notifications where id='$N_ANN'")" "skipped"
    check "a tenant with no LINE account is skipped, not failed" \
      "$(lq "select line_status from notifications where id='$N_NONE'")" "skipped"
    check "the skip says why" \
      "$(lq "select line_error is not null from notifications where id='$N_NONE'")" "t"

    # Opting in flips it — the pref is what the sender reads, not a constant.
    lq "insert into notification_prefs (tenant_id, channel, event, enabled) values ('$LTID','line','announcement',true)
        on conflict (tenant_id, channel, event) do update set enabled = true" >/dev/null
    N_ANN2=$(ins "$LTID" announcement)
    drain >/dev/null
    check "an announcement is sent once opted in" "$(lq "select line_status from notifications where id='$N_ANN2'")" "sent"

    # An event LINE may not carry is born skipped and never reaches the sender.
    N_REJ=$(lq "insert into notifications (tenant_id, event, ref_id, title, body, line_status)
                values ('$LTID','payment_rejected', gen_random_uuid(), 'สโมค','สโมคทดสอบ','pending') returning id" | head -1)
    drain >/dev/null
    check "an event LINE does not carry is skipped, never sent" \
      "$(lq "select line_status from notifications where id='$N_REJ'")" "skipped"

    # Nothing is sent twice: the drained rows are no longer pending.
    OUT2=$(drain)
    check "a second drain sends nothing" "$(printf '%s' "$OUT2" | jget ".sent")" "0"

    # The 300/month cap: skipped and recorded, not retried and not failed.
    N_CAP=$(ins "$LTID" bill_issued)
    env $LINE_ENV LINE_MONTHLY_PUSH_CAP=0 npm run --silent line:drain --workspace=apps/api >/dev/null 2>&1
    check "over the monthly cap is skipped, not failed" \
      "$(lq "select line_status from notifications where id='$N_CAP'")" "skipped"
    check "and the row says it was the quota" \
      "$(lq "select line_error like '%โควตา%' from notifications where id='$N_CAP'")" "t"

    # S41's "ส่ง LINE ด้วย" tick now decides the copy. Before Phase 5 the flag
    # was stored and ignored: every announcement was queued for LINE whatever
    # the office chose, and only the tenant's own preference could stop it.
    ANN_OFF=$(post /announcements '{"title":"สโมคไม่ส่งไลน์","body":"ทดสอบ","target_type":"all","send_line":false}' | jget ".announcement.id")
    ANN_ON=$(post /announcements '{"title":"สโมคส่งไลน์","body":"ทดสอบ","target_type":"all","send_line":true}' | jget ".announcement.id")
    check "an announcement sent without the LINE tick is skipped" \
      "$(lq "select count(*) from notifications where ref_id='$ANN_OFF' and line_status<>'skipped'")" "0"
    check "and one sent with it is queued" \
      "$(lq "select count(*) from notifications where ref_id='$ANN_ON' and line_status='skipped'")" "0"

    # Unfollow clears the binding so the sender stops spending quota on a phone
    # that blocked the account. The notifications themselves are evidence and stay.
    UNF="{\"events\":[{\"type\":\"unfollow\",\"source\":{\"userId\":\"$LUID\"}}]}"
    hook "$UNF" "$(sign "$UNF")" >/dev/null
    for _ in $(seq 1 20); do
      [ -z "$(lq "select line_user_id from tenants where id='$LTID'")" ] && break; sleep 0.5
    done
    check "unfollow unlinks the account" \
      "$(lq "select line_user_id is null from tenants where id='$LTID'")" "t"
    check "but the notifications it already had are untouched" \
      "$(lq "select line_status from notifications where id='$N_BILL'")" "sent"
  fi
fi

if run_section renewal; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  RSTART=$(node -e "const d=new Date(Date.now()+7*3600e3);d.setUTCFullYear(d.getUTCFullYear()-1);console.log(d.toISOString().slice(0,10))")
  RPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  RTID=$(post /tenants "{\"full_name\":\"สโมคต่อสัญญา\",\"phone\":\"$RPHONE\"}" | jget ".tenant.id")
  RROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  # A year ago for 6 months, and the rent was agreed BELOW the standard price —
  # so a renewal that silently used the room's current price would be visible.
  RTEN=$(post /tenancies "{\"room_id\":\"$RROOM\",\"tenant_id\":\"$RTID\",\"start_date\":\"$RSTART\",\"agreed_months\":6,\"deposit_amount\":9000,\"monthly_rent\":4200}" | jget ".tenancy.id")

  check "renewal preview → 200" "$(code "$BASE/tenancies/$RTEN/renewal" -H "$AH")" "200"
  check "preview shows today's standard price beside the contract's own rent" \
    "$(curl -s "$BASE/tenancies/$RTEN/renewal" -H "$AH" | jget ".tenancy.standard_rent > 0")" "true"
  check "the contract's own rent is 4200" \
    "$(curl -s "$BASE/tenancies/$RTEN/renewal" -H "$AH" | jget ".tenancy.monthly_rent")" "4200"
  check "not yet renewed" \
    "$(curl -s "$BASE/tenancies/$RTEN/renewal" -H "$AH" | jget ".tenancy.renewed_into")" "null"

  # A reading on the ORIGINAL contract, so the chain has something to continue.
  post "/tenancies/$RTEN/meter-readings" '{"reading_period":"2026-05-01","readings":[{"meter_type":"electric","old_reading":7000,"new_reading":7150,"confirm_opening":true}]}' >/dev/null

  RENEW=$(post "/tenancies/$RTEN/renew" '{"agreed_months":12}')
  NEWTEN=$(echo "$RENEW" | jget ".tenancy.id")
  [ -n "$NEWTEN" ] && ok "renew creates a contract" || bad "renew creates a contract"
  # Rule 4.8: a NEW row, linked — never an extension of the old one.
  check "the new contract points at the old one" "$(echo "$RENEW" | jget ".tenancy.previous_tenancy_id")" "$RTEN"
  check "the old contract is closed, not extended" \
    "$(curl -s "$BASE/tenancies/$RTEN" -H "$AH" | jget ".tenancy.status")" "ended"
  check "the old contract keeps its own rent (4200)" \
    "$(curl -s "$BASE/tenancies/$RTEN" -H "$AH" | jget ".tenancy.monthly_rent")" "4200"
  # Rule 5: เงินประกัน is carried, not collected again.
  check "the deposit is carried over (9000)" "$(echo "$RENEW" | jget ".tenancy.deposit_amount")" "9000"
  # A renewal must not quietly re-price the room to today's standard.
  check "the new contract keeps the agreed rent unless asked (4200)" \
    "$(echo "$RENEW" | jget ".tenancy.monthly_rent")" "4200"
  check "the new term is what was agreed now (12)" "$(echo "$RENEW" | jget ".tenancy.agreed_months")" "12"

  check "renewing the same contract twice → 409" "$(postcode "/tenancies/$RTEN/renew" '{"agreed_months":6}')" "409"
  check "the preview now shows the successor" \
    "$(curl -s "$BASE/tenancies/$RTEN/renewal" -H "$AH" | jget ".tenancy.renewed_into.id")" "$NEWTEN"
  check "a start date inside the old term → 400" \
    "$(postcode "/tenancies/$NEWTEN/renew" "{\"agreed_months\":6,\"start_date\":\"$RSTART\"}")" "400"

  # The bug the browser pass found: meter readings are keyed by tenancy and a
  # renewal is a new tenancy, so without the chain the same tenant looked like a
  # new move-in the day their contract renewed — asked for an "opening" reading
  # and made to confirm it against their own previous close.
  check "after renewal the meter chain continues (no opening reading)" \
    "$(curl -s "$BASE/meter-readings/pending?reading_period=2026-06-01" -H "$AH" | jget ".tenancies.find(t=>t.tenancy_id==='$NEWTEN').meters.electric.is_opening")" \
    "false"
  check "and it continues from the previous contract's close (7150)" \
    "$(curl -s "$BASE/meter-readings/pending?reading_period=2026-06-01" -H "$AH" | jget ".tenancies.find(t=>t.tenancy_id==='$NEWTEN').meters.electric.previous_reading")" \
    "7150"
  # The server derives it, so a reading on the new contract needs no old value.
  check "a reading on the renewed contract derives its own previous → 201" \
    "$(postcode "/tenancies/$NEWTEN/meter-readings" '{"reading_period":"2026-06-01","readings":[{"meter_type":"electric","new_reading":7300}]}')" "201"

  # A renewal signed in advance is the room's active contract before it starts
  # (one active tenancy per room, so the old one closes at signing). Settling it
  # before that date must not write an end date earlier than its start.
  EARLY_OUT=$(post "/tenancies/$NEWTEN/checkout" '{"damage_amount":0,"cleaning_fee":0}')
  check "a not-yet-started renewal can still be settled → refund is its deposit" \
    "$(echo "$EARLY_OUT" | jget ".settlement.refund_amount")" "9000"

  if [ "$WITH_DB" = "1" ]; then
    # CHECK (end_date >= start_date) is the constraint this used to trip when a
    # renewal signed in advance was settled before its start date.
    check "the settled contract never ends before it begins" \
      "$(psql "$DIRECT_URL" -At -c "select (end_date >= start_date) from tenancies where id='$NEWTEN'")" "t"
    # The index that makes "which contract replaced this one" answerable.
    dup=$(psql "$DIRECT_URL" -At -c "insert into tenancies (room_id, tenant_id, start_date, deposit_amount, monthly_rent, agreed_months, previous_tenancy_id, created_by) select room_id, tenant_id, start_date + interval '3 years', 0, 1, 1, '$RTEN', created_by from tenancies where id='$NEWTEN'" 2>&1)
    case "$dup" in *duplicate*|*unique*) ok "the database refuses a second renewal of one contract" ;;
      *) bad "a second renewal was accepted ($dup)" ;; esac
    # Both contracts of the chain are closed now, and the room is free — never
    # two active rows at once, which is what the partial unique index guards.
    check "the room is left with no active contract, not two" \
      "$(psql "$DIRECT_URL" -At -c "select count(*) from tenancies where room_id='$RROOM' and status='active'")" "0"
  fi
fi

# --- move-out settlement (S27) -----------------------------------------------
if run_section checkout; then
  AH="Authorization: Bearer $ADMIN"
  JH='Content-Type: application/json'
  post() { curl -s -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  postcode() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  TODAY3=$(node -e "console.log(new Date(Date.now()+7*3600e3).toISOString().slice(0,10))")
  LAST_YEAR=$(node -e "const d=new Date(Date.now()+7*3600e3);d.setUTCFullYear(d.getUTCFullYear()-1);console.log(d.toISOString().slice(0,10))")

  # --- 1. a completed contract, settled with an ordinary refund
  CPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  CTID=$(post /tenants "{\"full_name\":\"สโมคย้ายออก\",\"phone\":\"$CPHONE\"}" | jget ".tenant.id")
  CROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  # Started a year ago for 6 months: the agreed term is over, so this is a
  # completed move-out and forfeiting must be refused.
  CTEN=$(post /tenancies "{\"room_id\":\"$CROOM\",\"tenant_id\":\"$CTID\",\"start_date\":\"$LAST_YEAR\",\"agreed_months\":6,\"deposit_amount\":9000,\"monthly_rent\":4500}" | jget ".tenancy.id")

  check "checkout preview → 200" "$(code "$BASE/tenancies/$CTEN/checkout" -H "$AH")" "200"
  check "a completed term is not early" \
    "$(curl -s "$BASE/tenancies/$CTEN/checkout" -H "$AH" | jget ".tenancy.is_early")" "false"
  check "cleaning fee comes from the owner's policy, not the code" \
    "$(curl -s "$BASE/tenancies/$CTEN/checkout" -H "$AH" | jget ".policy.cleaning_fee > 0")" "true"
  # Rule 12: forfeiting a contract that ran its course would be taking money
  # for nothing, and the server refuses it rather than trusting the screen.
  check "forfeit on a completed contract → 409" \
    "$(postcode "/tenancies/$CTEN/checkout" '{"forfeit_deposit":true,"forfeit_reason":"x"}')" "409"
  check "forfeit without a reason → 400" \
    "$(postcode "/tenancies/$CTEN/checkout" '{"forfeit_deposit":true}')" "400"

  SETTLE=$(post "/tenancies/$CTEN/checkout" '{"damage_amount":500,"cleaning_fee":300}')
  # 9000 deposit − 300 cleaning − 500 damage − 0 outstanding = 8200
  check "refund = deposit − cleaning − damage (8200)" "$(echo "$SETTLE" | jget ".settlement.refund_amount")" "8200"
  check "nothing was waived" "$(echo "$SETTLE" | jget ".settlement.excess_waived")" "0"
  check "the contract is closed by the same request" \
    "$(curl -s "$BASE/tenancies/$CTEN" -H "$AH" | jget ".tenancy.status")" "ended"
  check "settling twice → 409" "$(postcode "/tenancies/$CTEN/checkout" '{}')" "409"
  check "the settlement is readable back" \
    "$(curl -s "$BASE/tenancies/$CTEN/checkout" -H "$AH" | jget ".settlement.refund_amount")" "8200"

  # --- 2. rule 4: deductions above the deposit are waived, never collected
  DPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  DTID=$(post /tenants "{\"full_name\":\"สโมคหักเกิน\",\"phone\":\"$DPHONE\"}" | jget ".tenant.id")
  DROOM2=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  DTEN=$(post /tenancies "{\"room_id\":\"$DROOM2\",\"tenant_id\":\"$DTID\",\"start_date\":\"$LAST_YEAR\",\"agreed_months\":6,\"deposit_amount\":4000,\"monthly_rent\":4500}" | jget ".tenancy.id")
  OVER=$(post "/tenancies/$DTEN/checkout" '{"damage_amount":9000,"cleaning_fee":300}')
  check "refund floors at zero, never negative" "$(echo "$OVER" | jget ".settlement.refund_amount")" "0"
  # 9300 of deductions against a 4000 deposit: 5300 is shown struck through and
  # is not a debt anywhere in the system.
  check "the excess is recorded as waived (5300)" "$(echo "$OVER" | jget ".settlement.excess_waived")" "5300"

  # --- 3. early termination forfeits, with a reason
  EPHONE="09999$(printf '%05d' $((RANDOM % 100000)))"
  ETID=$(post /tenants "{\"full_name\":\"สโมคออกก่อน\",\"phone\":\"$EPHONE\"}" | jget ".tenant.id")
  EROOM=$(curl -s "$BASE/dashboard/rooms" -H "$AH" | jget ".rooms.find(x=>x.rental_type==='monthly'&&x.status==='vacant').id")
  ETEN=$(post /tenancies "{\"room_id\":\"$EROOM\",\"tenant_id\":\"$ETID\",\"start_date\":\"$TODAY3\",\"agreed_months\":12,\"deposit_amount\":9000,\"monthly_rent\":4500}" | jget ".tenancy.id")
  check "leaving inside the agreed term is flagged early" \
    "$(curl -s "$BASE/tenancies/$ETEN/checkout" -H "$AH" | jget ".tenancy.is_early")" "true"
  EARLY=$(post "/tenancies/$ETEN/checkout" '{"forfeit_deposit":true,"forfeit_reason":"ย้ายออกก่อนครบสัญญา"}')
  check "a forfeited deposit refunds nothing" "$(echo "$EARLY" | jget ".settlement.refund_amount")" "0"
  check "a forfeit is not counted as an excess deduction" "$(echo "$EARLY" | jget ".settlement.excess_waived")" "0"

  if [ "$WITH_DB" = "1" ]; then
    # Rule 4 in the schema, with the API removed: the generated column is what
    # makes a negative refund unrepresentable, not the endpoint above it.
    neg=$(psql "$DIRECT_URL" -At -c "select count(*) from deposit_settlements where refund_amount < 0")
    check "no settlement can hold a negative refund" "$neg" "0"
    # ADR-006: settlements are a record of money handed over.
    revoked=$(psql "$DIRECT_URL" -At -c "select has_table_privilege('amanew_app','deposit_settlements','UPDATE')")
    check "deposit_settlements is append-only for the app role" "$revoked" "f"
  fi
fi

# --- owner settings, rates, audit, directory ---------------------------------
# Everything here edits real configuration rows, so each check puts back what it
# changed: a smoke run must not leave the owner's price list different.
if run_section settings; then
  AH="Authorization: Bearer $ADMIN"
  SH="Authorization: Bearer $STAFF"
  JH='Content-Type: application/json'
  patchcode() { curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE$1" -H "$AH" -H "$JH" -d "$2"; }
  spatchcode() { curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE$1" -H "$SH" -H "$JH" -d "$2"; }
  jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+s+')')$1))}catch(e){}})"; }

  check "settings readable by staff → 200" "$(code "$BASE/settings" -H "$SH")" "200"
  check "the owner's 9 policies are seeded" \
    "$(curl -s "$BASE/settings" -H "$AH" | jget ".settings.length >= 9")" "true"
  check "staff cannot change a policy → 403" "$(spatchcode "/settings/due_day" '{"value":"7"}')" "403"
  check "a typed policy rejects a non-number → 400" "$(patchcode "/settings/due_day" '{"value":"เจ็ด"}')" "400"
  check "unknown policy key → 404" "$(patchcode "/settings/not_a_key" '{"value":"1"}')" "404"
  check "owner changes the due day → 200" "$(patchcode "/settings/due_day" '{"value":"7"}')" "200"
  check "the change is readable back" \
    "$(curl -s "$BASE/settings" -H "$AH" | jget ".settings.find(s=>s.key==='due_day').value")" "7"
  patchcode "/settings/due_day" '{"value":"5"}' >/dev/null  # put the owner's own value back

  check "utility rates list → 200" "$(code "$BASE/utility-rates" -H "$SH")" "200"
  check "exactly one current rate per meter" \
    "$(curl -s "$BASE/utility-rates" -H "$AH" | jget ".rates.filter(r=>r.is_current).length")" "2"
  check "staff cannot add a rate → 403" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/utility-rates" -H "$SH" -H "$JH" -d '{"meter_type":"water","rate":30,"effective_from":"2030-01-01"}')" "403"
  check "owner adds a future rate → 201" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/utility-rates" -H "$AH" -H "$JH" -d '{"meter_type":"water","rate":30,"effective_from":"2030-01-01"}')" "201"
  # UNIQUE (meter_type, effective_from): two rates cannot compete for one month.
  check "the same start date twice → 409" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/utility-rates" -H "$AH" -H "$JH" -d '{"meter_type":"water","rate":31,"effective_from":"2030-01-01"}')" "409"
  # A future rate must not become the current one just by existing.
  check "a 2030 rate is not today's rate" \
    "$(curl -s "$BASE/utility-rates" -H "$AH" | jget ".rates.find(r=>r.effective_from.slice(0,4)==='2030').is_current")" "false"

  # Rule 2, the version that would be expensive to get wrong: a standard price
  # change must not reach a contract that is already signed.
  RT=$(curl -s "$BASE/room-types" -H "$AH" | jget ".room_types.find(t=>t.type_key==='double').id")
  RT_OLD=$(curl -s "$BASE/room-types" -H "$AH" | jget ".room_types.find(t=>t.type_key==='double').default_rent")
  check "staff cannot change a standard price → 403" "$(spatchcode "/room-types/$RT" '{"default_rent":9999}')" "403"
  check "owner changes the standard price → 200" "$(patchcode "/room-types/$RT" '{"default_rent":9999}')" "200"
  check "and it says so: future contracts only" \
    "$(curl -s -X PATCH "$BASE/room-types/$RT" -H "$AH" -H "$JH" -d '{"default_rent":9999}' | jget ".affects")" \
    "future_contracts_only"
  curl -s -o /dev/null -X PATCH "$BASE/room-types/$RT" -H "$AH" -H "$JH" -d "{\"default_rent\":$RT_OLD}"
  check "the owner's price list is back" \
    "$(curl -s "$BASE/room-types" -H "$AH" | jget ".room_types.find(t=>t.type_key==='double').default_rent")" "$RT_OLD"

  check "audit log is owner-only → 403" "$(code "$BASE/audit-log" -H "$SH")" "403"
  check "the price change is in the audit log" \
    "$(curl -s "$BASE/audit-log?entity_type=room_type" -H "$AH" | jget ".entries.length > 0")" "true"
  check "the log records who did it" \
    "$(curl -s "$BASE/audit-log?entity_type=system_setting" -H "$AH" | jget ".entries[0].actor_name.length > 0")" "true"

  check "tenant directory → 200" "$(code "$BASE/tenants/directory" -H "$SH")" "200"
  # A partial phone, not a Thai name: curl would send the name's bytes
  # unencoded and the 400 would be the URL's fault, not the endpoint's.
  check "directory search accepts a partial phone" \
    "$(code "$BASE/tenants/directory?q=08000" -H "$SH")" "200"

  if [ "$WITH_DB" = "1" ]; then
    psql "$DIRECT_URL" -q -c "delete from utility_rates where effective_from = '2030-01-01';
      delete from audit_log where action in ('price_changed','rate_added','price_override');" >/dev/null 2>&1 &&
      ok "settings smoke data cleaned up" || bad "settings smoke data left behind"
    check "no stray rate left in the owner's table" \
      "$(psql "$DIRECT_URL" -At -c "select count(*) from utility_rates where effective_from = '2030-01-01'")" "0"
  fi
fi

# Both limiters still trip at whatever they are configured to — checked last,
# because they deliberately exhaust the allowance for the rest of the run.
for _ in $(seq 1 $((SMOKE_LOGIN_LIMIT + 5))); do last=$(code -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"phone":"0870000000","password":"x"}'); done
check "login rate limit → 429" "$last" "429"

# ADR-021 D6. The limiter is per-IP and every request in a run shares one key,
# so this has to come after the LINE section too — that section redeems in the
# browser to prove one code covers both. A seven-day multi-use window is not
# self-limiting the way 010's single-use 24 hours was, so guessing is bounded
# here instead of by the expiry.
for _ in $(seq 1 $((SMOKE_REDEEM_LIMIT + 5))); do last=$(code -X POST "$BASE/tenant/auth/redeem" -H 'Content-Type: application/json' -d '{"code":"ZZZZZZ"}'); done
check "link-code guessing is rate-limited → 429" "$last" "429"

[ -n "$API_PID" ] && kill "$API_PID" >/dev/null 2>&1

echo
echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ] || exit 1
