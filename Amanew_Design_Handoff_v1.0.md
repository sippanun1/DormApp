# Amanew — Design & Build Handoff v1.0
### For developers and Claude Code (Figma MCP) · Companion to `Amanew_Functional_Spec_v1.0.md`

**Read this first:** `Amanew_Functional_Spec_v1.0.md` is the single source of truth for all business rules, entities, journeys, screens (S01–S37), and navigation. This document tells you how to turn it into Figma designs and, later, code. Never invent behavior — if it's not in the spec, ask.

---

## 1. What we are building

A property management system for **one real customer**: Amanew Residence, Sisaket — ~60 rooms, monthly + daily rental, Thai-language-first. Current deliverable: **a proposal**, whose centerpiece is a Figma prototype of the 17 demo screens. Code comes after the owner approves.

**One web codebase, four surfaces:**

| Surface | Device | Users | Home screen |
|---|---|---|---|
| Management Web | Desktop / tablet | Owner + staff (permission checkboxes, no fixed roles) | S02 Dashboard (owner) |
| Front Desk "Today" mode | Desktop / tablet | Reception-permission accounts | S25 Today Home |
| Worker | Phone | Maid, technician | S29 / S31 task list |
| Tenant | Phone (native app later, mobile web first) | Monthly tenants (phone + password login) | S33 Tenant Home |

Home is **permission-dependent** — same login page (S01), different landing.

---

## 2. Figma build order (for Claude Code + Figma MCP)

Work in this exact order. Do not draw screens before components exist.

1. **Page "00 Tokens"** — color styles, text styles, spacing scale for the chosen style (Section 5). Build all three style token sets initially.
2. **Page "01 Components"** — the 16 components (Section 4) as Figma components with variants. Status Badge first (everything uses it).
3. **Page "02 Style Samples"** — S02 Dashboard built **three times**, once per style direction (Section 5). This page is shown to the owner; he picks one.
4. **Page "03 Demo Screens"** — the 17 demo screens in the chosen style only, assembled from components. Frame names = `S03 Room Grid`, `S07 Move-in — Station 4`, etc. Desktop frames 1440×900; phone frames 390×844.
5. **Page "04 Flows"** — Figma prototype wiring for the three demo journeys: walk-in check-in (S25→S26→done), month-end (S09→S10→S13), move-in (S06→S07 stations).

**Naming convention everywhere:** screen IDs from the spec catalog (S01–S37). Component names exactly as in Section 4. All UI text in **Thai** (Section 6 has required strings).

---

## 3. The 17 demo screens — content requirements

Low-fi wireframes for most of these already exist (in the project conversation); this table is the binding content list. ✱ = wireframe exists, follow it.

