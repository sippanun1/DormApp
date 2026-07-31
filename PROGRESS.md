# PROGRESS.md — Amanew Prototype Build Tracker

**Rule: every session that changes anything in `/prototype/` updates this file in the same change. No exceptions.** Keep it truthful, current, and short — this is the status board, not a diary. Rationale belongs in the decisions log at the bottom, condensed to what a future reader must actually know.

**Last updated: 2026-08-01** — Documentation pass: `CLAUDE.md` corrected to match the real build, `AMANEW_MASTER_DOCUMENT.md` §17 (Phase 1 Scope Delta) added for the 17 post-freeze screens, business-rule status changes marked inline, and this file restructured.

---

## Current state

**36 screens, all built and wired**, covering IDs S01–S42 (some IDs are in-page dialog/modal states of a parent file, not separate files). Verified by a Node syntax sweep of every `<script>` block, a link-integrity check across every screen and `menu.html`, a demo-data consistency check (every hardcoded room number resolves to a real room), and — since 2026-07-31 — a real headless-Chromium render pass.

`index.html` redirects to S01 login. `menu.html` is the full screen index with pre-filled demo query params.

### Staff & owner — desktop

| ID | File | Notes |
|---|---|---|
| S01 | `s01-login.html` | Admin/Staff, with the demo role picker |
| S02 | `s02-dashboard.html` | KPIs, quick actions, 60-room grid (แอร์/พัดลม + รายเดือน/รายวัน) |
| S03 | `s03-room-grid.html` | Two modes: Worker floor plan, and `?pick=monthly\|daily` picker that starts every check-in |
| S04 | `s04-room-detail.html` | 5 state branches + contract panel + every room action |
| S05+S06 | `s05-tenant-lookup.html` | Phone lookup; S06 = in-page match modal |
| S07 | `s07-new-tenant.html` | New tenant registration |
| S08+S09 | `s08-monthly-tenancy.html` | Monthly move-in: rent, **agreed months**, deposit. S09 = conflict dialog |
| S10+S11 | `s10-daily-booking.html` | Daily booking; rate read-only from room type. S11 = date conflict |
| S12 | `s12-guest-registration.html` | Hotel Act enforcement point — no skip path |
| S13+S14 | `s13-meter-reading.html` | **Batch sheet** for all pending rooms + single-room mode via `?room=`. S14 = duplicate dialog |
| S15 | `s15-meter-correction.html` | Admin only |
| S16 | `s16-invoice-confirmation.html` | Single-room invoice + **pre-issue line items / discounts** |
| S17 | `s17-batch-summary.html` | Monthly batch run with a confirm step |
| S18 | `s18-invoice-list.html` | |
| S19 | `s19-invoice-detail.html` | Live vs frozen late fee, edit history, two-period utilities |
| S20 | `s20-payment-submission.html` | Slip required for transfer/QR, optional for cash |
| S21 | `s21-verification-queue.html` | Admin only, oldest first |
| S22+S23 | `s22-verification-detail.html` | S23 = reject-reason modal |
| S24+S25 | `s24-room-settings.html` | **Standard prices (แอร์/พัดลม) + utility rates + all 60 rooms.** S25 = conflict dialog |
| S26 | `s26-staff-permissions.html` | Per-person checkboxes; presets only tick boxes |
| S27 | `s27-checkout-summary.html` | Move-out settlement, floor-at-zero, early-termination forfeit |
| S28 | `s28-today-frontdesk.html` | Arrivals, departures, pending verifications, **contracts expiring** |
| S31 | `s31-daily-calendar.html` | Concept — no per-day booking API in Phase 1 |
| S32 | `s32-inquiry-booking.html` | Concept — unbacked by any API, by design |
| S35 | `s35-contract-renewal.html` | Renewal = a new contract, deposit carried over |
| S37 | `s37-room-transfer.html` | Same contract, same rent, two-period meter |
| S39 | `s39-cash-book.html` | Income/expense; owner-only delete kept struck-through |
| S40 | `s40-reports.html` | 4 of the 8 §15 reports; printable |
| S41 | `s41-announcements.html` | Targeting, channels, read receipts |
| S42 | `s42-requests-inbox.html` | Tenant + worker requests → assign → creates the S29 task |

