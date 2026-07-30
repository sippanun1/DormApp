# PROGRESS.md — Amanew Prototype Build Tracker

**Rule: every session that changes anything in `/prototype/` MUST update this file in the same change. No exceptions. This file is how the project owner sees status at a glance — keep it truthful, current, and short.**

Last updated: 2026-07-30 — `index.html` changed from the screen menu to a redirect straight into S01 login (owner request); the full menu moved to `menu.html`. See Decisions log. **Full rebuild from scratch, superseding everything below the archive note.** All prior content in this file (layout-picker sets, old S02–S34 numbering, the 3-alternative-layouts-per-screen approach) described a previous design iteration that used a different screen numbering system and different UX patterns than `AMANEW_MASTER_DOCUMENT.md`. Per explicit instruction, `/prototype/screens/` was deleted entirely and rebuilt clean against the Master Document's Screen Inventory (§10) and Wireflow Specification (§11) — the old files were not modified or salvaged. `tokens.css`, `components.css`, `switcher.js`, `layout-switcher.js`, and `index.html` were kept/updated per instruction (`layout-switcher.js` is now dormant — no file in the rebuilt set matches its `s##-layoutN.html` detection pattern, which is expected and harmless).

---

## Current state

All 17 Phase-1 demo screens (per the build's 22-item list, where S06/S09/S11/S23/S25 are dialog/modal states of their parent screen rather than separate files) are built, wired together per the Wireflow Spec, and verified with a headless-browser sweep (Playwright, all 20 URL variants incl. every room state) — **zero console/page errors**.

| Design ID | File | Status |
|---|---|---|
| S01 | `screens/s01-login.html` | ✅ |
| S02 | `screens/s02-dashboard.html` | ✅ |
| S04 | `screens/s04-room-detail.html` | ✅ (5 state branches: vacant monthly/daily, occupied monthly/daily, reserved) |
| S05 + S06 | `screens/s05-tenant-lookup.html` | ✅ (S06 is the in-page match-confirmation modal) |
| S07 | `screens/s07-new-tenant.html` | ✅ |
| S08 + S09 | `screens/s08-monthly-tenancy.html` | ✅ (S09 is the in-page conflict dialog, Shift+submit demo trigger) |
| S10 + S11 | `screens/s10-daily-booking.html` | ✅ (S11 is the in-page conflict dialog, Shift+submit demo trigger) |
| S12 | `screens/s12-guest-registration.html` | ✅ (no skip path, inline required-field validation) |
| S13 | `screens/s13-meter-reading.html` | ✅ (batched electric+water, old_reading never pre-filled) |
| S16 | `screens/s16-invoice-confirmation.html` | ✅ |
| S17 | `screens/s17-batch-summary.html` | ✅ |
| S18 | `screens/s18-invoice-list.html` | ✅ |
| S19 | `screens/s19-invoice-detail.html` | ✅ (live vs. frozen late-fee label) |
| S20 | `screens/s20-payment-submission.html` | ✅ (slip required for transfer/qr, optional for cash) |
| S21 | `screens/s21-verification-queue.html` | ✅ (admin-only, oldest-first, >3-day red badge) |
| S22 + S23 | `screens/s22-verification-detail.html` | ✅ (S23 is the in-page reject-reason modal) |
| S24 + S25 | `screens/s24-room-settings.html` | ✅ (S25 is the in-page conflict dialog, Shift+submit demo trigger) |

`index.html` rewritten to link the new 17-file set (old links were 100% broken after the screens/ wipe).

## Infrastructure (`/prototype/screens/`, shared by all 17 screens)

- `data.js` — single source of demo data: 60 rooms / 4 floors, the fixed demo rooms (102/103/104/105/108) and Invoice #1042 exactly as specified in the build brief, plus a short invoice list backing S18/S21.
- `demo.js` — cross-cutting interaction helpers: primary-button spinner (no optimistic UI), dialog/modal open-close (Escape closes, focus returns to opener), unsaved-changes guard, tab switching.
- `role.js` — demo role switch (admin/staff/worker) via `?role=`, carried through every link; hides `[data-admin-only]` elements for non-admin.
- `nav.js` — injects the persistent shell (sidebar + topbar) via JS from a `data-screen`/`data-title` attribute on `<body>`, so all 17 screens share one nav definition instead of copy-pasted markup. Nav items: แดชบอร์ด · ใบแจ้งหนี้ · ตรวจสอบสลิป (admin-only) · ตั้งค่าห้อง (admin-only), with live badge counts. Also renders the `?banner=` success banner on arrival.
- `shared.css` — supplementary styles components.css doesn't cover (modal/dialog chrome, spinner, tab bar, room mini-grid, legend), token-variable-only.

## Decisions & deviations log (append-only)

- **2026-07-28** — Room grid color-coding: the Master Document's frozen `components.css` RoomCard only ships 6 housekeeping-era states (`vacant-clean/occupied/vacant-dirty/cleaning/maintenance/blocked`), but this build's actual room-occupancy model (State Model §13.5) is 4 states (`vacant/occupied_monthly/occupied_daily/reserved`) with no housekeeping states in Phase 1 scope. Mapped without inventing new CSS: `vacant`→`state-vacant-clean` (success), `occupied` (monthly or daily)→`state-occupied` (info) with the room-card's existing `.room-sub` subtitle distinguishing รายเดือน/รายวัน, `reserved`→`state-cleaning` (warning/dotted, closest existing "pending" semantic). Flagging this as the one place a literal class name (`cleaning`) doesn't match its reused meaning (`reserved`) — reused rather than added because the instruction was "use what exists, don't invent."
- **2026-07-28** — S14 (duplicate meter reading conflict) and S15 (meter correction form) exist in the Master Document's Screen Inventory (§10) as Phase-1 screens, but the build brief's explicit 22-item numbered list does not include them. Not built, per the literal build-brief scope — flagging in case this was an oversight in the brief rather than a deliberate cut, since the Master Document treats them as in-scope.
- **2026-07-28** — Master Document ADR-019 specifies a fuller sidebar (แดชบอร์ด / การจอง / ห้องพัก / ใบแจ้งหนี้ / ตรวจสอบสลิป / ตั้งค่า, 6 items) and a Quick Actions panel on the dashboard. The build brief explicitly states only 4 nav items (Dashboard | Invoices | Verify payments | Room settings). Built to the build brief's 4-item nav (the more specific, more recent instruction for this session), but kept a compact Quick Actions row on S02 since it's cheap and matches the frozen ADR without contradicting the 4-item nav rule.
- **2026-07-28** — Floor count: the build brief's S02 spec says "60 rooms across 4 floors" (101–115/201–215/301–315/401–415); `CLAUDE.md`'s original prototype-phase instructions say 3 floors (101–120/201–220/301–320). Built to the build brief's 4-floor figure as the more specific, active instruction for this rebuild.
- **2026-07-28** — Room-detail actions not in the 22-screen list (end tenancy, check-out, cancel booking, no-show) needed *some* wiring for S04 to be usable per its own spec ("View tenant info + ... + End tenancy" etc.), but none of them are separate screens in scope. Implemented as a native `confirm()` + redirect-with-success-banner rather than inventing new screen IDs or skipping the feedback requirement ("every action gives immediate visible feedback") entirely.

- **2026-07-30** — Owner feedback from demo review: "can we separate the daily and monthly?" — the S02 Quick Actions row had one ambiguous label ("+ เช็คอินใหม่") that didn't say monthly or daily, risking staff starting the wrong flow. Fixed: relabeled to "+ เช็คอินรายเดือน" / "+ จองห้องรายวัน" and gave them distinct accent colors (new tokens `--rental-monthly` indigo `#4F46E5` / `--rental-daily` amber `#EA580C` in `tokens.css`, fixed across all 3 styles rather than per-style, since this is an operational safety distinction, not a style choice; new `.btn-monthly`/`.btn-daily` classes in `components.css`). Extended the same accent to the S02 room-grid cards (`.room-card[data-rental="monthly"|"daily"]`, a colored top border) since they already carry an unused `data-rental` attribute and the owner asked for the monthly/daily distinction to hold "everywhere," not just the shortcuts. Did not touch S05/S08/S10/S12 — their monthly/daily identity is already unambiguous in context (dedicated screens/labels per flow).

- **2026-07-30** — Owner supplied `AMANEW_CLICKABLE_PROTOTYPE.html` (an English, single-file, ad-hoc-token reference build) plus 4 written "competitor pattern" descriptions (dashboard, check-in forms, data tables, verification detail) sourced from Horga/Cloudbeds/Little Hotelier and asked for these patterns in the prototype. Confirmed scope with owner: restyle the existing multi-file build in place, do not adopt the reference file's single-file `go()` router or its own color tokens (conflicts with the Thai-first, 3-style-token architecture this prototype is built on). Applied: (1) `--font-mono` token (IBM Plex Mono, added to all 17 screens' Google Fonts link) on every genuinely-numeric display — KPI numbers, room-card numbers, table money cells, meter previous/current/cost, invoice/verification totals — explicitly *not* applied to reused classes that also carry Thai text (`.mm-amount`, `.ic-total` label span) to avoid breaking Thai glyph rendering; (2) sidebar/topbar (`--chrome-bg`) darkened/tinted off the content background in Styles A and B so the sidebar reads as the visual anchor per the pattern brief (Style C was already dark, untouched); (3) `.kpi-tile` gained a left-border accent matching its status color (added a `kpi-warning` modifier, applied to S02's "จองแล้ว" tile to match the reserved/warning semantic used elsewhere); (4) `.data-table th` gained `text-transform:uppercase; letter-spacing` (a no-op on the all-Thai header text currently in use, harmless, keeps the rule general for any future Latin/numeric headers); (5) `.tenant-chip` gained `.monthly`/`.daily` color variants (reusing the existing `--rental-monthly`/`--rental-daily` tokens from the 07-30 decision above) and applied wherever a screen's flow is unambiguous (S04 room-detail's three tenant contexts, S05 match-modal via the `flow` query param, S08 monthly, S10/S12 daily). No visual regression testing was done via a real browser this session — no Chromium binary was available locally and installing one was out of scope; verified by code review only (token references resolve, no class collisions with Thai-text-bearing elements found).

- **2026-07-30** — Owner asked to drop `index.html`'s intro-header + full screen-menu as the landing experience and land directly on S01 login instead — a deviation from this file's own build-order rule ("index.html ← menu page linking to everything below"). Confirmed scope with owner before changing: kept the full menu (all screen links with pre-filled demo query params, useful for jumping into a specific room/invoice state without walking a flow) rather than deleting it, just moved it to `prototype/menu.html` (intro header text removed there too, replaced with a one-line "back to login" link). `index.html` is now a client-side redirect (`<meta http-equiv="refresh">` + fallback `<a>`, no JS dependency) straight to `screens/s01-login.html`; S01's existing submit handler already forwards into S02 dashboard with the chosen demo role, so no change was needed inside the login/dashboard screens themselves.

## Blockers / waiting on

None. All 17 screens build and link per the Wireflow Spec; no open owner decision blocks further Phase-1 prototype work. Two long-standing owner decisions remain open per the Master Document (§6.1 Hotel Act license status, §6.2 PDPA retention) — neither blocks this prototype, both are noted on file already.
