# Amanew Smart Management System — Business Rules (Canonical)
### Consolidated discovery output · Step 2 (Rules Freeze) · Merged final version

**Status legend:**
✅ **Confirmed** — stated by the owner directly
🟡 **Proposed** — our design decision, consistent with owner's answers, not explicitly confirmed
❓ **Pending** — awaiting owner answer

---

## 1. Scope & Business Model

| # | Rule | Status |
|---|------|--------|
| 1.1 | Single owner, single building (Amanew Residence, Sisaket, ~60 rooms), Phase 1. Multi-building is a declared future phase. | 🟡 |
| 1.2 | Two rental models operate side by side: **monthly rooms** and **daily rooms**. They remain separate business models with separate workflows. | ✅ |
| 1.3 | Rooms belong to exactly one room type: **Fan** or **Air-conditioned**. Each room has its own monthly price and daily price. No hybrid ("air installed, fan price") rooms. | ✅ |
| 1.4 | A room is rented either monthly or daily as configured; never both simultaneously for overlapping dates. | ✅ |
| 1.5 | Room attributes (floor, corner, balcony, bed type) are descriptive; price lives **on the room**, with the room type supplying defaults and search filters. | 🟡 |
| 1.6 | POS/minimart, stock, CRM/loyalty, AI insights, online lease signing, and hardware integrations (door locks, ID card reader, smart meters) are **later phases**, not Phase 1. | ✅ (owner deferred POS; rest 🟡) |

---

## 2. Roles & Permissions

| # | Rule | Status |
|---|------|--------|
| 2.1 | No fixed job roles. The owner creates staff accounts and assigns **permission checkboxes per person** (Horganice model). | ✅ (owner: "assign what they can do") |
| 2.2 | Rationale: in practice the manager and reception are often the same person. One person can hold any combination of permissions. | ✅ |
| 2.3 | The customer's original 7 roles (manager, reception, maid, minimart, accounting, technician + owner) exist as **preset permission templates**, not as system roles. | 🟡 |
| 2.4 | No separate accounting role — finance permissions (verify slips, record expenses, view reports) are ticked onto whichever staff handles money (usually the manager). Auto-verification API later reduces this workload. | ✅ |
| 2.5 | Owner-only permissions: system settings, prices/rates, staff account management, audit log access. | 🟡 (derived from "everything except settings" for manager) |
| 2.6 | Sensitive actions are individual permissions: verify payment, record cash payment, give discount, refund/deduct deposit, override contract rent, change room default price, edit tenant, transfer room, record/edit expense, delete expense (owner only), void invoice, mark no-show, edit meter readings, generate invoices, create booking, check-in/out, view financial reports, manage staff. | 🟡 |
| 2.7 | Tenants register with **phone number + password only** (no email). | ✅ (Horga pattern, user confirmed) |
| 2.8 | Tenant links to their room via a **connection request** approved by staff (notification bell). | 🟡 (adopted from Horga) |
| 2.9 | **Audit log** records: invoice edits/voids, discounts, rent overrides, refunds/deductions, forfeitures, meter edits, expense edits/deletions, permission changes — who/when/before/after. Owner-only access. | 🟡 |

---

## 3. Inquiry & Reservation (Monthly)