### Phone

| ID | File | Who |
|---|---|---|
| S36 | `s36-mobile-login.html` | Tenant + Worker (Staff/Admin stay on desktop) |
| S29 | `s29-worker-tasks.html` | Worker — no tenant names, no money |
| S30 | `s30-task-detail.html` | Worker — report only; no parts, no cost |
| S33 | `s33-tenant-home.html` | Tenant — bill, contract, requests |
| S34 | `s34-tenant-bill.html` | Tenant — breakdown + edit history |
| S38 | `s38-tenant-notifications.html` | Tenant — in-app (forced) + LINE opt-in |

### Shared infrastructure (`/prototype/screens/`)

- **`data.js`** — the single demo dataset: 60 rooms / 4 floors, room types + prices, utility rates (฿9/฿25), meter history, contracts, tenants, invoices, staff & permissions, worker tasks, cash book, requests. Also the URL-driven room transfer (see below) and `searchAll()` behind the topbar search.
- **`nav.js`** — injects the sidebar + topbar from `data-screen`/`data-title` on `<body>`; 8 nav items with live badge counts; global search; arrival banners. Phone and login screens skip the shell.
- **`demo.js`** — spinner submits, dialog/modal open-close with focus return, unsaved-changes guard, tab binding.
- **`role.js`** — `?role=admin|staff|worker` demo toggle; hides `[data-admin-only]`. An approximation of the checkbox permission model, which is fine for a static prototype.
- **`shared.css`** — everything `components.css` doesn't cover. **`components.css` is frozen — never edit it.**

---

## Open questions for the owner

1. **Does staff need to confirm a worker's completed job?** Business Rule 11.1 says no (no verified/closed state). S42 now exists, so adding it is a rules change only.
2. **Repair costs have no automatic capture** now that parts/cost are removed from S30 (owner decision). Is entering them directly in the cash book (S39) acceptable? Rules 11.2/11.3 are marked accordingly.
3. **Placeholder figures to replace with real ones:** ห้องแอร์ ฿4,500/เดือน · ฿600/คืน, ห้องพัดลม ฿3,500 · ฿450, and the 39/21 aircon/fan split.
4. Long-standing, neither blocking: §6.1 Hotel Act licence status, §6.2 PDPA retention.

**Not built, recommended in this order:** owner settings module (§17 — 17 policies still hardcoded) · tenant directory (§14) · audit log viewer · the remaining 4 reports · tenant-side renewal request · a real multi-period utility invoice model in the schema.

---

## Decisions & deviations log

Append-only going forward. **Entries before 2026-08-01 were condensed on 2026-08-01** — the original full-length entries remain in this file's git history if the reasoning behind an old decision is ever needed.

### 2026-07-28 — first build

- **Room-grid colours:** the frozen `components.css` ships 6 housekeeping states, but this build's model has 4 (`vacant/occupied/reserved` + rental type). Mapped onto existing classes rather than inventing CSS — `reserved`→`state-cleaning` is the one place a class name doesn't match its meaning.
- **4 floors × 15 rooms** (101–115 … 401–415) per the build brief, over CLAUDE.md's original 3 × 20. Every screen assumes it; CLAUDE.md corrected 2026-08-01.
- **4 nav items** per the build brief, over ADR-019's 6. Superseded three times since by owner requests — now 8.
- **S14/S15 skipped** as outside the literal 22-item brief despite being in the Master Document. Built 2026-07-31.

### 2026-07-30 — first owner review

