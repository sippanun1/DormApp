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
  //
  // Owner, 2026-08-04: **every room is now a ห้องแอร์.** Air conditioning stopped
  // being the thing that separates rooms, so the price axis is the BED: เตียงเดี่ยว
  // vs เตียงคู่. The axis itself is unchanged (CLAUDE.md rule #11 — room type
  // decides price only, and is independent of รายเดือน/รายวัน); only what it
  // measures changed. Air conditioning is now a property of every room and so
  // belongs on no room's badge.
  var ALL_ROOMS_AIRCON = true;
  var ROOM_TYPES = {
    double: { key: 'double', label: 'ห้องเตียงคู่',   short: 'คู่',    icon: '🛏🛏', defaultRent: 5000, defaultNightly: 700 },
    single: { key: 'single', label: 'ห้องเตียงเดี่ยว', short: 'เดี่ยว', icon: '🛏',   defaultRent: 4500, defaultNightly: 600 }
  };
  function roomTypeOf(r) { return ROOM_TYPES[r.roomType] || ROOM_TYPES.single; }
  // Effective price = per-room override if one is set, else the type's standard price.
  function rentFor(r) { return r.rentOverride != null ? r.rentOverride : roomTypeOf(r).defaultRent; }
  function nightlyFor(r) { return r.nightlyOverride != null ? r.nightlyOverride : roomTypeOf(r).defaultNightly; }

  // 60 rooms, 4 floors, 15 rooms/floor (101-115, 201-215, 301-315, 401-415)
  // Floors 3-4 are the larger rooms and take a double bed; floors 1-2 are single
  // apart from a handful of corner rooms — 39 เตียงคู่ / 21 เตียงเดี่ยว, the same
  // rooms that used to be the 39 แอร์ / 21 พัดลม split (owner kept the split, 2026-08-04).
  var rooms = [];
  [1, 2, 3, 4].forEach(function (floor) {
    for (var n = 1; n <= 15; n++) {
      var number = String(floor * 100 + n);
      var rentalType = ((floor + n) % 3 === 0) ? 'daily' : 'monthly';
      var roomType = (floor >= 3 || n % 5 === 0) ? 'double' : 'single';
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
  override('102', { rentalType: 'monthly', roomType: 'double', state: 'vacant', occupant: null });
  override('103', { rentalType: 'daily', roomType: 'single', state: 'vacant', occupant: null });
  override('104', {
    rentalType: 'daily', roomType: 'double', state: 'occupied', occupant: 'คุณนก สุวรรณ (Nok Suwan)',
    phone: '062-345-6789', checkIn: '8 ก.ค. 69', checkOut: '10 ก.ค. 69',
    // Booked below the ห้องเตียงคู่ standard (฿700) — a deliberate per-booking override,
    // flagged wherever it shows (CLAUDE.md rule #7, audit trail visible).
    nightlyRate: 500, rateOverridden: true, nights: 2
  });
  override('105', {
    rentalType: 'monthly', roomType: 'double', state: 'occupied', occupant: 'คุณสมชาย ใจดี (Somchai Jaidee)',
    phone: '081-234-5678', startDate: '1 ม.ค. 69', deposit: 7000, rent: 4500,
    // Meter history must agree with invoice #1042, which every other screen shows.
    meterPrev: { electric: 2458, water: 119 },
    tenancyId: 'T-1005'
  });
  override('108', {
    rentalType: 'daily', roomType: 'double', state: 'reserved', occupant: 'คุณพลอย จันทร์เพ็ญ',
    phone: '089-555-1234', checkIn: '29 ก.ค. 69', checkOut: '31 ก.ค. 69', nightlyRate: 600
  });
  // 210 and 312 are referenced elsewhere (invoiceList, S17 batch demo) as monthly tenants
  // with meter-based invoices — the (floor+n)%3 formula alone would make both 'daily' with
  // no tenant, which contradicted those screens. Overridden here so every screen agrees.
  override('210', { rentalType: 'monthly', state: 'occupied', occupant: 'คุณวิชัย ทองคำ', rent: 4200, deposit: 4200 });
  override('312', { rentalType: 'monthly', state: 'occupied', occupant: 'คุณสุนีย์ แสงจันทร์', rent: 4500, deposit: 4500 });

  // Phone is the universal identifier (CLAUDE.md), so every occupant needs one or
  // the directory reads as broken data. Deterministic from the room number, and
  // applied after the scenario overrides so hand-written real numbers survive.
  rooms.forEach(function (r) {
    if (!r.occupant || r.phone) return;
    var n = Number(r.number);
    r.phone = '0' + (8 + n % 2) + (1 + n % 9) + '-' + String(200 + n % 700).padStart(3, '0') +
      '-' + String(1000 + (n * 37) % 8999);
  });

  // Daily rooms need real stay dates too, or the directory (S44) shows "— → —"
  // on every generated daily row and reads as broken data. Occupied = staying
  // across today; reserved = arriving in the next few days. Set after the
  // scenario overrides so 104/108's hand-written dates survive.
  (function dailyStayDates() {
    var THAI_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    function fmt(d) { return d.getDate() + ' ' + THAI_M[d.getMonth()] + ' ' + String((d.getFullYear() + 543) % 100); }
    var today = new Date(2026, 6, 31);
    rooms.forEach(function (r) {
      if (r.rentalType !== 'daily' || !r.occupant || r.checkIn) return;
      var n = Number(r.number) % 100;
      var nights = 1 + (n % 4);
      var start = new Date(today.getTime());
      start.setDate(today.getDate() + (r.state === 'reserved' ? 1 + (n % 5) : -(n % 3)));
      var end = new Date(start.getTime());
      end.setDate(start.getDate() + nights);
      r.checkIn = fmt(start);
      r.checkOut = fmt(end);
      r.nights = nights;
    });
  })();

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
      // Rule 4.9: renewal alert fires N days before expiry — N is set in S43.
      expiringSoon: daysLeft <= policy('renewalNoticeDays') && daysLeft >= 0,
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

  /* ------------------------------------------------------------------
     Tenant self-registration (S46). Owner decision 2026-08-01: tenants
     sign themselves up rather than being handed a password by staff.
     The guard that makes this safe is that **a phone can only register
     if it is already on a room** — the office creates the tenancy first
     (S07/S08), so registration claims an existing record, it never
     creates one. Anyone whose number isn't on a room is turned away to
     the office. Phone is the identifier everywhere (CLAUDE.md), so
     there is no email field and no email-based reset.
     ------------------------------------------------------------------ */
  // Deliberately NOT คุณสมชาย (105): he is the identity the tenant app renders, so
  // registering as him is the one path where the success banner and the screen you
  // land on agree. คุณวิชัย (210) covers the "already registered" state instead.
  var registeredPhones = ['084-410-8770'];
  function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }
  // Returns why a phone may or may not register, so one screen can show all
  // three outcomes without inventing its own rules.
  function registrationCheck(phone) {
    var d = digitsOnly(phone);
    if (d.length < 9) return { ok: false, reason: 'invalid', message: 'กรุณากรอกเบอร์โทรให้ครบ 10 หลัก' };
    if (registeredPhones.some(function (p) { return digitsOnly(p) === d; })) {
      return { ok: false, reason: 'already', message: 'เบอร์นี้สมัครไว้แล้ว — เข้าสู่ระบบได้เลย' };
    }
    var r = rooms.filter(function (x) { return x.occupant && digitsOnly(x.phone) === d; })[0];
    if (!r) {
      return { ok: false, reason: 'not_found',
        message: 'ไม่พบเบอร์นี้ในระบบ — ต้องทำสัญญากับสำนักงานก่อนจึงจะสมัครได้ ถ้าเพิ่งย้ายเข้า กรุณาติดต่อสำนักงาน' };
    }
    return { ok: true, room: r.number, name: r.occupant, rentalType: r.rentalType };
  }
  function completeRegistration(phone) {
    if (!registeredPhones.some(function (p) { return digitsOnly(p) === digitsOnly(phone); })) {
      registeredPhones.push(phone);
    }
  }

  /* ------------------------------------------------------------------
     Tenant directory (S44). Until now the only way to find a person was
     S05's exact-phone lookup, which cannot answer "who used to live in
     305" or "has this person rented here before". Past tenants carry the
     flags that matter when they come back: หนีค่าเช่า, ห้ามเช่าอีก.
     Note there is deliberately no debt figure on a former tenant —
     deposit settlement floors at zero and no debt is ever carried
     (CLAUDE.md rule 4); a flag records what happened, not a balance.
     ------------------------------------------------------------------ */
  var pastTenants = [
    { name: 'คุณอนันต์ รุ่งเรือง', phone: '086-111-2233', room: '407', from: '1 ก.พ. 68', to: '20 ก.ค. 69',
      months: 17, rental: 'monthly', note: 'ย้ายออกก่อนครบสัญญา — ริบเงินประกัน', flag: null },
    { name: 'คุณสุดา ทรัพย์เจริญ', phone: '087-222-3344', room: '305', from: '1 มิ.ย. 67', to: '31 พ.ค. 69',
      months: 24, rental: 'monthly', note: 'ครบสัญญา คืนเงินประกันเต็มจำนวน', flag: null },
    { name: 'คุณเอกชัย พูนผล', phone: '088-333-4455', room: '112', from: '15 มี.ค. 68', to: '2 ม.ค. 69',
      months: 9, rental: 'monthly', note: 'ออกจากห้องโดยไม่แจ้ง ติดต่อไม่ได้', flag: 'absconded' },
    { name: 'คุณกิตติศักดิ์ ศิริวัฒน์', phone: '089-444-5566', room: '208', from: '1 ต.ค. 67', to: '30 ก.ย. 68',
      months: 12, rental: 'monthly', note: 'เสียงดังรบกวนห้องข้างเคียงหลายครั้ง', flag: 'no_rent' },
    { name: 'คุณวรรณา ศรีสุข', phone: '090-555-6677', room: '103', from: '5 ธ.ค. 68', to: '8 ธ.ค. 68',
      months: 0, rental: 'daily', note: 'พักรายวัน 3 คืน', flag: null },
    { name: 'คุณธนากร ชัยมงคล', phone: '091-666-7788', room: '215', from: '1 ม.ค. 68', to: '31 ธ.ค. 68',
      months: 12, rental: 'monthly', note: 'ครบสัญญา ย้ายไปต่างจังหวัด', flag: null }
  ];
  var TENANT_FLAGS = {
    absconded: { label: 'หนีค่าเช่า', badge: 'badge-danger' },
    no_rent:   { label: 'ไม่ให้เช่าอีก', badge: 'badge-warning' }
  };
  // Current residents are derived from the room board, never a second list that
  // could disagree with it — the room is the source of truth for who lives where.
  function directory() {
    var current = rooms.filter(function (r) { return r.occupant && r.state !== 'vacant'; }).map(function (r) {
      var c = contractOf(r);
      var known = tenants.filter(function (t) { return t.name === r.occupant; })[0];
      return {
        status: r.state === 'reserved' ? 'reserved' : 'current',
        name: r.occupant, phone: r.phone || (known && known.phone) || '—',
        room: r.number, rental: r.rentalType,
        from: c ? c.startLabel : (r.checkIn || '—'),
        to: c ? c.endLabel : (r.checkOut || '—'),
        nights: c ? 0 : (r.nights || 0),
        months: c ? c.months : 0,
        // Same default the tenancy form uses (S08: standard rent × depositMonths),
        // so the directory never shows a deposit the contract screens wouldn't.
        deposit: r.deposit != null ? r.deposit
          : (r.rentalType === 'monthly' && c ? rentFor(r) * policy('depositMonths') : null),
        note: c ? (c.expiringSoon ? 'สัญญาใกล้ครบ — เหลือ ' + c.daysLeft + ' วัน' : 'อยู่ระหว่างสัญญา') :
          (r.state === 'reserved' ? 'จองไว้ ยังไม่เข้าอยู่' : 'พักรายวัน'),
        flag: null
      };
    });
    var past = pastTenants.map(function (p) {
      return { status: 'past', name: p.name, phone: p.phone, room: p.room, rental: p.rental,
        from: p.from, to: p.to, months: p.months, deposit: null, note: p.note, flag: p.flag };
    });
    return current.concat(past);
  }

  // Utility rates — property-wide, set once in ตั้งค่า, never typed per room.
  var UTILITY_RATES = { electric: 9.00, water: 25.00 };

  /* ------------------------------------------------------------------
     Owner-editable policies (S43). Every number here was hardcoded in a
     screen until 2026-08-01 — the owner could not change a single one of
     their own rules. Only policies that already existed as a real number
     somewhere in the build are listed; nothing was invented to fill the
     screen out. Prices and utility rates deliberately stay in S24, which
     is still the only place they are edited (CLAUDE.md rule 11).
     ------------------------------------------------------------------ */
  var POLICY = {
    billIssueDay:      { value: 1,   unit: 'วันที่', label: 'วันออกบิลประจำเดือน', note: 'ระบบออกบิลรอบใหม่ทุกวันที่นี้', min: 1, max: 28 },
    dueDay:            { value: 5,   unit: 'วันที่', label: 'วันครบกำหนดชำระ', note: 'หลังจากวันนี้ถือว่าเกินกำหนด', min: 1, max: 28 },
    dueReminderDays:   { value: 2,   unit: 'วัน',   label: 'เตือนก่อนครบกำหนด', note: 'แจ้งเตือนผู้เช่าล่วงหน้ากี่วัน', min: 0, max: 10 },
    graceDays:         { value: 5,   unit: 'วัน',   label: 'ผ่อนผันก่อนคิดค่าปรับ', note: 'นับจากวันออกบิล — ค่าปรับเริ่มวันถัดจากนี้', min: 0, max: 15 },
    lateFeePerDay:     { value: 50,  unit: 'บาท/วัน', label: 'ค่าปรับล่าช้า', note: 'คิดทบทุกวันจนกว่าจะชำระ', min: 0, max: 500, money: true },
    depositMonths:     { value: 2,   unit: 'เดือน', label: 'เงินประกัน (รายเดือน)', note: 'กี่เท่าของค่าเช่า — ใช้ตั้งต้นในหน้าทำสัญญา', min: 0, max: 6 },
    keyDeposit:        { value: 300, unit: 'บาท',   label: 'มัดจำกุญแจ (รายวัน)', note: 'คนละก้อนกับเงินประกัน ไม่รวมกันเด็ดขาด', min: 0, max: 5000, money: true },
    cleaningFee:       { value: 200, unit: 'บาท/ครั้ง', label: 'ค่าทำความสะอาดตามคำขอ', note: 'ทำความสะอาดหลังเช็คเอาท์ไม่คิดเงิน', min: 0, max: 5000, money: true },
    renewalNoticeDays: { value: 30,  unit: 'วัน',   label: 'เตือนล่วงหน้าก่อนครบสัญญา', note: 'สัญญาจะขึ้นในหน้าวันนี้และแจ้งผู้เช่า', min: 7, max: 120 }
  };
  function policy(key) { return POLICY[key].value; }

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
  // WHAT may be deleted at all (S18). Rule 13.4 says HOW a delete happens —
  // owner only, reason required, row stays visible struck-through. This says
  // which rows are even eligible, and it is the same principle that locks the
  // cash book: once a receipt exists in the tenant's hands (CLAUDE.md rule 3),
  // removing the bill would put the system and that receipt in disagreement.
  //   paid                 → never. A receipt was issued.
  //   pending_verification → not yet. A tenant's slip is sitting in the queue;
  //                          reject it on S22 first, which is a visible act with
  //                          a reason attached, then the bill becomes deletable.
  //   unpaid / rejected    → deletable. No receipt exists and no slip is waiting.
  function invoiceDeletable(i) {
    return !i.deleted && (i.status === 'unpaid' || i.status === 'rejected');
  }
  function invoiceDeleteBlockReason(i) {
    if (i.status === 'paid') return 'ชำระแล้ว — ออกใบเสร็จให้ผู้เช่าไปแล้ว ลบไม่ได้';
    if (i.status === 'pending_verification') return 'มีสลิปรอตรวจอยู่ — ต้องปฏิเสธสลิปก่อน';
    return '';
  }

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
    // In-house. Hired outside technicians never get an account — โอ๋ is the one who
    // meets them at the room and relays the problem and the quoted price back in.
    { id: 'ST-03', name: 'ช่างโอ๋', phone: '083-234-3333', roles: ['technician'], perms: ROLE_PRESETS.technician.perms.slice() },
    { id: 'ST-04', name: 'สมศักดิ์', phone: '084-234-4444', roles: ['reception'], perms: ROLE_PRESETS.reception.perms.slice() }
  ];
  var owner = { id: 'OWNER', name: 'สมชาย (เจ้าของ)', perms: PERMISSIONS.map(function (p) { return p.key; }) };
  function findStaff(id) { return staff.filter(function (s) { return s.id === id; })[0] || staff[0]; }

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
     สลิปที่ตรวจแล้ว — the verification record behind S39 (owner, 2026-08-04).
     Nothing on S39 is typed by hand: a payment lands here the moment its slip
     is verified on S22, and a month's กำไร is the sum of what was verified in
     that month. One consequence worth stating — the verification queue becomes
     the only place money enters the system, so S39 can never disagree with the
     receipts already in tenants' hands (CLAUDE.md rule 3).

     Expenses are gone entirely (owner: "we don't need payout"), so there is no
     cash book, no expense categories and no net calculation left. What the
     owner calls กำไร here is money actually received.

     Generated rather than hand-listed: 45 occupied rooms over six months is
     ~200 slips, and every one has to agree with the room's own rent and rates.
     Deterministic, so the demo never drifts between reloads.
     ------------------------------------------------------------------ */
  var VERIFY_MONTHS = [
    { sort: 256902, label: 'ก.พ. 69', hot: 0 },
    { sort: 256903, label: 'มี.ค. 69', hot: 1 },
    { sort: 256904, label: 'เม.ย. 69', hot: 2 },
    { sort: 256905, label: 'พ.ค. 69', hot: 1 },
    { sort: 256906, label: 'มิ.ย. 69', hot: 0 },
    { sort: 256907, label: 'ก.ค. 69', hot: 0 }
  ];
  var VERIFY_BY = ['เจ้าของ', 'นก', 'สมศักดิ์'];
  var VERIFY_METHODS = ['transfer', 'cash', 'qr'];

  var verifiedPayments = (function () {
    var out = [], seq = 0, invoiceNo = 900;
    VERIFY_MONTHS.forEach(function (m, mi) {
      rooms.filter(function (r) { return r.state === 'occupied' && r.rentalType === 'monthly'; })
        .forEach(function (r) {
          // One deterministic seed per room-month drives units, the pay date and
          // who verified it — same inputs, same slip, every reload.
          var n = parseInt(r.number, 10);
          var seed = (n * 37 + m.sort * 13) % 101;
          var eUnits = 38 + (seed % 42) + m.hot * 14;
          var wUnits = 7 + (seed % 11);
          var utility = eUnits * UTILITY_RATES.electric + wUnits * UTILITY_RATES.water;
          // A handful of rooms pay after the 5th and carry the ฿50/day late fee
          // frozen at verification (never recomputed — CLAUDE.md rule 3).
          var lateDays = (seed % 17 === 0) ? 1 + (seed % 4) : 0;
          var day = lateDays ? 5 + lateDays : 1 + (seed % 4);
          out.push({
            id: 'V-' + (++seq),
            invoice: ++invoiceNo,
            sort: m.sort, month: m.label,
            date: day + ' ' + m.label,
            room: r.number, tenant: r.occupant, kind: 'monthly',
            roomCharge: r.defaultRent,
            utility: utility,
            lateFee: lateDays * policy('lateFeePerDay'),
            total: r.defaultRent + utility + lateDays * policy('lateFeePerDay'),
            method: VERIFY_METHODS[seed % 3],
            // Different divisor from method, or every cash slip would land on
            // the same person and 15.4 would show one row.
            by: VERIFY_BY[(n + mi) % VERIFY_BY.length]
          });
        });
      // Daily stays: a few per month, priced off the room's own nightly rate.
      rooms.filter(function (r) { return r.rentalType === 'daily'; }).slice(0, 3).forEach(function (r, di) {
        var seed = (parseInt(r.number, 10) * 11 + m.sort + di) % 89;
        var nights = 2 + (seed % 5);
        out.push({
          id: 'V-' + (++seq),
          invoice: ++invoiceNo,
          sort: m.sort, month: m.label,
          date: (9 + (seed % 18)) + ' ' + m.label,
          room: r.number, tenant: r.occupant || 'ผู้เข้าพักรายวัน', kind: 'daily',
          roomCharge: r.defaultNightly * nights,
          utility: 0, lateFee: 0, nights: nights,
          total: r.defaultNightly * nights,
          method: VERIFY_METHODS[seed % 3],
          by: VERIFY_BY[(seed + di) % VERIFY_BY.length]
        });
      });
    });
    return out;
  })();

  // Newest month last, so the S39 chart reads left-to-right in time.
  function profitByMonth() {
    return VERIFY_MONTHS.map(function (m) {
      var rows = verifiedPayments.filter(function (p) { return p.sort === m.sort; });
      return {
        sort: m.sort, month: m.label, count: rows.length,
        amount: rows.reduce(function (s, p) { return s + p.total; }, 0)
      };
    });
  }
  function verifiedFor(sort) {
    return verifiedPayments.filter(function (p) { return p.sort === sort; })
      .slice().sort(function (a, b) { return b.invoice - a.invoice; });
  }
  function profitSummary(sort) {
    var all = profitByMonth();
    var current = all.filter(function (m) { return m.sort === sort; })[0] || all[all.length - 1];
    var avg = all.reduce(function (s, m) { return s + m.amount; }, 0) / all.length;
    return {
      current: current, avg: avg, months: all, count: all.length,
      diff: avg ? Math.round(((current.amount - avg) / avg) * 100) : 0
    };
  }
  // S40's 15.6 breakdown. Splits each verified slip into what it was actually
  // for, which is more use than one "รายรับ" bar — and it sums to the same กำไร.
  function verifiedByCategory(sort) {
    var rows = verifiedPayments.filter(function (p) { return p.sort === sort; });
    var buckets = [
      { label: 'ค่าเช่ารายเดือน', amount: 0 },
      { label: 'ค่าห้องรายวัน', amount: 0 },
      { label: 'ค่าน้ำ-ค่าไฟ', amount: 0 },
      { label: 'ค่าปรับล่าช้า', amount: 0 }
    ];
    rows.forEach(function (p) {
      buckets[p.kind === 'daily' ? 1 : 0].amount += p.roomCharge;
      buckets[2].amount += p.utility;
      buckets[3].amount += p.lateFee;
    });
    return buckets.filter(function (b) { return b.amount > 0; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }
  // Report 15.4 — cash only. A transfer reconciles itself against the bank;
  // cash is what a person is physically holding at the end of a shift. Only
  // money coming in now, since nothing pays money out any more.
  function cashInByStaff(sort) {
    var map = {};
    verifiedPayments.filter(function (p) { return p.sort === sort && p.method === 'cash'; })
      .forEach(function (p) {
        if (!map[p.by]) map[p.by] = { by: p.by, amount: 0, count: 0 };
        map[p.by].amount += p.total;
        map[p.by].count++;
      });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  /* ------------------------------------------------------------------
     Requests inbox — the destination for everything sent INTO the office.
     Two senders: tenants (แจ้งซ่อม/แจ้งทำความสะอาด/แจ้งย้ายออก from S33) and
     workers (a blocked or in-progress job reported from S30). Lifecycle per
     Business Rule 11.1: reported → assigned → in_progress → resolved. There is
     deliberately no "verified/closed" state — the rule says none exists.
     ------------------------------------------------------------------ */
  var REQUEST_TYPES = {
    repair:       { label: 'แจ้งซ่อม', icon: '🔧', badge: 'badge-warning' },
    cleaning:     { label: 'แจ้งทำความสะอาด', icon: '🧹', badge: 'badge-info' },
    moveout:      { label: 'แจ้งย้ายออก', icon: '📦', badge: 'badge-danger' },
    // Rule 4.9's second half: the tenant may ask to renew rather than waiting to
    // be chased. It is a request, never the renewal itself — staff still run S35,
    // because a renewal is a new contract with terms to agree (Rule 4.8).
    renewal:      { label: 'ขอต่อสัญญา', icon: '📄', badge: 'badge-info' }
  };
  // Nobody but the office touches this system now that workers have no phone
  // screens (owner, 2026-08-01), so `blocked` is a STATUS staff set after the
  // ช่าง phones in — not a request type, which would need a sender who can't
  // log in. `makesTask` is gone with S29/S30: assignment records who is
  // responsible, it no longer creates a job on anyone's device.
  var REQUEST_STATUS = {
    reported:    { label: 'ใหม่ — ยังไม่มอบหมาย', badge: 'badge-danger' },
    assigned:    { label: 'มอบหมายแล้ว', badge: 'badge-info' },
    in_progress: { label: 'กำลังดำเนินการ', badge: 'badge-warning' },
    blocked:     { label: 'ติดปัญหา — รอช่างข้างนอก', badge: 'badge-danger' },
    resolved:    { label: 'เสร็จแล้ว', badge: 'badge-success' }
  };
  var requests = [
    { id: 'R-101', room: '105', type: 'repair', from: 'คุณสมชาย ใจดี', fromRole: 'tenant',
      detail: 'ก๊อกน้ำในห้องน้ำปิดไม่สนิท น้ำหยดตลอดคืน', at: '31 ก.ค. 69 08:12', waitH: 3, status: 'reported' },
    { id: 'R-102', room: '210', type: 'cleaning', from: 'คุณวิชัย ทองคำ', fromRole: 'tenant',
      detail: 'ขอให้ทำความสะอาดห้องวันเสาร์นี้ (ทราบว่ามีค่าบริการ ฿200)', at: '31 ก.ค. 69 07:40', waitH: 4, status: 'reported' },
    { id: 'R-103', room: '312', type: 'repair', from: 'คุณสุนีย์ แสงจันทร์', fromRole: 'tenant',
      detail: 'แอร์ไม่เย็น', at: '30 ก.ค. 69 15:20', waitH: 20, status: 'blocked', assignee: 'นก',
      // What the ช่าง told the office by phone. Staff typed it here; the quoted
      // price is text until someone enters the real amount in the cash book.
      note: 'ช่างข้างนอกมาดูแล้ว — ต้องเปลี่ยนคอมเพรสเซอร์ เสนอราคา 2,800 บาท รวมค่าแรง รอสั่งของ' },
    { id: 'R-104', room: '115', type: 'moveout', from: 'คุณจิราพร วงศ์แก้ว', fromRole: 'tenant',
      detail: 'แจ้งย้ายออกสิ้นเดือนสิงหาคม ขอทราบขั้นตอนคืนเงินประกัน', at: '29 ก.ค. 69 19:05', waitH: 40, status: 'assigned', assignee: 'นก' },
    { id: 'R-105', room: '203', type: 'repair', from: 'คุณปิยะดา เจริญสุข', fromRole: 'tenant',
      detail: 'หลอดไฟหน้าห้องกระพริบ', at: '29 ก.ค. 69 10:15', waitH: 46, status: 'in_progress', assignee: 'ช่างโอ๋' },
    // 210 is the room deliberately inside the renewal window, so the request the
    // tenant can now send from S33 has a matching card here.
    { id: 'R-107', room: '210', type: 'renewal', from: 'คุณวิชัย ทองคำ', fromRole: 'tenant',
      detail: 'สัญญาครบ 20 ส.ค. 69 — ขอต่ออีก 12 เดือน อยู่ห้องเดิม', at: '31 ก.ค. 69 09:05', waitH: 2, status: 'reported' },
    { id: 'R-106', room: '104', type: 'cleaning', from: 'ระบบ (เช็คเอาท์)', fromRole: 'system',
      detail: 'ทำความสะอาดหลังเช็คเอาท์ — อัตโนมัติ ไม่มีค่าบริการ', at: '28 ก.ค. 69 11:00', waitH: 70, status: 'resolved', assignee: 'แดง' }
  ];
  /* ------------------------------------------------------------------
     Audit log (S45). Six screens tell the user "บันทึกในประวัติ" and S26
     ships an owner-only `audit_log` permission, but until now nothing read
     it back — the system made a promise it could not show. These are the
     actions the build actually claims to record, nothing invented.
     Append-only by definition: no screen edits or deletes a row here.
     ------------------------------------------------------------------ */
  var AUDIT_KINDS = {
    invoice_edit:   { label: 'แก้ไขบิล', icon: '☷', badge: 'badge-warning', pill: 'p-warn' },
    meter_fix:      { label: 'แก้ค่ามิเตอร์', icon: '⚡', badge: 'badge-warning', pill: 'p-warn' },
    rent_override:  { label: 'ตั้งราคาต่างจากมาตรฐาน', icon: '฿', badge: 'badge-warning', pill: 'p-warn' },
    verify:         { label: 'ตรวจสลิป', icon: '✓', badge: 'badge-success', pill: 'p-ok' },
    expense_delete: { label: 'ลบรายการบัญชี', icon: '✕', badge: 'badge-danger', pill: 'p-bad' },
    permission:     { label: 'แก้สิทธิ์พนักงาน', icon: '☺', badge: 'badge-info', pill: 'p-info' },
    price_change:   { label: 'แก้ราคามาตรฐาน', icon: '⚙', badge: 'badge-info', pill: 'p-info' },
    policy_change:  { label: 'แก้ตั้งค่าระบบ', icon: '⚖', badge: 'badge-info', pill: 'p-info' },
    contract:       { label: 'สัญญา', icon: '📄', badge: 'badge-info', pill: 'p-info' },
    deposit:        { label: 'คืน/ริบเงินประกัน', icon: '🔑', badge: 'badge-danger', pill: 'p-bad' }
  };
  // Newest first, which is how the screen shows them and how anyone reads a log.
  var auditLog = [
    { id: 'L-31', at: '31 ก.ค. 69 09:42', by: 'นก', kind: 'verify', target: 'บิล #1044 ห้อง 210',
      detail: 'ยืนยันการชำระ ฿4,690 — สลิปโอน 31 ก.ค. 08:55' },
    { id: 'L-30', at: '31 ก.ค. 69 09:20', by: 'เจ้าของ', kind: 'policy_change', target: 'ตั้งค่าระบบ',
      detail: 'ค่าปรับล่าช้า ฿50/วัน (ไม่เปลี่ยน) · ตรวจสอบค่าตั้งต้นทั้งหมด' },
    { id: 'L-29', at: '30 ก.ค. 69 16:10', by: 'เจ้าของ', kind: 'expense_delete', target: 'รายการ C-15 ฿620',
      detail: 'ลบ — เหตุผล: บันทึกซ้ำกับ C-16 (รายการยังอยู่แบบขีดฆ่า)' },
    { id: 'L-28', at: '30 ก.ค. 69 14:33', by: 'สมศักดิ์', kind: 'meter_fix', target: 'ห้อง 305 · ไฟฟ้า',
      detail: 'แก้จาก 3,412 เป็น 3,142 — เหตุผล: พิมพ์สลับหลัก (ค่าเดิมยังอยู่ในประวัติ)' },
    { id: 'L-27', at: '30 ก.ค. 69 11:05', by: 'นก', kind: 'invoice_edit', target: 'บิล #1042 ห้อง 105',
      detail: 'เพิ่มส่วนลด ฿200 — เหตุผล: แจ้งซ่อมแอร์ล่าช้า (ผู้เช่าเห็นประวัติการแก้ไขนี้)' },
    { id: 'L-26', at: '29 ก.ค. 69 15:48', by: 'เจ้าของ', kind: 'price_change', target: 'ห้องเตียงคู่',
      detail: 'ค่าเช่ามาตรฐาน ฿4,800 → ฿5,000 — มีผลกับสัญญาใหม่เท่านั้น' },
    { id: 'L-25', at: '29 ก.ค. 69 10:22', by: 'นก', kind: 'rent_override', target: 'ห้อง 104 · จองรายวัน',
      detail: 'ตั้งราคา ฿500/คืน ต่างจากมาตรฐาน ฿700 — เหตุผล: ลูกค้าประจำ' },
    { id: 'L-24', at: '28 ก.ค. 69 17:02', by: 'เจ้าของ', kind: 'permission', target: 'สมศักดิ์',
      detail: 'เปิดสิทธิ์ "ตรวจสลิป" · ปิดสิทธิ์ "ลบรายการบัญชี"' },
    { id: 'L-23', at: '28 ก.ค. 69 13:15', by: 'นก', kind: 'contract', target: 'ห้อง 407',
      detail: 'ปิดสัญญาก่อนกำหนด — ผู้เช่าย้ายออก 20 ก.ค. (ตกลงไว้ 12 เดือน อยู่จริง 17 เดือน)' },
    { id: 'L-22', at: '28 ก.ค. 69 13:14', by: 'นก', kind: 'deposit', target: 'ห้อง 407 · คุณอนันต์ รุ่งเรือง',
      detail: 'ริบเงินประกัน ฿3,500 — ย้ายออกก่อนครบสัญญา (หักได้ไม่เกินยอดที่วางไว้)' },
    { id: 'L-21', at: '27 ก.ค. 69 09:30', by: 'เจ้าของ', kind: 'price_change', target: 'อัตราค่าไฟฟ้า',
      detail: '฿7.50 → ฿9.00 ต่อหน่วย — มีผลกับบิลรอบถัดไป ไม่คิดย้อนหลัง' },
    { id: 'L-20', at: '26 ก.ค. 69 16:55', by: 'สมศักดิ์', kind: 'verify', target: 'บิล #1043 ห้อง 312',
      detail: 'ปฏิเสธสลิป — เหตุผล: ยอดในสลิปไม่ตรงกับยอดบิล (สลิปยังเก็บไว้ในระบบ)' }
  ];
  function auditByKind(kind) {
    return kind === 'all' ? auditLog : auditLog.filter(function (e) { return e.kind === kind; });
  }

  /* ------------------------------------------------------------------
     Six months of utility usage per room, for the tenant-facing chart on
     S34. The last month is not invented: it is the usage on that room's
     current invoice, so the chart and the bill the tenant is looking at
     can never disagree. Earlier months vary deterministically around it.
     Units, not baht — the rate is frozen per invoice (Rule 17) and a baht
     chart would imply the tenant's own usage changed when a rate changed.
     ------------------------------------------------------------------ */
  // `currentInvoice` is optional: a screen that is rendering a specific bill
  // passes it in, so the last bar always matches the bill on screen even when
  // that bill isn't the one `invoiceList` would find (the transfer month).
  function utilityHistory(roomNumber, currentInvoice) {
    var r = room(roomNumber);
    var inv = currentInvoice || invoiceList.filter(function (i) { return i.room === roomNumber; })[0];
    // Current month's units, straight off the bill where there is one. A transfer
    // month bills two utility periods on one invoice (Rules 10.1–10.4), and the
    // tenant used all of it, so the periods are summed rather than ignored.
    function unitsOf(which) {
      if (!inv) return null;
      if (inv.utilityPeriods) {
        return inv.utilityPeriods.reduce(function (s, p) { return s + (p[which] ? p[which].units : 0); }, 0);
      }
      return inv[which] ? inv[which].units : null;
    }
    var curE = unitsOf('electric') || 45;
    var curW = unitsOf('water') || 5;
    var n = Number(roomNumber);
    var labels = [], electric = [], water = [];
    var billMonth = TODAY.getMonth(); // July in the fixed demo clock
    for (var i = 5; i >= 0; i--) {
      var m = (billMonth - i + 12) % 12;
      labels.push(THAI_MONTHS[m]);
      if (i === 0) { electric.push(curE); water.push(curW); continue; }
      // Deterministic wobble: hotter months (Mar–May, index 2–4) run higher,
      // which is what an air-conditioned room's real chart looks like.
      var seasonal = (m >= 2 && m <= 4) ? 1.12 : (m >= 10 || m <= 1) ? 0.88 : 1;
      var jitter = 1 + (((n * 7 + i * 13) % 11) - 5) / 40;
      electric.push(Math.max(1, Math.round(curE * seasonal * jitter)));
      water.push(Math.max(1, Math.round(curW * (1 + (((n + i * 5) % 7) - 3) / 12))));
    }
    function avg(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
    return {
      labels: labels, electric: electric, water: water,
      roomType: r ? roomTypeOf(r) : null,
      // "You used N% more than your own average" — the line that makes the chart
      // actionable instead of decorative.
      electricVsAvg: Math.round((curE / avg(electric) - 1) * 100),
      waterVsAvg: Math.round((curW / avg(water) - 1) * 100)
    };
  }

  /* ------------------------------------------------------------------
     Report 15.5 — ทะเบียนผู้พัก. Legally mandated under the Hotel Act and
     collected at S12 with no skip path, but until now it could not be
     printed back out, which is the entire point of collecting it.
     Nationality defaults ไทย (CLAUDE.md); ID is masked in the UI.
     ------------------------------------------------------------------ */
  var guestRegister = [
    { no: 1, name: 'คุณนก สุวรรณ (Nok Suwan)', nationality: 'ไทย', idType: 'บัตรประชาชน', id: '3-4501-00xxx-xx-1',
      room: '104', inDate: '8 ก.ค. 69', outDate: '10 ก.ค. 69', by: 'นก' },
    { no: 2, name: 'Mr. James Carter', nationality: 'อังกฤษ', idType: 'พาสปอร์ต', id: 'GBR-52xxxx89',
      room: '107', inDate: '12 ก.ค. 69', outDate: '14 ก.ค. 69', by: 'สมศักดิ์' },
    { no: 3, name: 'คุณวรรณา ศรีสุข', nationality: 'ไทย', idType: 'บัตรประชาชน', id: '1-3399-00xxx-xx-7',
      room: '103', inDate: '5 ธ.ค. 68', outDate: '8 ธ.ค. 68', by: 'นก' },
    { no: 4, name: 'คุณสมหมาย พาณิชย์', nationality: 'ไทย', idType: 'บัตรประชาชน', id: '3-1002-00xxx-xx-4',
      room: '111', inDate: '18 ก.ค. 69', outDate: '19 ก.ค. 69', by: 'นก' },
    { no: 5, name: 'Ms. Linda Nguyen', nationality: 'เวียดนาม', idType: 'พาสปอร์ต', id: 'VNM-11xxxx02',
      room: '206', inDate: '20 ก.ค. 69', outDate: '23 ก.ค. 69', by: 'สมศักดิ์' },
    { no: 6, name: 'คุณพลอย จันทร์เพ็ญ', nationality: 'ไทย', idType: 'บัตรประชาชน', id: '5-3301-00xxx-xx-9',
      room: '108', inDate: '29 ก.ค. 69', outDate: '31 ก.ค. 69', by: 'นก' },
    { no: 7, name: 'คุณเจริญ มั่งมี', nationality: 'ไทย', idType: 'บัตรประชาชน', id: '3-3399-00xxx-xx-2',
      room: '213', inDate: '30 ก.ค. 69', outDate: '1 ส.ค. 69', by: 'สมศักดิ์' }
  ];

  // Report 15.8 — where daily bookings came from. Counts are for July 2569.
  var bookingSources = [
    { key: 'walkin', label: 'เดินเข้ามาเอง (Walk-in)', count: 19, revenue: 11400 },
    { key: 'phone',  label: 'โทรศัพท์', count: 11, revenue: 6600 },
    { key: 'line',   label: 'LINE', count: 8, revenue: 4800 },
    { key: 'repeat', label: 'ลูกค้าเก่ากลับมา', count: 5, revenue: 2500 },
    { key: 'refer',  label: 'ผู้เช่าเดิมแนะนำ', count: 3, revenue: 1750 }
  ];

  function openRequestCount() {
    return requests.filter(function (r) { return r.status !== 'resolved'; }).length;
  }
  function newRequestCount() {
    return requests.filter(function (r) { return r.status === 'reported'; }).length;
  }

  // Both read POLICY now, so changing the number in S43 changes every screen
  // that shows a late fee. Kept as getters because screens reference them by name.
  function lateFee(daysLate) {
    var billable = Math.max(0, daysLate - policy('graceDays'));
    return billable * policy('lateFeePerDay');
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
    invoiceDeletable: invoiceDeletable, invoiceDeleteBlockReason: invoiceDeleteBlockReason,
    utilityHistory: utilityHistory,
    readyToInvoiceRooms: readyToInvoiceRooms, invoicePreviewForRoom: invoicePreviewForRoom,
    metersPendingRooms: metersPendingRooms, meterPendingRoom: meterPendingRoom,
    ROOM_TYPES: ROOM_TYPES, roomTypeOf: roomTypeOf, ALL_ROOMS_AIRCON: ALL_ROOMS_AIRCON, rentFor: rentFor, nightlyFor: nightlyFor,
    contractOf: contractOf, AGREED_MONTH_OPTIONS: AGREED_MONTH_OPTIONS,
    verifiedPayments: verifiedPayments, verifiedFor: verifiedFor, VERIFY_MONTHS: VERIFY_MONTHS,
    profitByMonth: profitByMonth, profitSummary: profitSummary, verifiedByCategory: verifiedByCategory,
    cashInByStaff: cashInByStaff,
    REQUEST_TYPES: REQUEST_TYPES, REQUEST_STATUS: REQUEST_STATUS, requests: requests,
    openRequestCount: openRequestCount, newRequestCount: newRequestCount,
    activeTransfer: activeTransfer,
    thaiDate: thaiDate, addMonths: addMonths, isoDate: isoDate, parseISO: parseISO, TODAY: TODAY,
    UTILITY_RATES: UTILITY_RATES, searchAll: searchAll,
    pastTenants: pastTenants, TENANT_FLAGS: TENANT_FLAGS, directory: directory,
    registeredPhones: registeredPhones, registrationCheck: registrationCheck, completeRegistration: completeRegistration,
    auditLog: auditLog, AUDIT_KINDS: AUDIT_KINDS, auditByKind: auditByKind,
    guestRegister: guestRegister, bookingSources: bookingSources,
    lateFee: lateFee, POLICY: POLICY, policy: policy,
    get LATE_FEE_PER_DAY() { return policy('lateFeePerDay'); },
    get GRACE_DAYS() { return policy('graceDays'); },
    money: money,
    PERMISSIONS: PERMISSIONS, ROLE_PRESETS: ROLE_PRESETS, staff: staff, owner: owner, findStaff: findStaff,
    tenantHome: tenantHome
  };
})();
