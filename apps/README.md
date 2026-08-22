# apps/ — the real system

Monorepo, npm workspaces. Run everything from the repo root.

```
apps/
  api/   Express + TypeScript  → Railway (Singapore).  ALL business rules live here.
  web/   Next.js 14 + Tailwind → Vercel (sin1).        UI plus a thin BFF, nothing more.
```

## First run

```bash
cp .env.example .env          # fill in Supabase + JWT_SECRET; TZ must be Asia/Bangkok
npm install
npm run db:migrate            # 001 then 002 — never 001 alone (db/README.md)
npm run db:test               # must print 26 PASS, 0 FAIL
npm run db:pull               # prisma db pull && prisma generate — queries only, never migrations
npm run seed                  # building, room types, 60 rooms, utility rates, dev users
npm run dev                   # api on :3001, web on :3000
```

Dev logins after seeding — `0800000001` admin · `0800000002` staff · `0800000003` worker,
password `amanew1234` (override with `SEED_PASSWORD`). These exist for local work only.

## The line between the two

Master Document §18.1: **no business rule is implemented in the Next.js layer.** Late fees,
the no-partial-payment rule, frozen contract rent, deposit floors, role checks — every one of
them is enforced in `apps/api`, where §5's role middleware and §4's database triggers back each
other up. A rule written into a Next.js route handler escapes both. `apps/web` renders and calls.

`apps/web`'s styling is the frozen prototype's Style A, token for token: `app/globals.css`
carries the variables from `prototype/tokens.css`, and `tailwind.config.ts` maps the theme onto
them. The prototype (`/prototype/`, S01–S46) stays the behavior reference — read the screen
there before building it here.
