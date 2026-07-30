# CLAUDE.md — Amanew Smart Management System

Property management system for one real customer: Amanew Residence, Sisaket (~60 rooms, monthly + daily rental, Thai-first). Current phase: **HTML design prototype** for the owner proposal — static HTML/CSS pages, no backend, no framework build step. Real implementation comes after owner approval.

## Read before doing anything

- `Amanew_Functional_Spec_v1.0.md` — ALL business rules, entities, journeys, screen catalog (S01–S37), navigation. The single source of truth.
- `Amanew_Design_Handoff_v1.0.md` — per-screen content requirements (§3), component library (§4), the 3 style directions with full tokens (§5), Thai string glossary (§6).

If behavior isn't in the spec: **ask, don't invent.** Especially open items P3, D1–D3 (spec §19 / handoff §8).

## Progress tracking (mandatory)

`PROGRESS.md` is the project's status board. **Every change to `/prototype/` updates PROGRESS.md in the same session — no exceptions:** flip screen statuses (⏳/🔨/✅/🔍), update the "Last updated" line and the current-state table, log any deviation from spec/handoff in the Decisions log (append-only, dated), and record new blockers. If you finish work without updating PROGRESS.md, the work isn't done.

## Deliverable: the design prototype

Static HTML pages in `/prototype/`, openable directly in a browser (double-click, no server, no npm). Purpose: the owner picks a style, then reviews the demo screens. Everything must look real — realistic Thai data, ฿ amounts, 60 rooms — but nothing needs to persist or compute.

```
/prototype/
  index.html            ← menu page linking to everything below
  tokens.css            ← ALL three style token sets as CSS variables
  components.css        ← the 16 components, styled per token variables
  style-a/dashboard.html   ← S02 in Style A "Clean Professional"
  style-b/dashboard.html   ← S02 in Style B "Warm Thai"
  style-c/dashboard.html   ← S02 in Style C "Bold Operator"
  screens/              ← after owner picks: 17 demo screens in winning style
    s03-room-grid.html
    s07-move-in-wizard.html
    ... (one file per demo screen, named s##-kebab-name.html)
```

## Build order (mandatory)

1. **`tokens.css`** — three `[data-style="a|b|c"]` scopes, each defining the same variable names (`--bg`, `--surface`, `--border`, `--primary`, `--primary-soft`, `--text`, `--text-muted`, `--radius`, `--shadow`, plus the 5 semantic status colors). Token values verbatim from handoff §5. Switching style = switching one attribute on `<body>`.
2. **`components.css`** — the 16 components from handoff §4 (StatusBadge first — everything uses it), styled ONLY through token variables so they render correctly in all three styles. Class names = component names (`.status-badge`, `.room-card`, `.money-math-card`, `.meter-entry-row`, ...).
3. **The 3 dashboards** — S02 built three times with **identical data** (60 rooms, 47 occupied, 5 overdue, today's arrivals, income tiles). Only `data-style` differs. This is the owner's choice page; label each: A "เรียบ มืออาชีพ" · B "อบอุ่น ใช้ง่าย" · C "ทันสมัย จริงจัง".
4. **STOP.** Do not build past the style samples until told which style won. (Likely outcome per handoff: A or C for management, B for tenant/worker phone screens — hybrid is acceptable.)
5. **The 17 demo screens** in the winning style, content per handoff §3 table, assembled from components.css — no per-screen one-off CSS unless truly unique. Link screens together with plain `<a>` hrefs following the demo journeys (S25→S26, S09→S10→S13, S06→S07) so the owner can click through.

## Prototype rules

- **Static first.** Plain HTML/CSS. Tiny vanilla JS allowed only where the demo needs it (wizard station switching, drawer open/close, tab switching, the live late-fee clock on S27). No React, no build tools, no localStorage.
- **Realistic Thai data everywhere** — names (คุณสมชาย, คุณมาลี), rooms 101–120/201–220/301–320, real amounts (฿3,500 rent, ฿9/฿25 rates, ฿50 fees). Use the wireframe data from the handoff §3 descriptions.
- **S03 hard requirement:** all ~60 rooms visible without scrolling at 1366×768.
- Desktop screens target 1366–1440px wide; phone screens (S26 optional, S29/S30, S33/S34) render inside a 390px phone frame centered on the page.
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

## Conventions

- **Thai UI, English code/comments.** Exact strings from handoff §6: ผังห้อง · จดมิเตอร์ · ค้างชำระ · รอตรวจสอบ · ชำระแล้ว · เกินกำหนด · จองแล้ว · รอโอนเงินประกัน · เริ่มเข้าอยู่ · แจ้งซ่อม/แจ้งทำความสะอาด/แจ้งย้ายออก · ริบเงินมัดจำ.
- **Money:** ฿ prefix, comma thousands (฿4,150), numeric only. **Dates:** Buddhist year (17 ก.ค. 69).
- **Phone = universal identifier.** Tenant login is phone + password; no email field for tenants anywhere.
- One semantic status color system across ALL screens — a color means the same thing everywhere (5 semantics: success/paid/clean · info/occupied · warning/pending/dirty · danger/overdue · neutral/blocked).
- Touch targets ≥44px on phone screens; nationality defaults ไทย on guest registration.

## Code phase (activate when implementation starts — not now)

Stack per handoff §7: Next.js 14 + Tailwind + shadcn/ui / Express + TS / Supabase. The HTML prototype's tokens.css and component classes map 1:1 to the future Tailwind theme and shadcn component styling — build the prototype knowing it becomes the styling reference. `amanew-schema.sql` is a DRAFT predating Spec v1.0 — revalidate every table against the spec before migrating. Overdue computed on read; no cron for money. Update this file with commands and env notes when the repo goes live; keep operational content under one page — specs stay in their own files.