| ID | Screen | Must contain |
|---|---|---|
| S01 | Login | Phone + password. No email field anywhere. |
| S02 | Dashboard | KPI tiles: occupancy, income today/this month, overdue count (links to S14), expected arrivals/move-ins today, pending actions from bell. |
| S03 ✱ | Room Grid | ALL ~60 rooms visible without scrolling (3 floors × 20 compact cards). Card = number + state + overdue dot only. Filter bar (type, state) + 4 KPI tiles + legend. States as distinct fills: vacant-clean, occupied, vacant-dirty (striped), maintenance (dashed), blocked. Click → S04 drawer. |
| S04 ✱ | Room Detail Drawer | Right-side panel over S03: tenant, contract summary, current bill + overdue, last meters + photo icon, deposit held, actions (bills/history, transfer, move-out, block). |
| S05 ✱ | Daily Calendar | Rooms × dates grid, one week visible. Bars: occupied (solid), advance booking (striped = free hold), maintenance. Click empty cell → new booking. Extension conflicts visible. |
| S06 ✱ | Inquiry Queue | Tabs: รายเดือน / รายวัน / หมดอายุ. Cards with lifecycle badges (ใหม่ → ติดต่อแล้ว → รอโอนเงินประกัน → จองแล้ว). Right panel: per-type availability math — ว่างตอนนี้ + กำลังจะว่าง − จองแล้ว = รับจองได้อีก. Source shown (โทร/FB/LINE/เว็บ/walk-in). Reserved-with-no-money is valid. |
| S07 ✱ | Move-in Wizard | 6-station stepper: ค้นหา (phone match → pre-fill) / เลือกห้อง (vacant-clean of promised type) / ข้อมูล+เงื่อนไข (ID, contacts, vehicles + agreed rent & duration — override needs permission flag) / เก็บเงิน (deposit − reservation money + prorated first month, live math) / มิเตอร์+รูป (fresh readings + photos) / สัญญา (print PDF). Auto-saves; resumable. Station 4 wireframe exists ✱. |
| S09 ✱ | Meter Walk | Table per floor: prev (locked, auto-chained) → current input → live units × rate → cost. Camera per reading. Progress "32/47". Guards: current<prev rejected; abnormal usage soft warning; broken meter → "ประมาณการ" flagged entry; vacant auto-skip. Enter advances rows. |
| S10 ✱ | Generate Bills | Completeness report: ready rooms (count + total + expandable breakdowns, tariff shown), missing-reading rooms with "เปิดจดมิเตอร์ →" shortcut, vacant excluded, already-billed (idempotent). Confirm button states delivery split: app (instant notify) vs paper (bulk print queue). |
| S13 ✱ | Verification Queue | Left: pending list (mixed types — bills, daily deposits). Right: slip image (zoomable) beside bill amount, amount-match check, transfer time, account. Verify (→ paid, late fee stops, receipt, notify) / Reject + reason (→ unpaid, tenant sees reason). Note QR payload stored (future SlipOK). |
| S22 ✱ | Staff & Permissions | Staff list + per-person checkbox matrix (~14 actions). Preset chips (ผู้จัดการ, ต้อนรับ, แม่บ้าน, ช่าง, บัญชี, มินิมาร์ท) = tick combinations. Owner-only rows visibly locked (delete expense, room default price, staff, settings, audit log). One person can be manager+reception. |
| S23 ✱ | Settings | The policy/pricing table, grouped: billing (due day 5, late fee ฿50/day, ไฟ ฿9, น้ำ ฿25 + ประวัติ link), reservation (hold 1 เดือน, expiry 14 วัน, no-show forfeit toggle), daily (checkout 13:00, ฿50/hr, grace 15 min, key deposit ฿500), cleaning/move-out (฿200, ฿300, renewal alert 30 วัน). Footer: historical-rates explanation in Thai. |
| S25 ✱ | Today Home | 3 columns: arrivals (monthly → "เริ่มเข้าอยู่" → S07; daily → "เช็คอิน" → S26; no-show inline โทร/ยกเลิก) + departures; center: big Walk-in button + availability BY ROOM NUMBER per type (incl. "รอทำ" rooms grayed); right: pending (slips, connection requests, move-out) + running cash total → reconciliation. |
| S26 ✱ | Daily Check-in | One screen: Hotel Act fields ONLY (name, ID, nationality **default ไทย**, address), phone returning-guest pre-fill, nights stepper, money breakdown card (room × nights + key deposit = one collect number), cash/transfer toggle, single confirm (records payment + registers + flips room). |
| S27 ✱ | Checkout Summary | Live late fee from clock (show math: time now, grace, hours × ฿50), key returned ✓/✗ (lost key → deduction + reason), damage add-line, net settlement (คืนแขก / เก็บเพิ่ม / สุทธิ), confirm → room vacant-dirty + cleaning task auto-created (state this on screen). |
| S29–S30 ✱ | Maid List + Task | List: today, hers, room + floor + type (เช็คเอาท์ ฟรี / ผู้เช่าสั่ง ฿200→บิล / ย้ายออก). Detail: checklist, finish photo, เสร็จแล้ว → vacant-clean, แจ้งซ่อม button inside task. Nothing else. |
| S33–S34 | Tenant Home + Bill | Home: current bill status card front-center (ยังไม่จ่าย / รอตรวจ / ชำระแล้ว / เกิน + live late fee), contract dates, shortcuts to requests/announcements. Bill: full breakdown (rent, ไฟ units×rate + meter photo link, น้ำ, line items, late fee), **"Pay Now" → QR appears → upload slip** (in that order), receipt after verify. |