- **Monthly vs daily made unmistakable:** relabelled the ambiguous quick action, added `--rental-monthly`/`--rental-daily` tokens (fixed across all 3 styles — an operational safety distinction, not a style choice), applied to shortcuts, room cards and tenant chips.
- **Competitor-pattern restyle** applied in place (mono font on numerics, darker sidebar, KPI accents) — deliberately *not* adopting the reference file's single-file router or its own tokens.
- **`index.html` now redirects to S01**; the full menu moved to `menu.html`.
- **S26 / S29 / S33 built** beyond the original scope at owner request; Design ID S22 renumbered to S26 to avoid colliding with this build's S22.
- **S04's "สิ้นสุดสัญญา" was wrong** (Rule 4.12 — contracts end by completion, early termination or absconding, never a button). Relabelled ย้ายออก and rescoped.
- **S18's two invoice buttons swapped emphasis** — the monthly batch is the common action and is now primary, with a real confirm step.
- **Room pickers added to S13/S16** — both previously jumped straight to room 105.
- **Demo-data audit** found three real bugs (a daily room given monthly utilities, two rooms contradicting screens that referenced them, a room number that doesn't exist). Fixed and verified with a Node script — re-run that check whenever a room number gets hardcoded.
- **Invoice editing added to S19** (Rules 6.5/6.15): named line items, signed amounts, visible edit history, unpaid invoices only.

### 2026-07-31 — owner review sessions (the bulk of the build)

**Spec reconciliation.** The Master Document froze "3 roles only" while every other source described per-person permission checkboxes. Confirmed with the owner: **checkboxes govern**; corrected the Master Document with a dated note rather than a silent edit. It became the primary source of truth; the three older files got ARCHIVED banners. CLAUDE.md's reference to a non-existent `amanew-schema.sql` removed.

**Screens completed from the inventory:** S03 (Worker), S14, S15, S27, S28, S30, S31, S32, S34 — plus S04's action wiring fixed (the invoice link went to an unfiltered list; room-type change was never linked; ย้ายออก was a `confirm()` stub).

**จดมิเตอร์ rebuilt as a batch sheet.** The old flow cost one page load per room for ~35 rooms a month. Now: every pending room as a row grouped by floor in walking order, previous readings locked, live per-row cost, **Enter walks down the column**, per-row save on blur so a half-walked floor is never lost, progress counter. Single-room mode kept behind `?room=` for deep links. ADR-015 (both utilities submit together per room) intact — the batch is many per-room submissions, not one transaction.

**Room-first check-in.** S05 previously offered a `<select>` of ~40 vacant rooms when reached without one. Replaced by S03's picker mode (eligible rooms clickable and priced, the rest dimmed, แอร์/พัดลม filter); S05 now shows the chosen room with a เปลี่ยนห้อง link. Phone stays the universal identifier but is no longer the front door — "find a person" moved to a **global topbar search** (room / name / phone digits / invoice number).

**Room type as a second axis.** ❄ ห้องแอร์ / 🌀 ห้องพัดลม drives price only; รายเดือน/รายวัน drives which flow staff start. Never merged in the UI. `defaultRent`/`defaultNightly` became getters resolving through the type's standard price, so every screen re-priced automatically. **S24 rebuilt** into standard-price cards + all 60 rooms in a filterable table; S08/S10 show rent/rate read-only with an Admin-only override that flags itself.

**Contract term (Rule 4.12).** `agreed_months` existed nowhere. Added to the data model with a `contractOf()` helper (end date, days/months left, 30-day renewal window). Captured on S08, shown on S04 and S33, enforced on S27 — where early termination forfeits the deposit outright rather than netting it off as a deduction.

**S35 ต่อสัญญา** (Rule 4.8): renewal is a new contract, never an extension — new start defaulting to the day after the current end, fresh term, optional new rent (the one legitimate moment it can change), deposit carried over read-only. Reachable from S04 and from S28's expiring-contracts list.

**S37 ย้ายห้อง** (Rules 10.1–10.4): same contract, **same rent even into a pricier room type** (stated on screen when the type changes), deposit carried, closing reading on the old room plus a fresh opening reading on the new one. The transfer month's invoice carries **two utility periods** against one room charge, rendered on both S19 and S34.

> **Mechanism worth knowing:** the prototype has no persistence (localStorage is forbidden), so S37 hands the move forward in the query string — `?transfer=from-to-day-oldE-oldW-newE-newW` — and `data.js` re-applies it on every load. Every link already carries `location.search`, so the moved tenancy and its split bill stay consistent for the rest of the demo. Reuse this for any future demo state that must survive navigation.

**Mobile pass.** S29's per-task checkbox became two 52px buttons (ส่งงาน / เสร็จเลย) with status filters. **S30 rewritten as ส่งงาน** — three status choices, photo, note; **parts and cost removed entirely** (owner decision overriding Rule 11.2). **S36 mobile login** added for tenant + worker. S33 gained the tenant's own contract panel.

**S38 การแจ้งเตือน** — LINE opt-in plus per-event toggles and a live message preview. In-app cannot be switched off (Rule 6.13 makes it the record that a tenant was told); LINE carries amount and due date only, never slips or personal data.

**Utility rates corrected to ฿9 / ฿25** — the customer's real tariff. The prototype had used ฿7.50/฿18.00 since the first build, inherited from an illustrative figure in the Master Document, while CLAUDE.md and Business Rules §17 both said ฿9/฿25 and the two had never been reconciled. Fixed at the source, and rates are now editable in S24 under the same "next cycle only, never retroactive" rule as room prices.

**Owner's own screens built:** **S39 บัญชีรายรับ-รายจ่าย** (cash book, not accrual; owner-only delete keeps the row visible struck-through with a reason, and every total filters deleted rows explicitly), **S40 รายงาน** (4 of 8 reports; the other 4 named on-screen rather than silently omitted), **S41 ประกาศ** (targeting all/floor/rooms, channel choice, read receipts per post).

**S42 เรื่องที่แจ้งเข้ามา** closed the last dead end: tenant requests (S33, previously an `alert()`) and worker reports (S30) now arrive somewhere. Assignment is what creates the task on the worker's phone (Rule 11.2). Statuses follow Rule 11.1 exactly — no verified/closed state invented.

**Browser QA became real.** A Chromium binary was available for the first time; rendered screenshots caught defects code review had missed — a wrong ฿9,969 total from a generated meter reading that disagreed with invoice #1042, a sticky bar hidden under the style switcher, indistinguishable ❄/🌀 icons at 11px, missing prices on picker cards, an always-visible confirm card, and a **timezone bug** where `toISOString()` filled every date input a day early in +07:00 (fixed with `isoDate()`/`parseISO()`; no `toISOString` calls remain anywhere).

### 2026-08-01 — documentation pass

- **`CLAUDE.md` corrected.** It still described a 17-screen deliverable behind `style-a|b|c/` folders that never existed in this build, told the reader to STOP at a style decision settled long ago, and specified 3 floors of 20 rooms. Now matches reality, and the never-violate list gained five rules earned in the review sessions (room-type axis · agreed months + renewal · transfer keeps rent · no money on worker screens · LINE is a copy, never the record).
- **`AMANEW_MASTER_DOCUMENT.md` §17 "Phase 1 Scope Delta" appended** rather than rewriting the frozen sections: the 17 post-freeze screens with their owners, the schema/API each implies (none exist in §4/§5 — agreed months, room-type prices, cash book, announcements, requests, notification prefs, multi-period utilities), the rules whose status changed, and the recommended order for what's left. The TOC points at it from the top so §10's staleness is discoverable.
- **`Amanew_Business_Rules_FINAL_1.md` marked inline:** 11.2 (parts/cost removed), 11.3 (rewritten — costs now entered directly in the cash book), 12.5 (LINE raised from optional add-on to built), 15.x (4 of 8 built), and 4.8 / 4.12 / 10.3 marked as built.
- **This file restructured** — screen table split by surface, open questions pulled to the top, decision entries condensed by date, and the runaway "Last updated" line (which had accumulated nine sessions of summaries) replaced with a single dated line.
