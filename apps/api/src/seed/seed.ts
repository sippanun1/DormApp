/**
 * Week 1 seed — buildings, room_types, the 60 rooms, utility rates, and the
 * initial admin/staff/worker users. Reference data only: no tenants, no
 * tenancies, no invoices, no money.
 *
 *   npm run seed          (from the repo root)
 *
 * Idempotent — every insert is ON CONFLICT DO NOTHING/UPDATE against a real
 * unique constraint, so re-running it is safe and never duplicates a room.
 *
 * Written as SQL rather than Prisma model calls on purpose: db/migrations/ is
 * the source of truth for the schema, and the seed should break loudly if it
 * drifts from the SQL rather than silently following a stale pulled client.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '../env.js';

// DIRECT_URL, not the pooled one: an interactive transaction cannot survive
// pgbouncer's transaction-mode pooling, and this is an admin script run by hand
// — it has no reason to take a connection out of the app's pool.
const prisma = new PrismaClient({ datasourceUrl: env.DIRECT_URL });

// Only the two raw escape hatches are used here, so the transaction client is
// named by what it needs rather than by a generated type — this file has to
// typecheck before `prisma db pull` has ever been run.
type Tx = Pick<typeof prisma, '$executeRaw' | '$queryRaw'>;

// Owner decision 2026-08-04: the price axis is the bed. Every room is a ห้องแอร์.
const ROOM_TYPES = [
  { key: 'single', th: 'ห้องเตียงเดี่ยว', en: 'Single bed', bed: 'single', rent: 4500, nightly: 600 },
  { key: 'double', th: 'ห้องเตียงคู่', en: 'Double bed', bed: 'double', rent: 5000, nightly: 700 },
] as const;

const UTILITY_RATES = [
  { type: 'electric', rate: 9 },
  { type: 'water', rate: 25 },
] as const;

/**
 * The policies S43 owns. They live in the database rather than in code because
 * the owner changes them — CLAUDE.md's "policies that were hardcoded".
 * Seeded with the prototype's values so the real system starts where the
 * approved demo ended.
 */
const SETTINGS = [
  { key: 'bill_issue_day', value: '1', type: 'int' },
  { key: 'due_day', value: '5', type: 'int' },
  { key: 'due_reminder_days', value: '2', type: 'int' },
  { key: 'grace_days', value: '5', type: 'int' },
  { key: 'late_fee_per_day', value: '50', type: 'money' },
  { key: 'deposit_months', value: '2', type: 'int' },
  { key: 'key_deposit', value: '300', type: 'money' },
  { key: 'cleaning_fee', value: '200', type: 'money' },
  { key: 'renewal_notice_days', value: '30', type: 'int' },
  // How long a staff-issued link code stays usable (ADR-021 / migration 011).
  // Never past the end of the tenancy, whatever this says — the cap is a
  // trigger, not a convention.
  { key: 'tenant_link_code_days', value: '7', type: 'int' },
] as const;

// Dev credentials only. Production users are created by the owner on S26.
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'amanew1234';
const USERS = [
  { name: 'เจ้าของ (Owner)', phone: '0800000001', role: 'admin' },
  { name: 'พนักงานต้อนรับ (Staff)', phone: '0800000002', role: 'staff' },
  { name: 'ช่าง/แม่บ้าน (Worker)', phone: '0800000003', role: 'worker' },
] as const;

const BUILDING = 'Amanew Residence';

/**
 * The 60 rooms — 4 floors of 15: 101–115 / 201–215 / 301–315 / 401–415.
 *
 * Transcribed from the frozen prototype's dataset (prototype/screens/data.js)
 * so the real system and the reference describe the same building: 39 เตียงคู่ /
 * 21 เตียงเดี่ยว, 42 รายเดือน / 18 รายวัน.
 *
 * Listed room by room rather than regenerated from data.js's loop, because that
 * loop is not the whole story — the fixed demo scenarios below it reassign a
 * dozen rooms, and the loop alone yields 36/24. If these ever need to change,
 * change them here; a real building's floor plan is data, not a formula.
 *
 *   [room number, rental type: m|d, bed type: s|d]
 */
const ROOMS: [string, 'm' | 'd', 's' | 'd'][] = [
  ['101', 'm', 's'], ['102', 'm', 'd'], ['103', 'd', 's'], ['104', 'd', 'd'], ['105', 'm', 'd'],
  ['106', 'm', 's'], ['107', 'm', 's'], ['108', 'd', 'd'], ['109', 'm', 's'], ['110', 'm', 'd'],
  ['111', 'd', 's'], ['112', 'm', 's'], ['113', 'm', 's'], ['114', 'd', 's'], ['115', 'm', 'd'],
  ['201', 'd', 's'], ['202', 'm', 's'], ['203', 'm', 's'], ['204', 'd', 's'], ['205', 'm', 'd'],
  ['206', 'm', 's'], ['207', 'd', 's'], ['208', 'm', 's'], ['209', 'm', 's'], ['210', 'm', 'd'],
  ['211', 'm', 's'], ['212', 'm', 's'], ['213', 'd', 's'], ['214', 'm', 's'], ['215', 'm', 'd'],
  ['301', 'm', 'd'], ['302', 'm', 'd'], ['303', 'd', 'd'], ['304', 'm', 'd'], ['305', 'm', 'd'],
  ['306', 'd', 'd'], ['307', 'm', 'd'], ['308', 'm', 'd'], ['309', 'd', 'd'], ['310', 'm', 'd'],
  ['311', 'm', 'd'], ['312', 'm', 'd'], ['313', 'm', 'd'], ['314', 'm', 'd'], ['315', 'd', 'd'],
  ['401', 'm', 'd'], ['402', 'd', 'd'], ['403', 'm', 'd'], ['404', 'm', 'd'], ['405', 'd', 'd'],
  ['406', 'm', 'd'], ['407', 'm', 'd'], ['408', 'd', 'd'], ['409', 'm', 'd'], ['410', 'm', 'd'],
  ['411', 'd', 'd'], ['412', 'm', 'd'], ['413', 'm', 'd'], ['414', 'd', 'd'], ['415', 'm', 'd'],
];

