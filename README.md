# Amanew Smart Management System

Property management for **Amanew Residence, Sisaket** — a ~60-room dormitory renting both monthly (รายเดือน) and daily (รายวัน). Built for one real customer, Thai-first: every screen, label and receipt is in Thai, money is `฿` with comma thousands, and dates are Buddhist year (17 ก.ค. 69).

**🔗 Live design prototype: https://dorm-app-pied.vercel.app** — start at [`/menu.html`](https://dorm-app-pied.vercel.app/menu.html) for the full screen index with demo data pre-filled.

## What the system does

It replaces a paper-and-LINE workflow with one system covering the whole tenancy lifecycle:

- **Rooms** — a 60-room floor plan (101–115 / 201–215 / 301–315 / 401–415) with a fixed six-state model: vacant-clean · occupied · vacant-dirty · cleaning · maintenance · blocked.
- **Move-in** — monthly contracts (rent + เงินประกัน + agreed stay duration) and daily bookings (rate + มัดจำกุญแจ), including Hotel Act guest registration with no skip path.
- **Meters and billing** — a batch meter sheet for every pending room, then invoices at ฿9/unit electric and ฿25/unit water, issued singly or as a monthly batch run.
- **Payment** — the tenant submits a transfer slip; staff verify it. Verification is what makes money real: a payment appears in the profit book the moment its slip is verified.
- **Move-out** — settlement with deposit deductions that floor at zero, and early-termination forfeit measured against the agreed duration.
- **Tenant self-service** — bills, payment history, utility usage charts, repair requests and announcements, on a phone.

### Rules the design is built around

A handful of business rules constrain nearly every screen, and are enforced server-side rather than in the UI:

- **No partial payments.** An invoice settles in full or not at all — there is no partial-amount input anywhere.
- **Contract rent is frozen** for the life of the contract. Changing a room's standard price affects future contracts only; no mid-contract rent edit exists.
- **Late fee ฿50/day from the 6th**, computed live on unpaid bills and frozen into the invoice at verification, because receipts are permanent.
- **Two deposit species are never merged** — เงินประกัน (monthly, at contract) vs มัดจำกุญแจ (daily, at check-in).
- **Permissions are per-person checkboxes**, not roles; the seven role names are just preset tick-combinations.
- **A room transfer keeps the same contract** — same rent even into a pricier room type, deposit carried, and the transfer month bills two utility periods on one invoice.

## Repository layout

```
                              API, screen inventory, phase map
prototype/                  ← the approved design prototype, S01–S46 (frozen)
db/                         ← Postgres schema — the real schema source of truth
Page_Demo/                  ← archived specs, superseded by the Master Document
```

## Branches

| Branch | Contains | Deploys to |
|---|---|---|
| `main` | Everything — docs, `db/`, the real application as it gets built, and `prototype/` kept as the styling reference | — |
| `prototype` | The static design prototype for the owner to review | [dorm-app-pied.vercel.app](https://dorm-app-pied.vercel.app) |

`main` is a strict superset of `prototype`, so keeping prototype tweaks on the `prototype` branch means merging into `main` stays a fast-forward. The Vercel project builds from `prototype` with **Root Directory `prototype`**, Framework Preset **Other**, and no build command — it is plain HTML/CSS served as-is.

## Status

The owner **approved the design prototype on 2026-08-10**. The design phase is closed: `prototype/` (S01–S46, Style A) is frozen as the styling and behavior reference, and implementation has begun. Prototype screens change from here only when building the real screen proves one wrong.

The prototype is a demo — nothing persists and nothing computes. It runs with no server and no npm: clone the repo and open `prototype/index.html` in a browser.

## Stack (implementation)

Next.js 14 + Tailwind + shadcn/ui on Vercel · Express + TypeScript on Railway · Postgres and slip storage on Supabase — all in Singapore (`sin1`).

Two constraints that are easy to get wrong and expensive to fix:

- **No business rule lives in the Next.js layer.** It is UI plus a thin BFF; every rule above is enforced in Express, where role checks and database triggers back each other up.
- **Pin `Asia/Bangkok`** in Postgres and both services. Late fees start on the 6th and freeze into the invoice — a UTC service bills ฿50 early, and the error lands permanently on a receipt.

Schema setup and the migration ordering rule are in [`db/README.md`](db/README.md).

---

This is a code mirror. The project notes, the specification and the deployment
configuration live in the private repository and are deliberately not published here.
