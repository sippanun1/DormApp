/* Amanew prototype — shared demo data.
   One source for rooms/tenants/invoice numbers so every screen agrees.
   Deterministic (no Math.random) so a reload always looks the same. */
window.AmanewData = (function () {
  var THAI_NAMES = [
    'คุณสมชาย ใจดี', 'คุณมาลี พงษ์ไพศาล', 'คุณวิชัย ทองคำ', 'คุณสุนีย์ แสงจันทร์',
    'คุณประยุทธ์ ศรีสุข', 'คุณนงลักษณ์ บุญมี', 'คุณอนันต์ รุ่งเรือง', 'คุณจิราพร วงศ์แก้ว',
    'คุณธนากร ชัยมงคล', 'คุณปิยะดา เจริญสุข', 'คุณกิตติศักดิ์ ศิริวัฒน์', 'คุณวรรณา ศรีสุข'
  ];

  // 60 rooms, 4 floors, 15 rooms/floor (101-115, 201-215, 301-315, 401-415)
  var rooms = [];
  [1, 2, 3, 4].forEach(function (floor) {
    for (var n = 1; n <= 15; n++) {
      var number = String(floor * 100 + n);
      var rentalType = ((floor + n) % 3 === 0) ? 'daily' : 'monthly';
      var state;
      if (rentalType === 'monthly') {
        state = (n % 6 === 0) ? 'vacant' : 'occupied';
      } else {
        state = (n % 5 === 0) ? 'vacant' : (n % 5 === 1) ? 'reserved' : 'occupied';
      }
      var idx = (floor * 15 + n) % THAI_NAMES.length;
      rooms.push({
        number: number, floor: floor, rentalType: rentalType, state: state,
        occupant: state === 'occupied' ? THAI_NAMES[idx] : (state === 'reserved' ? THAI_NAMES[idx] : null),
        defaultRent: 3500 + (n % 3) * 300,
        defaultNightly: 450 + (n % 4) * 50
      });
    }
  });

  function room(number) { return rooms.filter(function (r) { return r.number === number; })[0]; }
  function override(number, patch) { var r = room(number); if (r) Object.assign(r, patch); }

  // Fixed demo scenarios — every screen refers to these same rooms.
  override('102', { rentalType: 'monthly', state: 'vacant', occupant: null });
  override('103', { rentalType: 'daily', state: 'vacant', occupant: null });
  override('104', {
    rentalType: 'daily', state: 'occupied', occupant: 'คุณนก สุวรรณ (Nok Suwan)',
    phone: '062-345-6789', checkIn: '8 ก.ค. 69', checkOut: '10 ก.ค. 69',
    nightlyRate: 500, nights: 2
  });
  override('105', {
    rentalType: 'monthly', state: 'occupied', occupant: 'คุณสมชาย ใจดี (Somchai Jaidee)',
    phone: '081-234-5678', startDate: '1 ม.ค. 69', deposit: 7000, rent: 4500,
    tenancyId: 'T-1005'
  });
  override('108', {
    rentalType: 'daily', state: 'reserved', occupant: 'คุณพลอย จันทร์เพ็ญ',
    phone: '089-555-1234', checkIn: '29 ก.ค. 69', checkOut: '31 ก.ค. 69', nightlyRate: 550
  });

  // Known tenants — matched by exact phone at lookup (S05).
  var tenants = [
    { name: 'คุณสมชาย ใจดี (Somchai Jaidee)', phone: '081-234-5678', history: '2 ครั้งก่อนหน้า — ห้อง 105 (ปัจจุบัน), ห้อง 210 (2568)' },
    { name: 'คุณนก สุวรรณ (Nok Suwan)', phone: '062-345-6789', history: '1 ครั้งก่อนหน้า — ห้อง 104 (ปัจจุบัน)' },
    { name: 'คุณพลอย จันทร์เพ็ญ', phone: '089-555-1234', history: '1 ครั้งก่อนหน้า — ห้อง 108 (จองไว้)' }
  ];
  function findTenantByPhone(phone) {
    return tenants.filter(function (t) { return t.phone === phone; })[0] || null;
  }

  // Invoice #1042 — Room 105, July 2026 (matches CLAUDE.md demo data exactly)
  var invoice = {
    number: 1042, room: '105', tenantName: 'คุณสมชาย ใจดี (Somchai Jaidee)',
    billingPeriod: 'กรกฎาคม 2569', dueDate: '5 ส.ค. 69',
    roomCharge: 4500,
    electric: { prev: 2458, cur: 2510, rate: 7.50 },
    water: { prev: 119, cur: 124, rate: 18.00 },
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
    { number: 1041, room: '104', tenant: 'คุณนก สุวรรณ',  total: 1290,  roomCharge: 1000, utilitySubtotal: 190, lateFeeFrozen: 100, dueDate: '3 ส.ค. 69', status: 'pending_verification', submittedBy: 'พนักงาน มานี', waitingDays: 4, method: 'transfer' },
    { number: 1039, room: '210', tenant: 'คุณวิชัย ทองคำ', total: 4820,  roomCharge: 4200, utilitySubtotal: 570, lateFeeFrozen: 50, dueDate: '1 ส.ค. 69', status: 'pending_verification', submittedBy: 'พนักงาน สมศักดิ์', waitingDays: 1, method: 'qr' },
    { number: 1035, room: '312', tenant: 'คุณสุนีย์ แสงจันทร์', total: 5100, roomCharge: 4500, utilitySubtotal: 600, lateFeeFrozen: 0, dueDate: '28 ก.ค. 69', status: 'paid' },
    { number: 1030, room: '109', tenant: 'คุณอนันต์ รุ่งเรือง', total: 3900, roomCharge: 3500, utilitySubtotal: 400, dueDate: '20 ก.ค. 69', status: 'rejected', reason: 'ยอดในสลิปไม่ตรงกับยอดใบแจ้งหนี้' }
  ];
  function findInvoice(number) {
    number = Number(number);
    return invoiceList.filter(function (i) { return i.number === number; })[0] || invoiceList[0];
  }

  var LATE_FEE_PER_DAY = 50;
  var GRACE_DAYS = 5;
  function lateFee(daysLate) {
    var billable = Math.max(0, daysLate - GRACE_DAYS);
    return billable * LATE_FEE_PER_DAY;
  }

  function money(n) { return '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }

  return {
    rooms: rooms, room: room, tenants: tenants, findTenantByPhone: findTenantByPhone,
    invoice: invoice, invoiceList: invoiceList, findInvoice: findInvoice,
    lateFee: lateFee, LATE_FEE_PER_DAY: LATE_FEE_PER_DAY, GRACE_DAYS: GRACE_DAYS,
    money: money
  };
})();
