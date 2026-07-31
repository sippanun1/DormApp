# CLAUDE.md — Amanew Smart Management System

Property management system for one real customer: Amanew Residence, Sisaket (~60 rooms, monthly + daily rental, Thai-first). Current phase: **HTML design prototype** for the owner proposal — static HTML/CSS pages, no backend, no framework build step. Real implementation comes after owner approval.

## Read before doing anything

- `AMANEW_MASTER_DOCUMENT.md` — the single source of truth (as of 2026-07-31). Business rules, entity model, schema, API, screen inventory (§10), wireflow, component library, state model, phase map — everything, consolidated.
- `Amanew_Functional_Spec_v1.0.md` (`Page_Demo/`) and `Amanew_Design_Handoff_v1.0.md` — **archived**, superseded by the Master Document. Kept for historical reference only; where they conflict with the Master Document, the Master Document wins. `Amanew_Business_Rules_FINAL_1.md` is likewise archived (near-duplicate of the Functional Spec's Part A).

If behavior isn't in the Master Document: **ask, don't invent.** Open items are tracked in its own header (§0) and Phase Map (§16).

## Progress tracking (mandatory)

`PROGRESS.md` is the project's status board. **Every change to `/prototype/` updates PROGRESS.md in the same session — no exceptions:** flip screen statuses (⏳/🔨/✅/🔍), update the "Last updated" line and the current-state table, log any deviation from spec/handoff in the Decisions log (append-only, dated), and record new blockers. If you finish work without updating PROGRESS.md, the work isn't done.

## Deliverable: the design prototype

Static HTML pages in `/prototype/`, openable directly in a browser (double-click, no server, no npm). Purpose: the owner picks a style, then reviews the demo screens. Everything must look real — realistic Thai data, ฿ amounts, 60 rooms — but nothing needs to persist or compute.

```
/prototype/
  index.html            ← redirects to screens/s01-login.html
  menu.html             ← full screen index with pre-filled demo query params
  tokens.css            ← ALL three style token sets as CSS variables
  components.css        ← the 16 components (frozen — new styles go in screens/shared.css)
  switcher.js           ← the A/B/C style widget (no separate style-a|b|c folders exist)
  screens/              ← every screen, one file per ID: s##-kebab-name.html
    shared.css          ← supplementary styles components.css doesn't cover
    data.js             ← the single demo dataset every screen reads
    demo.js  role.js  nav.js
```

## Build order (mandatory)

**Steps 1–4 below are complete and the style question is settled** (Style A, with the A/B/C switcher kept live on every screen so the owner can still compare). The original brief's 17-screen scope is also long superseded: the owner has repeatedly extended it in review sessions and the build is now **36 screens, S01–S42**. Treat the list in `PROGRESS.md` as the authoritative inventory, not any number written in a spec.

1. ~~`tokens.css`~~ — done: three `[data-style="a|b|c"]` scopes, same variable names in each. Switching style = switching one attribute on `<body>`.
2. ~~`components.css`~~ — done and **frozen**: the 16 components from handoff §4, styled only through token variables. Add new styles to `screens/shared.css` instead; never edit `components.css`.
3. ~~The 3 dashboards~~ — done, then folded into the live switcher widget.
4. ~~STOP for the style decision~~ — resolved.
5. **Ongoing:** new screens are assembled from `components.css` + `shared.css`, read their data from `screens/data.js`, and link together with plain `<a>` hrefs that carry `location.search` through (the demo's role, style, banner and transfer state all ride in the query string — see PROGRESS.md for why).

## Prototype rules

- **Static first.** Plain HTML/CSS. Tiny vanilla JS allowed only where the demo needs it (wizard station switching, drawer open/close, tab switching, the live late-fee clock on S27). No React, no build tools, no localStorage.
- **Realistic Thai data everywhere** — names (คุณสมชาย, คุณมาลี), **60 rooms across 4 floors: 101–115 / 201–215 / 301–315 / 401–415** (an earlier draft of this file said 3 floors of 20; the build brief's 4×15 won and every screen assumes it), real amounts (฿3,500 fan / ฿4,500 aircon rent, **฿9/unit electric · ฿25/unit water**, ฿50/day late fee). All of it lives in `screens/data.js` — never hardcode a room number or amount into a screen.
- **S03 hard requirement:** all ~60 rooms visible without scrolling at 1366×768.
- Desktop screens target 1366–1440px wide; phone screens (S29/S30 worker, S33/S34/S36/S38 tenant) render inside a 390px phone frame centered on the page. Touch targets on those are ≥44px, and primary actions are 52px buttons — never checkboxes.
- Every page header shows its screen ID (small, corner: "S03 · ผังห้อง") — reviewers reference IDs, never "the booking page."
- Google Fonts via CDN link: IBM Plex Sans Thai (A), Prompt + Sarabun (B), Noto Sans Thai (C).

## Never violate (design must reflect these; enforce server-side later)

1. **No partial payments** — an invoice settles in full or not at all; never show a partial-amount input.
2. **Contract rent frozen** for contract life; room default price affects future contracts only. No mid-contract rent edit UI exists.
3. **Late fee** ฿50/day from the 6th — shown as computed-live on unpaid bills, frozen into the bill at verification (receipts permanent).
4. **Deposit settlement floors at zero** — excess deductions shown struck-through, never collected ("ไม่เกิน"). No debt UI for former tenants.
5. **Two deposit species, never merged:** เงินประกัน (monthly, at contract) vs มัดจำกุญแจ (daily, at check-in).
6. **Permissions are per-person checkboxes, not roles** — the 7 role names are preset tick-combinations. Owner-only: settings, prices, staff, expense delete, audit log.
7. **Audit trail visible** where relevant: invoice edit history (tenant-visible), rent-override flag, deleted expenses struck-through.
8. **No-show is a manual staff action** with forfeit of whatever was paid (often ฿0) — never an automatic timer.
9. **Meter chain:** previous auto-filled + locked, current < previous rejected (rollover exception), broken meter → "ประมาณการ" flag, fresh reading at move-in.
10. **Room states fixed enum:** vacant-clean / occupied / vacant-dirty / cleaning / maintenance / blocked — S03 legend uses exactly these.
11. **Two independent room axes, never merged:** *rental type* (รายเดือน / รายวัน) decides which flow staff start; *room type* (❄ ห้องแอร์ / 🌀 ห้องพัดลม) decides price only. Standard prices live in S24 and nowhere else — no screen lets a price be typed from scratch, only overridden with a visible flag.
12. **Agreed stay duration is captured at signing** ("ตกลงอยู่กี่เดือน", Rule 4.12) and is what early termination is measured against. Renewal (Rule 4.8) is a *new contract* — never an extension — with the deposit carried over.
13. **Room transfer keeps the same contract:** new room number, **same rent** even into a pricier room type, deposit carried, and the transfer month bills utilities in two periods on one invoice (Rules 10.1–10.4).
14. **Worker screens carry no money and no parts.** Owner decision 2026-07-31 overrides Business Rule 11.2/11.3: parts are bought outside the system and are not tracked in it. Repair costs are entered directly in the cash book (S39).
15. **LINE is an optional copy, never the record.** In-app notification cannot be switched off (Rule 6.13 makes it the proof a tenant was told); LINE carries amount and due date only — never slips or personal data.

## Conventions

- **Thai UI, English code/comments.** Exact strings from handoff §6: ผังห้อง · จดมิเตอร์ · ค้างชำระ · รอตรวจสอบ · ชำระแล้ว · เกินกำหนด · จองแล้ว · รอโอนเงินประกัน · เริ่มเข้าอยู่ · แจ้งซ่อม/แจ้งทำความสะอาด/แจ้งย้ายออก · ริบเงินมัดจำ.
- **Money:** ฿ prefix, comma thousands (฿4,150), numeric only. **Dates:** Buddhist year (17 ก.ค. 69).
- **Phone = universal identifier.** Tenant login is phone + password; no email field for tenants anywhere.
- One semantic status color system across ALL screens — a color means the same thing everywhere (5 semantics: success/paid/clean · info/occupied · warning/pending/dirty · danger/overdue · neutral/blocked).
- Touch targets ≥44px on phone screens; nationality defaults ไทย on guest registration.

## Code phase (activate when implementation starts — not now)

Stack per Master Document §5-6: Next.js 14 + Tailwind + shadcn/ui / Express + TS / Supabase. The HTML prototype's tokens.css and component classes map 1:1 to the future Tailwind theme and shadcn component styling — build the prototype knowing it becomes the styling reference. The Postgres schema lives in the Master Document §4 — no standalone `amanew-schema.sql` file exists in this repo yet; when one is created, revalidate every table against the Master Document first. Overdue computed on read; no cron for money. Update this file with commands and env notes when the repo goes live; keep operational content under one page — specs stay in their own files.