| # | Rule | Status |
|---|------|--------|
| 3.1 | Inquiry captures only: full name, phone, room type (Fan/Air), preferred move-in date, optional notes. No ID, no personal documents at this stage. | ✅ |
| 3.2 | Inquiries arrive via: walk-in, phone, Facebook, LINE, website. Source is recorded. | ✅ |
| 3.3 | Reservation is by **room type, not specific room number**. The actual room is assigned at move-in. | ✅ |
| 3.4 | Reservations are typically claims on **future vacancies** (current tenant has announced move-out). System must show per-type, per-date availability including upcoming vacancies. | ✅ (owner: "จองไว้คือผู้เช่าคนเก่ายังเช่าอยู่และย้ายออก") |
| 3.5 | Maximum reservation hold: **up to 1 month**, owner-adjustable setting. | ✅ |
| 3.6 | Reservation money is **optional**. Some reservations have a transferred amount, some have none. If money exists, record amount + slip + date; if not, the reservation is still valid. | ✅ ("บางทีอาจไม่มีการโอนเงินมาจอง") |
| 3.7 | If reservation money was paid and the customer **does not show up**, the money is **forfeited** (no refund). | ✅ |
| 3.8 | If no money was paid, a no-show simply cancels the hold — nothing to forfeit. | 🟡 (interpretation of "ถ้ามีการจอง...") |
| 3.9 | No-show is marked **manually by staff** (after follow-up contact; system reminds staff on the due date), never automatically by timer. | 🟡 |
| 3.10 | No-show is a **cancellation reason**, not a separate status. Cancellation reasons: customer cancelled / no-show / expired / staff cancelled. | 🟡 |
| 3.11 | Inquiry lifecycle: New → Contacted → Waiting for deposit → Reserved → Contract signed (move-in). Exits: cancelled, expired. Room viewing is recorded as a date/note, not a status. | 🟡 |
| 3.12 | Monthly inquiries with no progress expire after ~2 weeks (setting); expired inquiries remain visible as leads. Daily inquiries expire when the requested date passes. | 🟡 |
| 3.13 | Whether the reservation money is the full security deposit or a separate smaller amount: **flexible — treat as an optional numeric amount, "แล้วแต่ตกลง".** | ✅ (owner: "not sure / it's the same I think") |

---

## 4. Contract & Move-in (Monthly)

| # | Rule | Status |
|---|------|--------|
| 4.1 | The rental contract is created **in person on move-in day**, not at reservation. Reservation ≠ contract. | ✅ |
| 4.2 | At contract signing, staff collects: ID card data, full personal data, emergency contact, vehicle data, signature, **security deposit** (or remainder), and assigns the specific room. | ✅ |
| 4.3 | Move-in day also includes: initial meter reading (fresh starting point), check-in room photos, key handover. | 🟡 |
| 4.4 | New tenant **never pays for previous usage** — the fresh meter reading at check-in is their zero point. Gap usage (including daily guests before them) is the building's cost. | 🟡 |
| 4.5 | Contract rent is **frozen for the life of the contract**. Rent changes only at renewal. No mid-contract rent edits exist. | ✅ ("ไม่เปลี่ยน") |
| 4.6 | Room default rent (per room) is editable by the owner and applies to **future contracts only**. | 🟡 (consistent with 4.5) |
| 4.7 | Staff with permission may override rent at contract creation (negotiated rent); override is logged in the audit log. | 🟡 |
| 4.8 | Contract renewal = **a new contract** (new dates, possibly new rent; deposit carries over). No automatic month-to-month rollover. | ✅ ("ต่อสัญญาใหม่") |
| 4.9 | Renewal alert fires 30 days before expiry (setting) to both staff and tenant; tenant can request renewal from their app (symmetric with move-out request). | 🟡 |
| 4.10 | Occupants: one contract holder, additional occupants recorded (with vehicles) for registry purposes. | 🟡 |
| 4.11 | **No extra charge for additional occupants** — 1 person and 2 people pay the same rent. Occupant count never affects billing. | ✅ ("3,500 = 3,500") |
| 4.12 | **Early termination: security deposit is forfeited.** The commitment is the **stay duration agreed per tenant at signing** ("ตกลงกันก่อนว่าจะอยู่กี่เดือน") — agreed-months is a negotiated per-contract field, not a fixed template value. Leaving before the agreed duration forfeits the deposit. | ✅ |
| 4.14 | The building **cannot suspend a contract** — no suspension state exists. Contracts end by completion, early termination, or absconding only. | ✅ ("ไม่ได้") |
| 4.13 | Contract document: system generates a printable/PDF contract auto-filled with tenant data, based on the owner's existing paper contract. Online signing out of Phase 1. | ❓ (need to see current contract — P3) |

---

## 5. Daily Rooms