function buildRooms() {
  return ROOMS.map(([number, rental, bed]) => ({
    number,
    rentalType: rental === 'd' ? ('daily' as const) : ('monthly' as const),
    typeKey: bed === 'd' ? ('double' as const) : ('single' as const),
  }));
}

async function main() {
  const rooms = buildRooms();

  // Hashing is deliberately slow — do it before the transaction opens, not
  // inside it, so it doesn't count against the transaction timeout.
  const hashes = new Map<string, string>();
  for (const u of USERS) hashes.set(u.phone, await bcrypt.hash(SEED_PASSWORD, 10));

  await prisma.$transaction(async (tx: Tx) => {
    // --- users -------------------------------------------------------------
    for (const u of USERS) {
      const hash = hashes.get(u.phone)!;
      await tx.$executeRaw`
        INSERT INTO users (name, phone, password_hash, role)
        VALUES (${u.name}, ${u.phone}, ${hash}, ${u.role})
        ON CONFLICT (phone) DO NOTHING`;
    }

    const [admin] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`;
    if (!admin) throw new Error('No admin user after seeding users');

    // --- building ----------------------------------------------------------
    await tx.$executeRaw`
      INSERT INTO buildings (name, address)
      SELECT ${BUILDING}, ${'อ.เมือง จ.ศรีสะเกษ'}
      WHERE NOT EXISTS (SELECT 1 FROM buildings WHERE name = ${BUILDING})`;

    const [building] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM buildings WHERE name = ${BUILDING} LIMIT 1`;
    if (!building) throw new Error('No building after seeding buildings');

    // --- room types (S24 is the only screen that changes these) -------------
    for (const t of ROOM_TYPES) {
      await tx.$executeRaw`
        INSERT INTO room_types (name_th, name_en, bed_type, type_key, default_rent, default_nightly)
        VALUES (${t.th}, ${t.en}, ${t.bed}, ${t.key}, ${t.rent}, ${t.nightly})
        ON CONFLICT (type_key) DO UPDATE
          SET name_th = EXCLUDED.name_th,
              name_en = EXCLUDED.name_en,
              default_rent = EXCLUDED.default_rent,
              default_nightly = EXCLUDED.default_nightly`;
    }

    const typeRows: { id: string; type_key: string }[] = await tx.$queryRaw`
      SELECT id, type_key FROM room_types WHERE type_key IS NOT NULL`;
    const typeId = new Map(typeRows.map((r) => [r.type_key, r.id]));

    // --- rooms -------------------------------------------------------------
    // All 60 in one statement. Sixty round trips to Singapore is several
    // seconds of latency for no reason, and it used to time the transaction out.
    const numbers = rooms.map((r) => r.number);
    const typeIds = rooms.map((r) => {
      const id = typeId.get(r.typeKey);
      if (!id) throw new Error(`Missing room_type ${r.typeKey}`);
      return id;
    });
    const rentalTypes = rooms.map((r) => r.rentalType);

    await tx.$executeRaw`
      INSERT INTO rooms (building_id, room_type_id, room_number, rental_type)
      SELECT ${building.id}::uuid, t.type_id::uuid, t.number, t.rental_type
      FROM unnest(${numbers}::text[], ${typeIds}::text[], ${rentalTypes}::text[])
           AS t(number, type_id, rental_type)
      ON CONFLICT (building_id, room_number) DO NOTHING`;

    // --- owner policies (S43) ----------------------------------------------
    // DO NOTHING, not DO UPDATE: re-running the seed must never quietly reset a
    // policy the owner has since changed.
    for (const s of SETTINGS) {
      await tx.$executeRaw`
        INSERT INTO system_settings (key, value, value_type, updated_by)
        VALUES (${s.key}, ${s.value}, ${s.type}, ${admin.id}::uuid)
        ON CONFLICT (key) DO NOTHING`;
    }

    // --- utility rates (฿9/unit electric · ฿25/unit water) ------------------
    for (const u of UTILITY_RATES) {
      await tx.$executeRaw`
        INSERT INTO utility_rates (meter_type, rate, effective_from, created_by)
        VALUES (${u.type}, ${u.rate}, DATE '2026-01-01', ${admin.id}::uuid)
        ON CONFLICT (meter_type, effective_from) DO UPDATE SET rate = EXCLUDED.rate`;
    }
  });

  const [counts] = await prisma.$queryRaw<{ rooms: bigint; users: bigint }[]>`
    SELECT (SELECT count(*) FROM rooms) AS rooms, (SELECT count(*) FROM users) AS users`;

  console.log(`Seeded: ${counts?.rooms ?? 0} rooms, ${counts?.users ?? 0} users.`);
  console.log(`Dev login — 0800000001 (admin) / 0800000002 (staff) / 0800000003 (worker), password "${SEED_PASSWORD}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