Non-demo screens (S08, S11–S12, S14–S21, S24, S28, S31–S32, S35–S37): build after owner approval, reusing Table Pattern (S11/S14/S16/S18/S19/S24 are six configs of one table) and existing components. Content per spec Appendix C.

---

## 4. Component library (16 — build these first)

1. **StatusBadge** — one semantic color system for ALL lifecycles: success/paid/clean · info/occupied/active · warning/pending/dirty · danger/overdue/urgent · neutral/blocked. Variants: size (sm/md), semantic (5).
2. **RoomCard** — variants: grid-compact (~44px, number + state fill + overdue dot), picker (tappable, larger). 6 state fills.
3. **MoneyMathCard** — label/amount lines + divider + bold computed total. Variants: collect-today, checkout-settlement, deposit-settlement (floor-at-zero with struck excess), deposit-collection, bill-total.
4. **MeterEntryRow** — prev (locked) / current (input) / live cost / camera / estimate flag. Warning state.
5. **TablePattern** — FilterBar + search + columns + row → DetailDrawer. 6 configs.
6. **DetailDrawer** — right slide-over: header + StatusBadge, sections, action row.
7. **WizardStepper** — numbered stations, done/current/upcoming states, back/next footer with auto-save note.
8. **FormPattern** — labeled fields, inline validation, pre-fill highlight, smart defaults.
9. **TodayListItem** — who/what + room + time + one action button. Variants: arrival(monthly/daily), departure, pending-action, done (dimmed).
10. **TaskCard** — room + type badge + checklist + photo + done. Variants: maid, technician (+parts/cost).
11. **InvoiceBreakdownCard** — line items with units × rate shown, late fee line, StatusBadge, total.
12. **FilterBar** — chip filters + search.
13. **KPITile** — number + label + optional link arrow.
14. **PhotoAttachment** — capture/thumb/gallery + side-by-side compare variant (check-in vs checkout).
15. **TimelineLog** — timestamped who/what, before→after values.
16. **NotificationItem** — type icon + text + inline action (approve / open).

---

## 5. Three style directions (build S02 Dashboard in each — owner picks one)

All three share: Thai-first typography, the same semantic status colors (statuses must mean the same thing in every style), 8px spacing grid, WCAG AA contrast, generous touch targets (min 44px) on phone surfaces. Differences are personality, not information.

### Style A — "Clean Professional" (Horganice-familiar)
The safe, software-y choice. Feels like tools the owner may have seen.
- **Background** #FFFFFF · surface #F7F8FA · borders #E5E7EB
- **Primary** #2563EB (blue) · primary-soft #EFF6FF
- **Text** #111827 / #6B7280
- **Status:** success #16A34A · info #2563EB · warning #D97706 · danger #DC2626 · neutral #9CA3AF (soft backgrounds: 10% tints)
- **Type:** IBM Plex Sans Thai — headings 600, body 400; base 14px desktop / 16px phone
- **Shape:** radius 8px · 1px borders · shadows minimal (sm on drawers only)
- **Density:** compact — data-forward tables, thin rows
- **Feel:** Linear/Notion-adjacent; lets the data be the interface