| # | Rule | Status |
|---|------|--------|
| 5.1 | Daily booking (advance) captures: name, phone, check-in date, nights, guest count, room type, optional requests. **No deposit collected before check-in.** Bookable via walk-in, phone, Facebook, LINE, website. | ✅ |
| 5.2 | Because no money changes hands before arrival, there is **no cancellation refund policy needed** for daily bookings — an advance booking is a free hold. (Festival-season deposit requirement = possible future policy toggle.) | ✅ (derived) + 🟡 note |
| 5.3 | If a paid amount ever exists on a daily booking and the guest no-shows, it is forfeited (same principle as monthly). | ✅ |
| 5.4 | **Room fee is paid in full at check-in**, together with the key deposit. Checkout settles only late fees / extras. | ✅ ("จ่ายตอนเข้า") |
| 5.5 | **Key/damage deposit** (e.g. ฿500 cash) is collected at check-in and returned at check-out, minus deductions. A different object from the monthly security deposit. | ✅ |
| 5.6 | Guest registration (ทะเบียนผู้พัก) captured at check-in: name, nationality, ID type/number, address, dates — per Thai Hotel Act. System provides a printable/exportable guest register; legal filing remains the owner's process. | 🟡 (legal requirement; output scope is our proposal) |
| 5.7 | Late checkout: charged **฿50/hour after 13:00**. | ✅ |
| 5.8 | Rounding for late checkout: implemented as a **grace period setting** (minutes) + per-hour charge, because the owner is undecided. | ✅ (owner: "make it an option") |
| 5.9 | Extending a stay **extends the existing booking** (nights +N, availability check, pay for added nights at extension) — never creates a second booking. Charged at the normal rate. If the room is taken for added dates, offer a transfer. | ✅ ("พักต่อจ่ายปกติ") |
| 5.10 | Early departure: no refund question exists — the guest paid at check-in and chooses to leave. | 🟡 (derived from 5.4) |
| 5.11 | Daily checkout triggers an automatic (non-billable) cleaning task; room goes vacant-dirty → cleaning → vacant-clean. | 🟡 |
| 5.12 | Daily-to-monthly conversion is **not a system flow** — it's a normal checkout followed by a normal monthly process; returning-person data is reused from history. | ✅ (user decision) |
| 5.13 | Double-booking is prevented at the system level (per-room date-range conflict check). | 🟡 |

---

## 6. Billing & Payments (Monthly)

| # | Rule | Status |
|---|------|--------|
| 6.1 | Rent is due **in full by the 5th of each month**. | ✅ |
| 6.2 | **No partial payments.** An invoice is either fully paid or unpaid. The system enforces full-amount settlement — no partial recording, no note-field workaround. | ✅ |
| 6.3 | Late fee: **฿50/day starting the 6th**, stops accruing when payment is verified. Configurable. | ✅ |
| 6.4 | Invoice composition: contract rent + electricity (meter) + water (meter) + one-time line items (charges/discounts) + late fee. **No recurring standing charges** — common fees/parking are bundled into the rent ("คิดรวมแล้ว"). | ✅ |
| 6.5 | Invoices support **flexible line items** — named charges and discounts, positive or negative amounts (e.g. cleaning ฿200, ส่วนลด −฿500). | ✅ (owner wants add charges + discounts) |
| 6.6 | Owner/manager can set a **custom message** printed on invoices and receipts. | ✅ |
| 6.7 | Invoice generation is two-step: enter readings → confirmation screen (ready rooms with breakdown / missing readings warned / vacant excluded) → generate only complete rooms. Missing rooms can be billed later individually. | 🟡 |
| 6.8 | Invoice lifecycle: Unpaid → (slip uploaded) Pending verification → Paid. Unpaid past due date → Overdue (flag computed on read, no cron). Void requires permission + reason + audit log. | 🟡 |
| 6.9 | Payment channels: bank transfer with slip upload (verified by staff with permission), or **cash at reception recorded by staff** (→ paid → receipt). Staff can record any payment on behalf of a tenant. | ✅ + 🟡 |
| 6.10 | Slip verification is **manual in Phase 1**. Slip image + QR payload are stored so automatic verification (e.g. SlipOK-type API) can be added later without rework. | ✅ (user decision) |
| 6.11 | Receipts (ใบเสร็จรับเงิน) are generated on verified payment; invoices (ใบแจ้งหนี้) and receipts are printable/PDF. | ✅ |
| 6.12 | **Bulk print** of a month's invoices exists as a first-class action — a significant share of tenants are paper tenants, and printed bills are their delivery channel. | 🟡 |
| 6.13 | Issuing a bill notifies the tenant (in-app bell Phase 1; native app push per committed plan). Tenant sees full breakdown + live status. | ✅ (app + notifications requested) |
| 6.14 | End-of-day **cash reconciliation**: daily cash summary per staff member vs recorded cash payments, owner sign-off. | 🟡 (fraud control) |
| 6.15 | Bill disputes are handled at the counter, not in-app. Staff can edit a bill (edit history visible to tenant); meter photos serve as evidence. Meter-entry errors self-correct over consecutive months via the reading chain. | ✅ (owner-style) + 🟡 |

