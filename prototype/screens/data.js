/* Amanew prototype — shared demo data.
   One source for rooms/tenants/invoice numbers so every screen agrees.
   Deterministic (no Math.random) so a reload always looks the same. */
window.AmanewData = (function () {
  var THAI_NAMES = [
    'คุณสมชาย ใจดี', 'คุณมาลี พงษ์ไพศาล', 'คุณวิชัย ทองคำ', 'คุณสุนีย์ แสงจันทร์',
    'คุณประยุทธ์ ศรีสุข', 'คุณนงลักษณ์ บุญมี', 'คุณอนันต์ รุ่งเรือง', 'คุณจิราพร วงศ์แก้ว',
    'คุณธนากร ชัยมงคล', 'คุณปิยะดา เจริญสุข', 'คุณกิตติศักดิ์ ศิริวัฒน์', 'คุณวรรณา ศรีสุข'
  ];

  // Room types — the standard price lives here, per room TYPE, not per room.
  // S24 (ตั้งค่าห้อง) is the only place these are edited; S08/S10 read them and
  // never let a price be typed from scratch. Changing a standard price affects
  // future contracts/bookings only (CLAUDE.md rule #2) — never an active tenancy.
  var ROOM_TYPES = {
    aircon: { key: 'aircon', label: 'ห้องแอร์', short: 'แอร์', icon: '❄', defaultRent: 4500, defaultNightly: 600 },
    fan:    { key: 'fan',    label: 'ห้องพัดลม', short: 'พัดลม', icon: '🌀', defaultRent: 3500, defaultNightly: 450 }
  };
  function roomTypeOf(r) { return ROOM_TYPES[r.roomType] || ROOM_TYPES.fan; }
  // Effective price = per-room override if one is set, else the type's standard price.
  function rentFor(r) { return r.rentOverride != null ? r.rentOverride : roomTypeOf(r).defaultRent; }
  function nightlyFor(r) { return r.nightlyOverride != null ? r.nightlyOverride : roomTypeOf(r).defaultNightly; }

  // 60 rooms, 4 floors, 15 rooms/floor (101-115, 201-215, 301-315, 401-415)
  // Floors 3-4 are the renovated aircon wing; floors 1-2 are fan rooms apart from
  // a handful already refurbished — 39 แอร์ / 21 พัดลม after the fixed demo overrides below.
  var rooms = [];
  [1, 2, 3, 4].forEach(function (floor) {
    for (var n = 1; n <= 15; n++) {
      var number = String(floor * 100 + n);
      var rentalType = ((floor + n) % 3 === 0) ? 'daily' : 'monthly';
      var roomType = (floor >= 3 || n % 5 === 0) ? 'aircon' : 'fan';
      var state;
      if (rentalType === 'monthly') {
        state = (n % 6 === 0) ? 'vacant' : 'occupied';
      } else {
        state = (n % 5 === 0) ? 'vacant' : (n % 5 === 1) ? 'reserved' : 'occupied';
      }
      var idx = (floor * 15 + n) % THAI_NAMES.length;
      rooms.push({
        number: number, floor: floor, rentalType: rentalType, roomType: roomType, state: state,
        occupant: state === 'occupied' ? THAI_NAMES[idx] : (state === 'reserved' ? THAI_NAMES[idx] : null),
        // Deterministic meter history — every room has a plausible previous reading
        // so the S13 batch sheet can auto-fill "ก่อนหน้า" for all 60 rooms.
        meterPrev: { electric: 900 + floor * 217 + n * 43, water: 35 + floor * 11 + n * 3 }
      });
    }
  });
  // defaultRent / defaultNightly stay as read-only conveniences for screens that
  // already reference them; both resolve through the room-type price above.
  rooms.forEach(function (r) {
    Object.defineProperty(r, 'defaultRent', { get: function () { return rentFor(this); }, enumerable: true });
    Object.defineProperty(r, 'defaultNightly', { get: function () { return nightlyFor(this); }, enumerable: true });
  });

  function room(number) { return rooms.filter(function (r) { return r.number === number; })[0]; }
  function override(number, patch) { var r = room(number); if (r) Object.assign(r, patch); }

  // Fixed demo scenarios — every screen refers to these same rooms.
  override('102', { rentalType: 'monthly', roomType: 'aircon', state: 'vacant', occupant: null });
  override('103', { rentalType: 'daily', roomType: 'fan', state: 'vacant', occupant: null });
  override('104', {
    rentalType: 'daily', roomType: 'aircon', state: 'occupied', occupant: 'คุณนก สุวรรณ (Nok Suwan)',
    phone: '062-345-6789', checkIn: '8 ก.ค. 69', checkOut: '10 ก.ค. 69',
    // Booked below the ห้องแอร์ standard (฿600) — a deliberate per-booking override,
    // flagged wherever it shows (CLAUDE.md rule #7, audit trail visible).
    nightlyRate: 500, rateOverridden: true, nights: 2
  });
  override('105', {
    rentalType: 'monthly', roomType: 'aircon', state: 'occupied', occupant: 'คุณสมชาย ใจดี (Somchai Jaidee)',
    phone: '081-234-5678', startDate: '1 ม.ค. 69', deposit: 7000, rent: 4500,
    // Meter history must agree with invoice #1042, which every other screen shows.
    meterPrev: { electric: 2458, water: 119 },
    tenancyId: 'T-1005'
  });
  override('108', {
    rentalType: 'daily', roomType: 'aircon', state: 'reserved', occupant: 'คุณพลอย จันทร์เพ็ญ',
    phone: '089-555-1234', checkIn: '29 ก.ค. 69', checkOut: '31 ก.ค. 69', nightlyRate: 600
  });
  // 210 and 312 are referenced elsewhere (invoiceList, S17 batch demo) as monthly tenants
  // with meter-based invoices — the (floor+n)%3 formula alone would make both 'daily' with
  // no tenant, which contradicted those screens. Overridden here so every screen agrees.
  override('210', { rentalType: 'monthly', state: 'occupied', occupant: 'คุณวิชัย ทองคำ', rent: 4200, deposit: 4200 });
  override('312', { rentalType: 'monthly', state: 'occupied', occupant: 'คุณสุนีย์ แสงจันทร์', rent: 4500, deposit: 4500 });

  /* ------------------------------------------------------------------
     Contract term — "ตกลงกันก่อนว่าจะอยู่กี่เดือน" (Business Rule 4.12).
     Agreed-months is negotiated per contract, not a fixed template value,
     and it is what "early termination" is measured against: leaving before
     it forfeits the deposit. Rent stays frozen for this whole span (4.5).
     ------------------------------------------------------------------ */
  var THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var TODAY = new Date(2026, 6, 31); // fixed "today" so the demo never drifts
  function thaiDate(d) {
    return d.getDate() + ' ' + THAI_MONTHS[d.getMonth()] + ' ' + String((d.getFullYear() + 543) % 100);
  }
  // <input type="date"> talks in local yyyy-mm-dd. toISOString() is UTC and lands
  // a day early in +07:00, so these two do the conversion explicitly.
  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseISO(value) {
    var p = String(value || '').split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function addMonths(d, n) {
    var out = new Date(d.getTime());
    out.setMonth(out.getMonth() + n);
    return out;
  }
  var AGREED_MONTH_OPTIONS = [3, 6, 12, 24];

  // Attach a contract to every occupied monthly room. Deterministic, and one
  // room (210) is deliberately inside the 30-day renewal window (Rule 4.9).
  rooms.forEach(function (r) {
    if (r.rentalType !== 'monthly' || r.state !== 'occupied') return;
    var n = Number(r.number) % 100;
    var months = AGREED_MONTH_OPTIONS[n % 4];
    var start = addMonths(TODAY, -(n % Math.max(1, months)));
    start.setDate(1);
    r.contract = { months: months, start: start, end: addMonths(start, months) };
  });
  (function () {
    var r105 = room('105');
    r105.contract = { months: 12, start: new Date(2026, 0, 1), end: new Date(2027, 0, 1) };
    var r210 = room('210');
    r210.contract = { months: 6, start: new Date(2026, 1, 20), end: new Date(2026, 7, 20) }; // ครบ 20 ส.ค. 69
  })();

  // Everything a screen needs to talk about a contract, computed in one place.
  function contractOf(r) {
    if (!r || !r.contract) return null;
    var c = r.contract;
    var daysLeft = Math.round((c.end - TODAY) / 86400000);
    var totalDays = Math.round((c.end - c.start) / 86400000);
    return {
      months: c.months,
      startLabel: thaiDate(c.start),
      endLabel: thaiDate(c.end),
      daysLeft: daysLeft,
      monthsLeft: Math.max(0, Math.floor(daysLeft / 30)),
      // Rule 4.9: renewal alert fires 30 days before expiry.
      expiringSoon: daysLeft <= 30 && daysLeft >= 0,
      expired: daysLeft < 0,
      percentElapsed: Math.min(100, Math.max(0, Math.round((totalDays - daysLeft) / totalDays * 100)))
    };
  }

  // Known tenants — matched by exact phone at lookup (S05).
  var tenants = [
    { name: 'คุณสมชาย ใจดี (Somchai Jaidee)', phone: '081-234-5678', history: '2 ครั้งก่อนหน้า — ห้อง 105 (ปัจจุบัน), ห้อง 210 (2568)' },
    { name: 'คุณนก สุวรรณ (Nok Suwan)', phone: '062-345-6789', history: '1 ครั้งก่อนหน้า — ห้อง 104 (ปัจจุบัน)' },
    { name: 'คุณพลอย จันทร์เพ็ญ', phone: '089-555-1234', history: '1 ครั้งก่อนหน้า — ห้อง 108 (จองไว้)' }
  ];
  function findTenantByPhone(phone) {
    return tenants.filter(function (t) { return t.phone === phone; })[0] || null;
  }

  // Utility rates — property-wide, set once in ตั้งค่า, never typed per room.
  var UTILITY_RATES = { electric: 9.00, water: 25.00 };

  // Invoice #1042 — Room 105, July 2026 (matches CLAUDE.md demo data exactly)
  var invoice = {
    number: 1042, room: '105', tenantName: 'คุณสมชาย ใจดี (Somchai Jaidee)',
    billingPeriod: 'กรกฎาคม 2569', dueDate: '5 ส.ค. 69',
    roomCharge: 4500,
    electric: { prev: 2458, cur: 2510, rate: UTILITY_RATES.electric },
    water: { prev: 119, cur: 124, rate: UTILITY_RATES.water },
    status: 'unpaid'
  };
  invoice.electric.units = invoice.electric.cur - invoice.electric.prev;
  invoice.electric.cost = invoice.electric.units * invoice.electric.rate;
  invoice.water.units = invoice.water.cur - invoice.water.prev;
  invoice.water.cost = invoice.water.units * invoice.water.rate;
  invoice.utilitySubtotal = invoice.electric.cost + invoice.water.cost;
  invoice.total = invoice.roomCharge + invoice.utilitySubtotal;

  // A short list backing S18 (invoice list) / S21 (verification queue).
  var invoiceList = [
    { number: 1042, room: '105', tenant: 'คุณสมชาย ใจดี', total: invoice.total, roomCharge: invoice.roomCharge, electric: invoice.electric, water: invoice.water, utilitySubtotal: invoice.utilitySubtotal, dueDate: '5 ส.ค. 69', status: 'unpaid' },
    { number: 1041, room: '110', tenant: 'คุณปิยะดา เจริญสุข', total: 4250, roomCharge: 3800, utilitySubtotal: 350, lateFeeFrozen: 100, dueDate: '3 ส.ค. 69', status: 'pending_verification', submittedBy: 'พนักงาน มานี', waitingDays: 4, method: 'transfer' },
    { number: 1039, room: '210', tenant: 'คุณวิชัย ทองคำ', total: 4820,  roomCharge: 4200, utilitySubtotal: 570, lateFeeFrozen: 50, dueDate: '1 ส.ค. 69', status: 'pending_verification', submittedBy: 'พนักงาน สมศักดิ์', waitingDays: 1, method: 'qr' },
    { number: 1035, room: '312', tenant: 'คุณสุนีย์ แสงจันทร์', total: 5100, roomCharge: 4500, utilitySubtotal: 600, lateFeeFrozen: 0, dueDate: '28 ก.ค. 69', status: 'paid' },
    { number: 1030, room: '109', tenant: 'คุณอนันต์ รุ่งเรือง', total: 3900, roomCharge: 3500, utilitySubtotal: 400, dueDate: '20 ก.ค. 69', status: 'rejected', reason: 'ยอดในสลิปไม่ตรงกับยอดใบแจ้งหนี้' }
  ];
  function findInvoice(number) {
    number = Number(number);
    return invoiceList.filter(function (i) { return i.number === number; })[0] || invoiceList[0];
  }
  // Latest invoice on file for a room (Room Detail's "ดูใบแจ้งหนี้" jumps straight to
  // this instead of an unfiltered list — most recent by invoice number, i.e. last issued).
  function findInvoiceByRoom(roomNumber) {
    var matches = invoiceList.filter(function (i) { return i.room === roomNumber; });
    if (!matches.length) return invoiceList[0]; // demo fallback, same convention as invoicePreviewForRoom
    return matches.reduce(function (latest, i) { return i.number > latest.number ? i : latest; });
  }


  // Occupied monthly rooms needing this cycle's meter reading — backs the S13 batch sheet.
  // Ordered by floor then room number: the same order the reader physically walks the building.
  var metersPendingRooms = rooms.filter(function (r) {
    return r.rentalType === 'monthly' && r.state === 'occupied';
  }).map(function (r) {
    return {
      room: r.number, floor: r.floor, tenant: r.occupant,
      tenancyId: r.tenancyId || ('T-' + r.number),
      prevElectric: r.meterPrev.electric, prevWater: r.meterPrev.water
    };
  });
  function meterPendingRoom(number) {
    return metersPendingRooms.filter(function (p) { return p.room === number; })[0] || null;
  }

  // Rooms with a meter reading on file but no invoice yet — backs the S16 single-invoice
  // room picker. Each reason is grounded in a screen that actually exists in this build
  // (S07/S08 move-in, S13 meter entry, S17 batch run, and — now that S14/S15 exist —
  // S15 meter-correction reissue).
  var readyToInvoiceRooms = [
    {
      room: '113', tenant: 'คุณกิตติศักดิ์ ศิริวัฒน์', reason: 'ย้ายเข้าใหม่ระหว่างเดือน',
      roomCharge: 3800, electric: { prev: 1020, cur: 1065, rate: UTILITY_RATES.electric }, water: { prev: 40, cur: 44, rate: UTILITY_RATES.water },
      billingPeriod: 'กรกฎาคม 2569 (บางส่วน)'
    },
    {
      room: '115', tenant: 'คุณจิราพร วงศ์แก้ว', reason: 'จดมิเตอร์หลังบิลประจำเดือนรอบล่าสุด',
      roomCharge: 4200, electric: { prev: 2201, cur: 2266, rate: UTILITY_RATES.electric }, water: { prev: 88, cur: 93, rate: UTILITY_RATES.water },
      billingPeriod: 'กรกฎาคม 2569'
    },
    {
      room: '214', tenant: 'คุณธนากร ชัยมงคล', reason: 'แก้ไขค่ามิเตอร์แล้ว (S15) — รอออกบิลใหม่',
      roomCharge: 3800, electric: { prev: 1502, cur: 1548, rate: UTILITY_RATES.electric }, water: { prev: 60, cur: 64, rate: UTILITY_RATES.water },
      billingPeriod: 'กรกฎาคม 2569'
    }
  ];
  function invoicePreviewForRoom(roomNumber) {
    var r = readyToInvoiceRooms.filter(function (x) { return x.room === roomNumber; })[0];
    if (!r) return invoice; // fallback demo invoice (room 105) when no room picked yet
    var e = r.electric, w = r.water;
    e.units = e.cur - e.prev; e.cost = e.units * e.rate;
    w.units = w.cur - w.prev; w.cost = w.units * w.rate;
    var utilitySubtotal = e.cost + w.cost;
    return {
      number: 1000 + Number(r.room), room: r.room, tenantName: r.tenant, billingPeriod: r.billingPeriod,
      dueDate: '5 ส.ค. 69', roomCharge: r.roomCharge, electric: e, water: w,
      utilitySubtotal: utilitySubtotal, total: r.roomCharge + utilitySubtotal, status: 'unpaid'
    };
  }
  // Register these two exception invoices in invoiceList too, so S19 (invoice detail)
  // can look them up by number right after S16 "generates" one.
  readyToInvoiceRooms.forEach(function (r) {
    var preview = invoicePreviewForRoom(r.room);
    invoiceList.push({
      number: preview.number, room: preview.room, tenant: preview.tenantName, total: preview.total,
      roomCharge: preview.roomCharge, electric: preview.electric, water: preview.water,
      utilitySubtotal: preview.utilitySubtotal, dueDate: preview.dueDate, status: 'unpaid'
    });
  });

  // Staff & permissions (S26) — per-person checkboxes, never roles (CLAUDE.md rule #6).
  // The 14 permission keys and 4 named presets below are ticks a preset fills in,
  // not roles the system enforces — an account can hold any combination.
  var PERMISSIONS = [
    { key: 'booking', label: 'จอง/เช็คอิน-เอาท์' },
    { key: 'billing', label: 'สร้างบิล · จดมิเตอร์' },
    { key: 'verify_slip', label: 'ตรวจสลิป/รับเงินสด' },
    { key: 'discount', label: 'ให้ส่วนลด' },
    { key: 'deposit_refund', label: 'อนุมัติคืนเงินประกัน' },
    { key: 'move_room', label: 'ย้ายห้อง · แก้ไขผู้เช่า' },
    { key: 'expense_edit', label: 'บันทึก/แก้รายจ่าย' },
    { key: 'view_reports', label: 'ดูรายงานการเงิน' },
    { key: 'edit_invoice', label: 'แก้บิลที่ออกแล้ว' },
    { key: 'expense_delete', label: 'ลบรายจ่าย', ownerOnly: true },
    { key: 'edit_prices', label: 'แก้ราคาห้องตั้งต้น', ownerOnly: true },
    { key: 'manage_staff', label: 'จัดการพนักงาน', ownerOnly: true },
    { key: 'settings', label: 'ตั้งค่าระบบ', ownerOnly: true },
    { key: 'audit_log', label: 'ดู audit log', ownerOnly: true }
  ];
  var ROLE_PRESETS = {
    manager: { label: 'ผู้จัดการ', perms: ['booking', 'billing', 'verify_slip', 'discount', 'deposit_refund', 'move_room', 'expense_edit', 'view_reports', 'edit_invoice'] },
    reception: { label: 'ต้อนรับ', perms: ['booking', 'billing', 'verify_slip'] },
    housekeeping: { label: 'แม่บ้าน', perms: ['booking'] },
    technician: { label: 'ช่าง', perms: ['booking'] }
  };
  var staff = [
    { id: 'ST-01', name: 'นก', phone: '081-234-1111', roles: ['manager', 'reception'], perms: ROLE_PRESETS.manager.perms.concat(['verify_slip']).filter(function (v, i, a) { return a.indexOf(v) === i; }) },
    { id: 'ST-02', name: 'แดง', phone: '082-234-2222', roles: ['housekeeping'], perms: ROLE_PRESETS.housekeeping.perms.slice() },
    { id: 'ST-03', name: 'ช่างโอ๋', phone: '083-234-3333', roles: ['technician'], perms: ROLE_PRESETS.technician.perms.slice() },
    { id: 'ST-04', name: 'สมศักดิ์', phone: '084-234-4444', roles: ['reception'], perms: ROLE_PRESETS.reception.perms.slice() }
  ];
  var owner = { id: 'OWNER', name: 'สมชาย (เจ้าของ)', perms: PERMISSIONS.map(function (p) { return p.key; }) };
  function findStaff(id) { return staff.filter(function (s) { return s.id === id; })[0] || staff[0]; }

  // Worker task list (S29) — housekeeping/maintenance, phone. No tenant name or
  // financial data per the Worker role restriction (role.js comment / spec §5.3).
  var workerTasks = [
    { id: 'WT-1', room: '104', type: 'cleaning', label: 'ทำความสะอาดหลังเช็คเอาท์', due: 'วันนี้ 11:00', done: false },
    { id: 'WT-2', room: '210', type: 'cleaning', label: 'ทำความสะอาดประจำสัปดาห์', due: 'วันนี้ 13:00', done: false },
    { id: 'WT-3', room: '312', type: 'repair', label: 'แอร์ไม่เย็น — แจ้งซ่อม', due: 'วันนี้ 15:00', done: false },
    { id: 'WT-4', room: '108', type: 'cleaning', label: 'เตรียมห้องรับแขกใหม่', due: 'พรุ่งนี้ 09:00', done: true },
    { id: 'WT-5', room: '203', type: 'repair', label: 'ก๊อกน้ำรั่ว', due: 'พรุ่งนี้ 10:00', done: false }
  ];

  // Tenant-facing home (S33) — current tenant's own view, phone, standalone app
  // (not part of the admin/staff shell — a different login surface entirely).
  var tenantHome = {
    name: 'คุณสมชาย ใจดี', room: '105', rentalType: 'monthly',
    currentInvoice: invoiceList[0],
    contractStart: '1 ม.ค. 69', deposit: 7000
  };

  /* ------------------------------------------------------------------
     Room transfer, applied from the URL (?transfer=105-112-15).
     Nothing in this prototype persists across a page load, so S37 hands the
     transfer forward in the query string — every link already carries qs, so
     the moved tenancy and its split bill stay consistent across all screens.
     Rule 10.3: the transfer month bills utilities in TWO periods — old room up
     to the move, new room from the move — on one invoice.
     ------------------------------------------------------------------ */
  function utilityPeriod(roomNo, fromLabel, toLabel, e, w) {
    var period = {
      room: roomNo, fromLabel: fromLabel, toLabel: toLabel,
      electric: { prev: e[0], cur: e[1], rate: UTILITY_RATES.electric },
      water: { prev: w[0], cur: w[1], rate: UTILITY_RATES.water }
    };
    period.electric.units = period.electric.cur - period.electric.prev;
    period.electric.cost = period.electric.units * period.electric.rate;
    period.water.units = period.water.cur - period.water.prev;
    period.water.cost = period.water.units * period.water.rate;
    period.subtotal = period.electric.cost + period.water.cost;
    return period;
  }

  var activeTransfer = null;
  (function applyTransferFromUrl() {
    if (typeof location === 'undefined') return;
    var raw = new URLSearchParams(location.search).get('transfer');
    if (!raw) return;
    var parts = raw.split('-');            // from-to-day[-oldE-oldW-newE-newW]
    var from = room(parts[0]), to = room(parts[1]);
    var moveDay = Number(parts[2]) || 15;
    if (!from || !to || !from.occupant) return;

    var oldClose = { e: Number(parts[3]) || from.meterPrev.electric + 38, w: Number(parts[4]) || from.meterPrev.water + 4 };
    var newOpen  = { e: Number(parts[5]) || to.meterPrev.electric,        w: Number(parts[6]) || to.meterPrev.water };
    var rent = from.rent || rentFor(from);
    var deposit = from.deposit != null ? from.deposit : rentFor(from);

    activeTransfer = {
      fromRoom: from.number, toRoom: to.number, moveDay: moveDay,
      moveLabel: moveDay + ' ' + THAI_MONTHS[TODAY.getMonth()] + ' ' + String((TODAY.getFullYear() + 543) % 100)
    };

    to.occupant = from.occupant; to.phone = from.phone;
    to.rent = rent; to.deposit = deposit;
    to.contract = from.contract; to.startDate = from.startDate;
    to.tenancyId = from.tenancyId; to.state = 'occupied';
    to.transferredFrom = from.number;
    to.meterPrev = { electric: newOpen.e, water: newOpen.w };

    from.occupant = null; from.phone = null; from.rent = null;
    from.deposit = null; from.contract = null; from.tenancyId = null;
    from.state = 'vacant';

    // The transfer month's invoice: one room charge, two utility periods.
    var monthLabel = THAI_MONTHS[TODAY.getMonth()] + ' ' + String((TODAY.getFullYear() + 543) % 100);
    var periods = [
      utilityPeriod(activeTransfer.fromRoom, '1 ' + monthLabel, activeTransfer.moveLabel,
        [from.meterPrev.electric, oldClose.e], [from.meterPrev.water, oldClose.w]),
      utilityPeriod(activeTransfer.toRoom, activeTransfer.moveLabel, 'สิ้นเดือน',
        [newOpen.e, newOpen.e + 24], [newOpen.w, newOpen.w + 3])
    ];
    var utilitySubtotal = periods.reduce(function (sum, p) { return sum + p.subtotal; }, 0);
    var transferInvoice = {
      number: 1050, room: to.number, tenant: to.occupant, roomCharge: rent,
      utilityPeriods: periods, utilitySubtotal: utilitySubtotal,
      total: rent + utilitySubtotal, dueDate: '5 ส.ค. 69', status: 'unpaid',
      transferNote: 'ย้ายห้อง ' + activeTransfer.fromRoom + ' → ' + activeTransfer.toRoom + ' เมื่อ ' + activeTransfer.moveLabel
    };
    invoiceList.unshift(transferInvoice);
    activeTransfer.invoiceNumber = transferInvoice.number;
    // The tenant app follows the same person, so it must show the new room's bill.
    if (tenantHome.room === activeTransfer.fromRoom) {
      tenantHome.room = to.number;
      tenantHome.currentInvoice = transferInvoice;
    }
  })();

  /* ------------------------------------------------------------------
     Cash book (บัญชีรายรับ-รายจ่าย) — Business Rules §13. Money in vs money
     out, not accrual P&L. Categories are owner-editable (13.3); deletes are
     owner-only and stay visible struck-through, never silent (13.4).
     ------------------------------------------------------------------ */
  var INCOME_SOURCES = [
    { key: 'rent', label: 'ค่าเช่ารายเดือน' },
    { key: 'daily', label: 'ค่าห้องรายวัน' },
    { key: 'cleaning_fee', label: 'ค่าบริการทำความสะอาด' },
    { key: 'late_fee', label: 'ค่าปรับล่าช้า' },
    { key: 'forfeited', label: 'เงินประกัน/มัดจำที่ริบ' },
    { key: 'laundry', label: 'รายได้เครื่องซักผ้า' },
    { key: 'parking', label: 'ค่าที่จอดรถ' },
    { key: 'other_income', label: 'รายรับอื่นๆ' }
  ];
  var EXPENSE_CATEGORIES = [
    { key: 'salary', label: 'เงินเดือนพนักงาน' },
    { key: 'water_bill', label: 'ค่าน้ำประปา (การประปา)' },
    { key: 'electric_bill', label: 'ค่าไฟฟ้า (การไฟฟ้า)' },
    { key: 'internet', label: 'ค่าอินเทอร์เน็ต' },
    { key: 'repair', label: 'ค่าซ่อมแซม/อะไหล่' },
    { key: 'cleaning_supplies', label: 'อุปกรณ์ทำความสะอาด' },
    { key: 'office', label: 'อุปกรณ์สำนักงาน' },
    { key: 'misc', label: 'อื่นๆ' }
  ];
  var PAYMENT_METHODS = [
    { key: 'cash', label: 'เงินสด' },
    { key: 'transfer', label: 'โอนธนาคาร' },
    { key: 'qr', label: 'QR พร้อมเพย์' }
  ];

  // July 2569 demo book. Deterministic, and shaped like a real month at 60 rooms:
  // rent dominates income; salary + utility bills dominate expenses.
  var cashEntries = [
    { id: 'C-01', date: '1 ก.ค. 69', day: 1, kind: 'income', cat: 'rent', label: 'ค่าเช่าเดือน ก.ค. — 22 ห้อง (รอบแรก)', amount: 92400, method: 'transfer', by: 'นก', receipt: true },
    { id: 'C-02', date: '1 ก.ค. 69', day: 1, kind: 'expense', cat: 'salary', label: 'เงินเดือนพนักงาน 4 คน', amount: 38000, method: 'transfer', by: 'เจ้าของ', receipt: true },
    { id: 'C-03', date: '3 ก.ค. 69', day: 3, kind: 'expense', cat: 'internet', label: 'ค่าเน็ตรายเดือน (ทั้งตึก)', amount: 1590, method: 'transfer', by: 'นก', receipt: true },
    { id: 'C-04', date: '5 ก.ค. 69', day: 5, kind: 'income', cat: 'rent', label: 'ค่าเช่าเดือน ก.ค. — 13 ห้อง (รอบสอง)', amount: 54600, method: 'cash', by: 'สมศักดิ์', receipt: false },
    { id: 'C-05', date: '6 ก.ค. 69', day: 6, kind: 'income', cat: 'late_fee', label: 'ค่าปรับล่าช้า 3 ห้อง', amount: 450, method: 'cash', by: 'สมศักดิ์', receipt: false },
    { id: 'C-06', date: '8 ก.ค. 69', day: 8, kind: 'expense', cat: 'water_bill', label: 'ค่าน้ำประปา รอบ มิ.ย.', amount: 8740, method: 'transfer', by: 'เจ้าของ', receipt: true },
    { id: 'C-07', date: '8 ก.ค. 69', day: 8, kind: 'income', cat: 'daily', label: 'ค่าห้องรายวัน 1–8 ก.ค. (14 คืน)', amount: 7800, method: 'cash', by: 'นก', receipt: false },
    { id: 'C-08', date: '10 ก.ค. 69', day: 10, kind: 'expense', cat: 'electric_bill', label: 'ค่าไฟฟ้า รอบ มิ.ย.', amount: 41250, method: 'transfer', by: 'เจ้าของ', receipt: true },
    { id: 'C-09', date: '12 ก.ค. 69', day: 12, kind: 'expense', cat: 'repair', label: 'ซ่อมแอร์ ห้อง 312 (ช่างภายนอก)', amount: 2800, method: 'cash', by: 'นก', receipt: true },
    { id: 'C-10', date: '14 ก.ค. 69', day: 14, kind: 'income', cat: 'laundry', label: 'เครื่องซักผ้า สัปดาห์ที่ 2', amount: 1240, method: 'cash', by: 'แดง', receipt: false },
    { id: 'C-11', date: '15 ก.ค. 69', day: 15, kind: 'expense', cat: 'cleaning_supplies', label: 'น้ำยาทำความสะอาด/ถุงขยะ', amount: 1350, method: 'cash', by: 'แดง', receipt: true },
    { id: 'C-12', date: '18 ก.ค. 69', day: 18, kind: 'income', cat: 'cleaning_fee', label: 'ทำความสะอาดตามคำขอ 4 ห้อง', amount: 800, method: 'cash', by: 'แดง', receipt: false },
    { id: 'C-13', date: '20 ก.ค. 69', day: 20, kind: 'income', cat: 'forfeited', label: 'ริบเงินประกัน ห้อง 407 (ย้ายออกก่อนครบสัญญา)', amount: 3500, method: 'cash', by: 'เจ้าของ', receipt: false },
    { id: 'C-14', date: '21 ก.ค. 69', day: 21, kind: 'income', cat: 'parking', label: 'ค่าที่จอดรถรายเดือน 6 คัน', amount: 1800, method: 'cash', by: 'สมศักดิ์', receipt: false },
    { id: 'C-15', date: '22 ก.ค. 69', day: 22, kind: 'expense', cat: 'misc', label: 'ค่าน้ำมันรถ/เดินเอกสาร', amount: 620, method: 'cash', by: 'นก', receipt: false,
      deleted: true, deletedBy: 'เจ้าของ', deletedAt: '23 ก.ค. 69', deletedReason: 'บันทึกซ้ำกับ C-16' },
    { id: 'C-16', date: '22 ก.ค. 69', day: 22, kind: 'expense', cat: 'misc', label: 'ค่าน้ำมันรถ/เดินเอกสาร', amount: 620, method: 'cash', by: 'เจ้าของ', receipt: false },
    { id: 'C-17', date: '25 ก.ค. 69', day: 25, kind: 'income', cat: 'daily', label: 'ค่าห้องรายวัน 9–25 ก.ค. (23 คืน)', amount: 12650, method: 'transfer', by: 'นก', receipt: true },
    { id: 'C-18', date: '28 ก.ค. 69', day: 28, kind: 'expense', cat: 'office', label: 'กระดาษ/หมึกพิมพ์ใบเสร็จ', amount: 890, method: 'cash', by: 'สมศักดิ์', receipt: true },
    { id: 'C-19', date: '31 ก.ค. 69', day: 31, kind: 'income', cat: 'laundry', label: 'เครื่องซักผ้า สัปดาห์ที่ 3–4', amount: 1610, method: 'cash', by: 'แดง', receipt: false },
    { id: 'C-20', date: '31 ก.ค. 69', day: 31, kind: 'expense', cat: 'repair', label: 'เปลี่ยนปั๊มน้ำ ชั้น 4', amount: 6900, method: 'transfer', by: 'เจ้าของ', receipt: true }
  ];
  function catLabel(entry) {
    var list = entry.kind === 'income' ? INCOME_SOURCES : EXPENSE_CATEGORIES;
    var hit = list.filter(function (c) { return c.key === entry.cat; })[0];
    return hit ? hit.label : entry.cat;
  }
  // Deleted rows stay in the book, struck-through (13.4) — they must never
  // silently change a total, so every sum filters them out explicitly.
  function cashTotals(entries) {
    var live = entries.filter(function (e) { return !e.deleted; });
    var income = live.filter(function (e) { return e.kind === 'income'; }).reduce(function (s, e) { return s + e.amount; }, 0);
    var expense = live.filter(function (e) { return e.kind === 'expense'; }).reduce(function (s, e) { return s + e.amount; }, 0);
    return { income: income, expense: expense, net: income - expense, count: live.length };
  }
  function cashByCategory(kind) {
    var live = cashEntries.filter(function (e) { return !e.deleted && e.kind === kind; });
    var map = {};
    live.forEach(function (e) { map[e.cat] = (map[e.cat] || 0) + e.amount; });
    return Object.keys(map).map(function (k) {
      return { cat: k, label: catLabel({ kind: kind, cat: k }), amount: map[k] };
    }).sort(function (a, b) { return b.amount - a.amount; });
  }

  /* ------------------------------------------------------------------
     Requests inbox — the destination for everything sent INTO the office.
     Two senders: tenants (แจ้งซ่อม/แจ้งทำความสะอาด/แจ้งย้ายออก from S33) and
     workers (a blocked or in-progress job reported from S30). Lifecycle per
     Business Rule 11.1: reported → assigned → in_progress → resolved. There is
     deliberately no "verified/closed" state — the rule says none exists.
     ------------------------------------------------------------------ */
  var REQUEST_TYPES = {
    repair:       { label: 'แจ้งซ่อม', icon: '🔧', badge: 'badge-warning', makesTask: 'repair' },
    cleaning:     { label: 'แจ้งทำความสะอาด', icon: '🧹', badge: 'badge-info', makesTask: 'cleaning' },
    moveout:      { label: 'แจ้งย้ายออก', icon: '📦', badge: 'badge-danger', makesTask: null },
    worker_issue: { label: 'ช่างแจ้งติดปัญหา', icon: '⚠', badge: 'badge-danger', makesTask: null }
  };
  var REQUEST_STATUS = {
    reported:    { label: 'ใหม่ — ยังไม่มอบหมาย', badge: 'badge-danger' },
    assigned:    { label: 'มอบหมายแล้ว', badge: 'badge-info' },
    in_progress: { label: 'กำลังดำเนินการ', badge: 'badge-warning' },
    resolved:    { label: 'เสร็จแล้ว', badge: 'badge-success' }
  };
  var requests = [
    { id: 'R-101', room: '105', type: 'repair', from: 'คุณสมชาย ใจดี', fromRole: 'tenant',
      detail: 'ก๊อกน้ำในห้องน้ำปิดไม่สนิท น้ำหยดตลอดคืน', at: '31 ก.ค. 69 08:12', waitH: 3, status: 'reported' },
    { id: 'R-102', room: '210', type: 'cleaning', from: 'คุณวิชัย ทองคำ', fromRole: 'tenant',
      detail: 'ขอให้ทำความสะอาดห้องวันเสาร์นี้ (ทราบว่ามีค่าบริการ ฿200)', at: '31 ก.ค. 69 07:40', waitH: 4, status: 'reported' },
    { id: 'R-103', room: '312', type: 'worker_issue', from: 'ช่างโอ๋', fromRole: 'worker',
      detail: 'แอร์ห้อง 312 ต้องเปลี่ยนคอมเพรสเซอร์ ต้องสั่งของข้างนอก ทำวันนี้ไม่ได้', at: '30 ก.ค. 69 15:20', waitH: 20, status: 'reported' },
    { id: 'R-104', room: '115', type: 'moveout', from: 'คุณจิราพร วงศ์แก้ว', fromRole: 'tenant',
      detail: 'แจ้งย้ายออกสิ้นเดือนสิงหาคม ขอทราบขั้นตอนคืนเงินประกัน', at: '29 ก.ค. 69 19:05', waitH: 40, status: 'assigned', assignee: 'นก' },
    { id: 'R-105', room: '203', type: 'repair', from: 'คุณปิยะดา เจริญสุข', fromRole: 'tenant',
      detail: 'หลอดไฟหน้าห้องกระพริบ', at: '29 ก.ค. 69 10:15', waitH: 46, status: 'in_progress', assignee: 'ช่างโอ๋' },
    { id: 'R-106', room: '104', type: 'cleaning', from: 'ระบบ (เช็คเอาท์)', fromRole: 'system',
      detail: 'ทำความสะอาดหลังเช็คเอาท์ — อัตโนมัติ ไม่มีค่าบริการ', at: '28 ก.ค. 69 11:00', waitH: 70, status: 'resolved', assignee: 'แดง' }
  ];
  function openRequestCount() {
    return requests.filter(function (r) { return r.status !== 'resolved'; }).length;
  }
  function newRequestCount() {
    return requests.filter(function (r) { return r.status === 'reported'; }).length;
  }

  var LATE_FEE_PER_DAY = 50;
  var GRACE_DAYS = 5;
  function lateFee(daysLate) {
    var billable = Math.max(0, daysLate - GRACE_DAYS);
    return billable * LATE_FEE_PER_DAY;
  }

  function money(n) { return '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }

  // Global search (topbar) — one box over rooms, people and invoices, since the
  // three things staff get asked about on the phone are "which room", "who is in
  // 105" and "is #1042 paid". Phone digits match loosely (081-234 == 081234).
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function searchAll(query) {
    var q = String(query || '').trim();
    if (q.length < 2) return [];
    var qd = digits(q);
    var out = [];

    rooms.forEach(function (r) {
      var hitRoom = r.number.indexOf(q) === 0;
      var hitName = r.occupant && r.occupant.indexOf(q) !== -1;
      var hitPhone = qd.length >= 3 && digits(r.phone).indexOf(qd) !== -1;
      if (!hitRoom && !hitName && !hitPhone) return;
      out.push({
        kind: 'room', label: 'ห้อง ' + r.number,
        sub: roomTypeOf(r).short + ' · ' + (r.rentalType === 'monthly' ? 'รายเดือน' : 'รายวัน') +
             (r.occupant ? ' · ' + r.occupant : ' · ว่าง'),
        href: 's04-room-detail.html?room=' + r.number
      });
    });

    tenants.forEach(function (t) {
      var hit = t.name.indexOf(q) !== -1 || (qd.length >= 3 && digits(t.phone).indexOf(qd) !== -1);
      if (!hit) return;
      // Where does this person live right now? Room result already covers it if so.
      var theirRoom = rooms.filter(function (r) { return r.occupant === t.name; })[0];
      out.push({
        kind: 'tenant', label: t.name, sub: t.phone + (theirRoom ? ' · ห้อง ' + theirRoom.number : ' · ไม่มีห้องปัจจุบัน'),
        href: theirRoom ? 's04-room-detail.html?room=' + theirRoom.number
                        : 's03-room-grid.html?pick=monthly&phone=' + encodeURIComponent(t.phone)
      });
    });

    invoiceList.forEach(function (i) {
      if (String(i.number).indexOf(q) !== 0) return;
      out.push({
        kind: 'invoice', label: 'บิล #' + i.number,
        sub: 'ห้อง ' + i.room + ' · ' + i.tenant + ' · ' + money(i.total),
        href: 's19-invoice-detail.html?invoice=' + i.number
      });
    });

    return out.slice(0, 8);
  }

  return {
    rooms: rooms, room: room, tenants: tenants, findTenantByPhone: findTenantByPhone,
    invoice: invoice, invoiceList: invoiceList, findInvoice: findInvoice, findInvoiceByRoom: findInvoiceByRoom,
    readyToInvoiceRooms: readyToInvoiceRooms, invoicePreviewForRoom: invoicePreviewForRoom,
    metersPendingRooms: metersPendingRooms, meterPendingRoom: meterPendingRoom,
    ROOM_TYPES: ROOM_TYPES, roomTypeOf: roomTypeOf, rentFor: rentFor, nightlyFor: nightlyFor,
    contractOf: contractOf, AGREED_MONTH_OPTIONS: AGREED_MONTH_OPTIONS,
    INCOME_SOURCES: INCOME_SOURCES, EXPENSE_CATEGORIES: EXPENSE_CATEGORIES, PAYMENT_METHODS: PAYMENT_METHODS,
    cashEntries: cashEntries, catLabel: catLabel, cashTotals: cashTotals, cashByCategory: cashByCategory,
    REQUEST_TYPES: REQUEST_TYPES, REQUEST_STATUS: REQUEST_STATUS, requests: requests,
    openRequestCount: openRequestCount, newRequestCount: newRequestCount,
    activeTransfer: activeTransfer,
    thaiDate: thaiDate, addMonths: addMonths, isoDate: isoDate, parseISO: parseISO, TODAY: TODAY,
    UTILITY_RATES: UTILITY_RATES, searchAll: searchAll,
    lateFee: lateFee, LATE_FEE_PER_DAY: LATE_FEE_PER_DAY, GRACE_DAYS: GRACE_DAYS,
    money: money,
    PERMISSIONS: PERMISSIONS, ROLE_PRESETS: ROLE_PRESETS, staff: staff, owner: owner, findStaff: findStaff,
    workerTasks: workerTasks, tenantHome: tenantHome
  };
})();