### Style B — "Warm Thai" (LINE/Grab-familiar)
The friendly choice. Feels like consumer apps every Thai user already trusts. Recommended candidate for tenant + worker surfaces regardless of what wins on desktop.
- **Background** #FFFBF5 (warm cream) · surface #FFFFFF · borders #F0E6D9
- **Primary** #F97316 (warm orange) · primary-soft #FFF1E6
- **Text** #292524 / #78716C
- **Status:** same semantic hues as A but warmer tints (success #15803D, warning #B45309, danger #B91C1C on cream)
- **Type:** Prompt for headings (500/600), Sarabun for body; base 15px desktop / 16px phone
- **Shape:** radius 14px · borderless cards with soft shadows · pill buttons
- **Density:** roomy — bigger buttons, fewer items per view
- **Feel:** approachable, non-intimidating for ป้า-aged tenants and first-time staff

### Style C — "Bold Operator" (Stripe/Vercel-adjacent)
The impressive choice. Dark chrome, light content — reads "serious modern software" in a demo.
- **Chrome (sidebar/header)** #0F172A dark slate, white text · **content background** #F8FAFC · surface #FFFFFF
- **Primary** #0D9488 (teal) · primary-soft #F0FDFA
- **Text** #0F172A / #64748B
- **Status:** same semantics, saturated: success #059669 · warning #D97706 · danger #E11D48 · info #0284C7
- **Type:** Noto Sans Thai throughout; headings 700, tighter letter-spacing; base 14px
- **Shape:** radius 6px · strong contrast · shadows on interactive elements only
- **Density:** high — dashboard-heavy, KPI-forward
- **Feel:** the "this is a real system" demo effect; slight risk of intimidating non-tech staff

**Guidance for the sample page:** build S02 Dashboard three times with identical data (60 rooms, 5 overdue, today's arrivals). The owner comparison must be style-only. Note under each: A = "เรียบ มืออาชีพ", B = "อบอุ่น ใช้ง่าย", C = "ทันสมัย จริงจัง". Prior project learning: the user preferred Clean Minimal (A-type) in DormMatch — expect A or C for management, B is the strong candidate for tenant/worker phone surfaces (hybrid A+B or C+B is acceptable and common).

---

## 6. Thai language & content rules

- All UI text Thai; English only in this handoff and code. Key strings (use exactly): ผังห้อง · ปฏิทิน · จดมิเตอร์ · สร้างบิล · ตรวจสอบสลิป · ค้างชำระ · รอตรวจสอบ · ชำระแล้ว · เกินกำหนด · จองแล้ว · รอโอนเงินประกัน · เงินประกัน (monthly) vs มัดจำกุญแจ (daily — never merge terms) · แจ้งซ่อม · แจ้งทำความสะอาด · แจ้งย้ายออก · ต่อสัญญา · เริ่มเข้าอยู่ · เช็คอิน / เช็คเอาท์ · ริบเงินมัดจำ
- Currency: ฿ prefix, comma thousands (฿4,150). Dates: Thai Buddhist year in UI (17 ก.ค. 69).
- Money is never free text — numeric fields only.
- Nationality field defaults ไทย. Phone is the universal identifier (login, lookup, returning-guest match).

---

## 7. Tech stack (declared for the proposal — final after owner approval)

Frontend: Next.js 14 + Tailwind + shadcn/ui, Thai i18n, responsive (management desktop-first; worker/tenant mobile-first). Backend: Express + TypeScript. DB: Supabase Postgres (schema draft exists: `amanew-schema.sql`, 18 tables, EXCLUDE constraint on booking overlaps — revalidate against Spec v1.0 before use). Auth: phone+password (tenants), email allowed for staff. Files: Supabase storage (meter/slip/room photos — compress client-side). Notifications: in-app Phase 1 → native wrapper + push Phase 2+; LINE optional add-on. Slip verify: manual + stored QR payload (SlipOK-ready). Hosting target: Vercel + Render/Supabase free tiers for demo; cost sheet is a separate proposal artifact.

**Build rules for Claude Code (implementation phase):** enforce spec rules server-side, not just UI — no partial payments (reject amount ≠ invoice total), rent frozen per contract, late fee computed on read + frozen at verification, deposit settlement floored at zero, no collection beyond deposit, permission checks per action (not roles), audit log writes on: invoice edit/void, discount, rent override, refund/deduction, forfeiture, meter edit, expense edit/delete, permission change. Room states are a fixed enum; transitions only via the defined actions.

---

## 8. Open items (do NOT resolve by inventing)

- P3: owner's current paper contract (→ contract PDF template) and record book (→ migration source) — not yet seen. Design S07 station 6 as "print contract" placeholder.
- D1–D3 (spec §19): expense-delete final semantics, grace-period default, key deposit ฿500 confirmation. Defaults in S23 use current best values; mark editable.
- S33/S34 low-fi wireframes not yet drawn — content spec in Section 3 is binding; layout is Claude Code's to propose following Style B patterns.

*End of Handoff v1.0 — references Functional Spec v1.0. Update both together or not at all.*