---

## 7. Meters & Utilities

| # | Rule | Status |
|---|------|--------|
| 7.1 | Electricity billed by meter: staff enters previous/current readings; previous auto-fills from the last reading; current < previous is rejected; readings editable before billing. | ✅ + 🟡 |
| 7.2 | **Meter reading photo** captured as proof with each entry. | 🟡 (adopted from review) |
| 7.3 | Utility rates are stored **historically** (valid-from dates) so past invoices always reflect the rate in force at the time. | 🟡 |
| 7.4 | Broken/replaced meter: the month is billed on an **estimate from the previous month**, entered as a reading flagged "estimated" with a note visible in bill history. | ✅ ("คิดประมาณการจากเดือนก่อน") |
| 7.5 | Meter rollover (มิเตอร์เต็ม — wrap past maximum) is handled correctly. | 🟡 |
| 7.6 | Building-level PEA/water-authority bills are recorded as plain expenses. No tenant-vs-building utility reconciliation in Phase 1. | 🟡 |
| 7.7 | Billing supports prorate for mid-month move-ins, and prepaid/postpaid rent configuration. | 🟡 (Horga-pattern adoption) |
| 7.8 | Water billed by meter, same workflow as electricity. Rates: **water ฿25/unit, electricity ฿9/unit** — both changeable by the owner (historical rates per 7.3). | ✅ |

---

## 8. Deposits

| # | Rule | Status |
|---|------|--------|
| 8.1 | Two distinct deposit objects: **key deposit** (daily, at check-in, lives within one stay) and **security deposit** (monthly, at contract signing, held for the tenancy). Never merged. | ✅ |
| 8.2 | Security deposit is collected **at contract signing on move-in day** (reservation money, if any, is separate/optional per 3.6). | ✅ |
| 8.3 | Deposit liability report: the owner can see total deposits currently held across all rooms. | 🟡 |
| 8.4 | Forfeited money (no-show, early termination) converts from liability to **income** in the cash book. | 🟡 (accounting consequence) |

---

## 9. Move-out & Settlement (Monthly)

| # | Rule | Status |
|---|------|--------|
| 9.1 | Tenant submits move-out request from their app (or at counter); the request page displays an **owner-editable notice** (e.g. 30-day advance notice policy). | ✅ (user requested the note block) |
| 9.2 | Move-out flow: request → final meter reading scheduled → final bill incl. prorated days → room inspection with photos (compared against check-in photos) → deductions → settlement → cleaning task → room vacant. | 🟡 |
| 9.3 | Move-out cleaning fee: **starts at ฿300**, staff can increase for heavy dirt, with reason (and photos) required. | ✅ |
| 9.4 | On-time move-out settlement: deposit − cleaning − damages − unpaid amounts = refund of remainder. | ✅ |
| 9.5 | If deductions **exceed** the deposit: **CONTRADICTORY ANSWERS** — earlier "เก็บ" (collect the shortfall via final invoice + debt on record), later "ไม่เกิน" (deductions don't exceed / deposit is the cap). Needs one precise re-ask before this rule freezes. Design supports both: final-invoice feature exists if เก็บ; capped settlement if ไม่เกิน. | ❓ (P4) |
| 9.6 | Refund/deduction approval is a **permission** (default: owner + manager; owner can grant to others). | ✅ (user decision) |
| 9.7 | **Absconded tenant** (vanished owing money): staff marks tenancy absconded → deposit applied to debt → room photos → room vacant-dirty → tenant record flagged; visible if they ever return. Remaining debt persists on record. | 🟡 |
| 9.8 | Defaulters view includes **former tenants** with outstanding balances, not just current ones. | 🟡 (depends on P4 — moot if deposit is the cap) |

---

## 10. Room Transfer

| # | Rule | Status |
|---|------|--------|
| 10.1 | Tenant cannot transfer rooms by themselves — they must **contact staff**. Manager/owner initiates. | ✅ |
| 10.2 | Transfer keeps the **same contract** with a new room number. **Rent stays the same** ("คิดเท่าเดิม"). | ✅ |
| 10.3 | Utilities on transfer: final meter on the old room, fresh start on the new room; that month's bill shows two utility line items (old room dates / new room dates). | 🟡 |
| 10.4 | Deposit carries over with the contract. | 🟡 |

---

## 11. Maintenance & Cleaning

| # | Rule | Status |
|---|------|--------|
| 11.1 | Maintenance lifecycle: **Reported → Assigned → In Progress → Resolved.** No Verified/Closed states; no Waiting-Parts state — delays are recorded as notes. Timestamps on every transition. | 🟡 (Option B, agreed across reviews) |
| 11.2 | Tickets can be created by: tenants (app), maids (from their task screen), reception, manager, owner. Assignment to technician: manager/owner. Technician sees **assigned tickets only** and logs parts + cost. | ✅/🟡 |
| 11.3 | Repair costs logged on tickets are converted into cash-book expenses by staff with expense permission (single point of entry, no duplicates). | 🟡 |
| 11.4 | **Three cleaning types with different billing:** (a) checkout cleaning — automatic, free; (b) tenant-requested cleaning — **฿200/visit**, added to the next invoice; (c) move-out cleaning — **from ฿300**, deducted from deposit. The maid sees one unified task list; the system routes billing behind it. | ✅ |
| 11.5 | Maid flow: task list on phone → checklist → photo → done → room flips to vacant-clean. Maids can report issues found while cleaning. | ✅ (matches customer spec) + 🟡 |
| 11.6 | Room states kept minimal: vacant-clean, occupied, vacant-dirty, cleaning, maintenance, blocked/inactive. No Inspection or Transitioning states. | 🟡 |

---

## 12. Announcements & Communication

| # | Rule | Status |
|---|------|--------|
| 12.1 | Announcements target **all rooms or selected rooms**. | ✅ |
| 12.2 | Comments from tenants can be toggled on/off per post. | ✅ |
| 12.3 | Staff can see **which rooms have read** a post (read receipts). | ✅ |
| 12.4 | Post scheduling and post-editing rules: not in Phase 1. | 🟡 |
| 12.5 | Notifications to tenants: in-app (Phase 1) → native app push (committed direction). LINE integration listed as an optional add-on, not core. | ✅ (user decision) |

---

## 13. Expenses & Cash Book

| # | Rule | Status |
|---|------|--------|
| 13.1 | Framed as a **cash book (บัญชีรายรับ-รายจ่าย)** — money in vs money out — not accrual P&L. | ✅ (adopted; fits owner) |
| 13.2 | Expense fields: category, amount, date, payment method, description, optional receipt photo, recorded-by (automatic). | 🟡 |
| 13.3 | Categories: salary, water bill, electric bill, internet, repair, cleaning supplies, office supplies, misc — **owner can add categories**. | 🟡 |
| 13.4 | Record/edit expense = permission-gated (owner + granted staff). **Delete = owner only**, with deletion visible (struck-through/logged), never silent. | 🟡 (compromise position) |
| 13.5 | Income sources tracked: rent, daily rooms, cleaning service fees, late fees, forfeited deposits, **laundry income (manual daily entry)**, parking, other. | ✅/🟡 |
| 13.6 | Dashboard shows today's / this month's income, expenses, and net. | 🟡 |

---

## 14. Records, History & Tenant Directory

| # | Rule | Status |
|---|------|--------|
| 14.1 | Tenant directory keeps **current and past tenants** with full history; returning tenants reuse their data. Debt and abscond flags visible to staff. | ✅ + 🟡 |
| 14.2 | Vehicle data (plate, type, color) recorded per tenant/occupant, current and historical. | ✅ |
| 14.3 | Reservation/booking source recorded (walk-in / phone / Facebook / LINE / website). | ✅ |

---

## 15. Reports (Phase 1 proposed list)

| # | Report |
|---|--------|
| 15.1 | Daily summary: occupancy, check-ins/outs today, income today |
| 15.2 | Defaulters: who owes, how much, how long — including former tenants |
| 15.3 | Deposit liability summary |
| 15.4 | Cash reconciliation (daily, per staff) |
| 15.5 | Guest register (ทะเบียนผู้พัก) printable/exportable |
| 15.6 | Income–expense monthly summary |
| 15.7 | Occupancy & upcoming vacancies |
| 15.8 | Reservation source breakdown |

All 🟡 — our proposed Phase-1 list, to be confirmed with the owner in the proposal.

---

## 16. Data Migration & Go-live

| # | Rule | Status |
|---|------|--------|
| 16.1 | The building is a running business: ~60 existing tenancies, deposits held, meter chains, possible debts must be entered at setup (manual entry; Excel import as future enhancement). Migration is a named task in the proposal, potentially a priced onboarding service. | 🟡 |
| 16.2 | Current record-keeping (notebook/Excel/receipt book) to be reviewed as the migration source. | ❓ (P3) |
| 16.3 | Internet connection required; if offline, staff use paper fallback and enter later (stated honestly in the proposal). | 🟡 |

---

## 17. Policy & Pricing Settings (owner-editable module)

All of the following are **settings, not hardcoded** — the "your policies, your control" selling point:

| Setting | Current value | Status |
|---|---|---|
| Rent due day | 5th | ✅ |
| Late rent fee | ฿50/day from the 6th | ✅ |
| Late checkout boundary | 13:00 | ✅ |
| Late checkout rate | ฿50/hour | ✅ |
| Late checkout grace period | minutes — default TBD | 🟡 |
| Cleaning service fee | ฿200/visit | ✅ |
| Move-out cleaning fee (base) | ฿300, editable upward with reason | ✅ |
| Daily key deposit | e.g. ฿500 (confirm exact amount) | 🟡 |
| Reservation hold period | up to 1 month | ✅ |
| Inquiry expiry | ~2 weeks (monthly) | 🟡 |
| No-show policy | forfeit any paid amount | ✅ |
| Early termination policy | forfeit security deposit | ✅ |
| Electricity rate (per unit, historical) | **฿9/unit** — changeable | ✅ |
| Water rate (per unit, historical) | **฿25/unit** — changeable | ✅ |
| Contract renewal alert lead time | 30 days | 🟡 |
| Invoice/receipt custom message | free text | ✅ |
| Move-out notice text | free text (owner-editable) | ✅ |

**Proposal framing: "Your policies, your settings — change any of them yourself, no developer needed."**

---

## 18. Scope Boundaries (declared in the proposal, not questions)

- One building in Phase 1; multi-branch is a listed future phase
- Manual slip verification; SlipOK-type auto-verification is a paid add-on later
- PromptPay QR display without payment gateway integration
- POS/minimart + inventory deferred (permission preset exists; module deferred)
- No online contract signing; printed contract auto-filled from owner's template
- No partial payments (owner policy)
- No visitor registration, no post scheduling, no building-utility reconciliation
- Internet required; offline fallback = paper + enter later
- Hardware (ID card reader, door locks, barcode, smart meters) in future phases; manual entry Phase 1
- Guest register produced as printable/exportable output; legal filing remains the owner's process
- Existing data entered at onboarding — a planned, potentially priced task

---

## 19. ❓ Open Items (complete list)

**Owner questions:**

| # | Question | Impact | Status |
|---|----------|--------|--------|
| ~~P1~~ | Water billing method & rates | **ANSWERED: water ฿25/unit, electric ฿9/unit, both metered, rates changeable** | ✅ Closed |
| ~~P2~~ | Recurring monthly charges | **ANSWERED: none — common fees/parking bundled into rent ("คิดรวมแล้ว")** | ✅ Closed |
| P3 | Request to see: **the current rental contract** (print template source + hidden policies) and **the current record book/Excel** (migration source). | Contract PDF template; migration plan | Open |
| P4 | **เก็บ vs ไม่เกิน contradiction:** if deductions exceed the deposit (e.g. ประกัน 3,000, เสียหาย 4,000) — does he collect the extra ฿1,000, or is the deposit the cap? Earlier answer "เก็บ", later answer "ไม่เกิน". | Decides whether the final-invoice-for-shortfall feature and former-tenant debt tracking exist | Open — re-ask precisely |

**Our decisions parked for design time:**

| # | Decision |
|---|----------|
| D1 | Expense deletion semantics final form (owner-only delete + visible strike-through vs. delete + audit log only) |
| D2 | Late-checkout grace period default value (minutes) |
| D3 | Daily key deposit exact amount (confirm ฿500) |

---

*Everything not marked ❓ is frozen. Further owner answers are clarifications to existing rules, not new scope.*
