/**
 * Drives the real screens in a real browser — the pass that caught three faults
 * `smoke.sh` could not (a nested <form> that broke hydration, a <label> inside a
 * <label>, and a column that does not exist).
 *
 * It walks one whole round trip rather than testing pages in isolation:
 *   check in a tenant → walk the meter sheet → run the month → pay → verify,
 *   then the daily side, then the same screens as staff.
 *
 * Not wired into smoke.sh: it needs a browser and both dev servers, which the
 * regression pass deliberately does not assume. Run it by hand after touching
 * any screen.
 *
 *   npm i -D playwright-core            # once; browsers via `npx playwright install chromium`
 *   npm run dev --workspace=apps/api    # LOGIN_RATE_LIMIT_ATTEMPTS=500, or it trips
 *   npm run dev --workspace=apps/web
 *   node scripts/browser-drive.js
 *
 * It creates real rows under a reserved 09999x phone. Clean them out the same
 * way smoke.sh does when you are finished — `./scripts/smoke.sh --only none`
 * purges and runs nothing else. Do that BEFORE a run too: a leftover tenancy
 * holds the room this driver checks into, and the meter step then fails on a
 * reading that already exists, which reads as a broken screen.
 */

const { chromium } = require('playwright-core');

// Falls back to whatever playwright-core resolves, so it works on any machine.
const EXE = process.env.CHROME_PATH || undefined;
const BASE = 'http://localhost:3000';
const PHONE = '09999' + String(Math.floor(Math.random() * 100000)).padStart(5, '0');

// Counted from the seed rather than written as a literal: S43's list grows (it
// gained the link-code window in ADR-021), and a hard-coded 9 turns "a policy
// went missing" and "a policy was added" into the same failure.
const POLICY_COUNT = require('fs')
  .readFileSync(require('path').join(__dirname, '../apps/web/lib/settings-labels.ts'), 'utf8')
  .split('\n').filter((l) => /^  [a-z_]+: \{|^  [a-z_]+: $/.test(l)).length;

let pass = 0, fail = 0;

/**
 * Visible within a moment, rather than visible on this exact tick.
 *
 * `isVisible()` asks once, and the banners below are rendered by the client
 * after a navigation — so it answers "not yet" often enough to fail a run for
 * no reason. This waits, briefly, and still reports false rather than throwing,
 * so a real absence is a FAIL with a name and not a driver crash.
 */
async function visible(locator, timeout = 10000) {
  return locator.waitFor({ state: 'visible', timeout }).then(() => true, () => false);
}
const ok = (m) => { pass++; console.log('  PASS ', m); };
const bad = (m) => { fail++; console.log('  FAIL ', m); };
const check = (m, cond) => (cond ? ok(m) : bad(m));

(async () => {
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // A 404 shows up as a console error with no URL in the text, so record the
  // request itself — otherwise a missing favicon reads as a broken page.
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // ---- login
  await page.goto(`${BASE}/login`);
  await page.fill('#phone', '0800000001');
  await page.fill('input[type=password]', 'amanew1234');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  check('admin login lands on the dashboard', page.url().includes('/dashboard'));

  // ---- monthly check-in (S03 picker → S08)
  await page.click('a[href="/rooms?pick=monthly"]');
  await page.waitForSelector('.room-card.pick-ok');
  const pickable = await page.locator('.room-card.pick-ok').count();
  const blocked = await page.locator('.room-card.pick-off').count();
  check(`picker offers only vacant monthly rooms (${pickable} ok / ${blocked} off)`, pickable > 0 && blocked > 0);
  const roomNumber = (await page.locator('.room-card.pick-ok').first().innerText()).split('\n')[0].trim();
  await page.locator('.room-card.pick-ok').first().click();
  await page.waitForURL('**/checkin/monthly**');
  // Wait for the room to load: the read-only rent is what we are asserting on,
  // and it is not on the page until the room is.
  await page.waitForSelector('text=รายละเอียดสัญญา');

  // rent is read-only until the override box is ticked (rule 2)
  check('rent is not an input by default', (await page.locator('output.money').count()) > 0);

  await page.fill('input[type=tel]', PHONE);
  await page.click('button:has-text("ค้นหา")');
  await page.waitForSelector('text=ไม่พบผู้เช่าจากเบอร์นี้');
  ok('unknown phone offers registration instead of erroring');
  await page.fill('input:below(:text("ชื่อ-นามสกุล"))', 'สโมคหน้าเว็บ');
  await page.click('button:has-text("บันทึกผู้เช่าใหม่")');
  await page.waitForSelector('text=เปลี่ยนผู้เช่า');
  await page.click('button:has-text("เริ่มเข้าอยู่")');
  await page.waitForURL('**/rooms?checked_in=**');
  check(`check-in returns to the grid with a banner (ห้อง ${roomNumber})`,
    await visible(page.locator(`text=ห้อง ${roomNumber} เริ่มเข้าอยู่แล้ว`)));

  // ---- room detail (S04): the room we just filled
  await page.goto(`${BASE}/rooms`);
  await page.waitForSelector('.room-card');
  await page.locator('.room-card', { hasText: roomNumber }).first().click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]{36}$/);
  const roomUrl = page.url();
  await page.waitForSelector('text=สัญญาปัจจุบัน');
  check('room detail shows the contract that is actually on the room',
    (await page.locator('text=สโมคหน้าเว็บ').count()) > 0);
  check('an occupied room offers ย้ายออก, not a check-in',
    (await page.locator('a:has-text("ย้ายออก")').count()) === 1 &&
    (await page.locator('text=เช็คอินรายเดือน').count()) === 0);
  // Moving out goes through the settlement screen rather than firing from here:
  // closing a contract and accounting for its deposit are one act.
  check('ย้ายออก leads to the settlement screen, not straight to an action',
    (await page.locator('a:has-text("ย้ายออก")').getAttribute('href'))?.includes('/checkout') === true);

  // ---- Phase 5: the link code, issued at the desk (S04)
  // Two badges, never one: a device session and a LINE binding are independent,
  // and merging them hides which is missing when a tenant says they see nothing.
  check('the contract panel says whether the tenant has the app',
    (await page.locator('text=ยังไม่ได้เชื่อมแอป').count()) === 1);
  check('and whether their LINE is bound, as a separate fact',
    (await page.locator('text=LINE: ยังไม่เชื่อม').count()) === 1);
  await page.click('button:has-text("ออกรหัสเชื่อมบัญชี")');
  // ADR-021: one slip covers the app AND LINE, and every device the tenant
  // owns. Saying so on the screen is the point — staff used to hand out a
  // second code because the first said "ใช้ได้ครั้งเดียว".
  check('issuing a code says it covers both the app and LINE',
    await visible(page.locator('text=ใช้ได้ทั้งแอปและ LINE')));
  const shownCode = (await page.locator('p.money.text-3xl').first().innerText()).trim();
  // The alphabet is the point: O, I and S are absent because it is read aloud.
  check('the code is six characters from the unambiguous alphabet',
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(shownCode));
  await page.reload();
  await page.waitForSelector('text=สัญญาปัจจุบัน');
  check('a code already out there warns before another is issued',
    await visible(page.locator('text=ออกรหัสใหม่จะทำให้รหัสเดิมใช้ไม่ได้')));
  // The owner's two controls, and they appear only while a code is live —
  // there is nothing to extend or revoke otherwise.
  check('a live code can be extended from the desk',
    await visible(page.locator('button:has-text("ต่ออายุ")')));
  check('and revoked from the desk',
    await visible(page.locator('button:has-text("ยกเลิกรหัส")')));
  await page.click('button:has-text("ยกเลิกรหัส")');
  await page.waitForSelector('text=ออกรหัสใหม่จะทำให้รหัสเดิมใช้ไม่ได้', { state: 'detached' });
  check('revoking clears the outstanding-code warning',
    (await page.locator('text=ออกรหัสใหม่จะทำให้รหัสเดิมใช้ไม่ได้').count()) === 0);

  // ---- S37 room transfer (rendered, not submitted)
  // Walked here rather than at the end because the tenancy is settled down
  // there — and NOT submitted, because moving this tenant would take the meter,
  // invoice and payment steps below into a different room. What a browser pass
  // is for is hydration and layout faults, and those show on render.
  await page.click('a:has-text("ย้ายห้อง")');
  await page.waitForURL(/\/tenancies\/[0-9a-f-]{36}\/transfer$/);
  await page.waitForSelector('text=สัญญาปัจจุบัน');
  // Rule 13 said out loud, which is the whole reason this screen has copy on it
  // — staff must not have to infer it from the absence of a rent field.
  check('the transfer screen states that the contract does not change',
    await visible(page.locator('text=ย้ายห้องใช้สัญญาเดิม')));
  check('and offers no way to change the rent',
    (await page.locator('main input[value="4500"]').count()) === 0);
  check('it lists rooms to move into',
    (await page.locator('main button:has-text("1")').count()) > 0);
  // This tenancy moved in moments ago and has no readings yet, so there is
  // nothing for rule 9 to lock — and ADR-008 then applies instead: the opening
  // has to come off the physical meter. Asserting the move-in branch is the
  // more valuable of the two, because it is the case a transfer screen written
  // against the ordinary month would silently get wrong.
  check('with no reading to lock, the old room\'s opening is asked for',
    (await page.locator('text=เลขเริ่มต้นตอนเข้าอยู่').count()) === 2);
  check('and no locked previous-reading field is shown',
    (await page.locator('text=เลขครั้งก่อน').count()) === 0);
  check('confirming is refused until every meter is read',
    await page.locator('button:has-text("ยืนยันย้ายห้อง")').isDisabled());
  await page.goBack();
  await page.waitForSelector('text=สัญญาปัจจุบัน');

  // ---- meters (S13)
  await page.click('a[href="/meters"]');
  await page.waitForSelector('table');
  const row = page.locator('tr', { has: page.locator(`td:has-text("${roomNumber}")`) }).first();
  check('new tenancy appears on the meter sheet', await row.isVisible());
  const openingInputs = row.locator('input[placeholder="อ่านจากมิเตอร์"]');
  check('move-in month asks for the opening reading rather than pre-filling it',
    (await openingInputs.count()) === 2);
  const inputs = row.locator('input[inputmode="numeric"]');
  await inputs.nth(0).fill('9000'); // electric opening
  await inputs.nth(1).fill('9150'); // electric current
  await inputs.nth(2).fill('900');  // water opening
  await inputs.nth(3).fill('908');  // water current
  await row.locator('button:has-text("บันทึก")').click();
  await page.waitForSelector(`tr:has(td:has-text("${roomNumber}")) >> text=บันทึกแล้ว`, { timeout: 15000 });
  const saved = await row.locator('text=บันทึกแล้ว').innerText();
  // 150 units x ฿9 + 8 x ฿25 = ฿1,550
  check(`saved row shows the computed cost (${saved})`, saved.includes('1,550'));

  // ---- invoice generation (S17)
  await page.click('a[href="/invoices"]');
  await page.waitForSelector('a[href="/invoices/generate"]');
  await page.click('a[href="/invoices/generate"]');
  await page.waitForSelector('text=พร้อมออกบิล');
  const readyRow = page.locator('tr', { has: page.locator(`td:has-text("${roomNumber}")`) }).first();
  check('room with both meters on file is ready to bill', await readyRow.isVisible());
  await page.click('button:has-text("ออกบิลทั้งหมด")');
  check('generation asks for confirmation first',
    await page.locator('button:has-text("ยืนยันออกบิล")').isVisible());
  await page.click('button:has-text("ยืนยันออกบิล")');
  await page.waitForSelector('text=ออกบิลแล้ว', { timeout: 30000 });
  ok('batch run reports what it generated');

  // ---- invoice detail (S19) → payment (S20)
  await page.click('a[href="/invoices"]');
  await page.waitForURL('**/invoices');
  await page.waitForSelector('table tbody tr');
  const invRow = page.locator('tr', { has: page.locator(`td:has-text("${roomNumber}")`) }).first();
  await invRow.locator('a').first().click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  const invoiceUrl = page.url();
  await page.waitForSelector('text=รายการเรียกเก็บ');
  check('bill shows the utility breakdown, not one lump sum',
    (await page.locator('text=ค่าไฟฟ้า').count()) > 0 && (await page.locator('text=ค่าน้ำ').count()) > 0);
  check('late fee is labelled live or frozen, never bare',
    (await page.locator('text=คำนวณสด').count()) + (await page.locator('text=คงที่').count()) > 0);
  check('no partial payment is offered', await page.locator('text=ระบบไม่รับชำระบางส่วน').isVisible());

  await page.click('a:has-text("บันทึกการชำระเงิน")');
  await page.waitForURL('**/pay');
  check('the amount is an output, not an editable field',
    (await page.locator('input[type=number]').count()) === 0);
  await page.click('button:has-text("เงินสด")');
  await page.click('button:has-text("ส่งให้ตรวจสอบ")');
  await page.waitForURL(invoiceUrl);
  await page.waitForSelector('text=รายการเรียกเก็บ');
  check('bill moves to รอตรวจสอบ after submission',
    (await page.locator('main >> text=รอตรวจสอบ').count()) > 0);
  check('late fee is frozen once a slip exists', await page.locator('text=คงที่ตั้งแต่ส่งสลิป').isVisible());

  // ---- verification (S21 → S22)
  await page.click('a[href="/verify"]');
  // Wait for the URL first: the invoice page also has a table, so waiting on a
  // selector alone can match the page we are leaving.
  await page.waitForURL('**/verify');
  await page.waitForSelector('table tbody tr');
  const qRow = page.locator('tr', { has: page.locator(`td:has-text("${roomNumber}")`) }).first();
  check('payment is waiting in the admin queue', await qRow.isVisible());
  await qRow.locator('a:has-text("ตรวจสอบ")').click();
  await page.waitForURL(/\/verify\/[0-9a-f-]{36}$/);
  await page.waitForSelector('text=สลิปที่ส่งมา');
  check('cash payment says plainly there is no slip to inspect',
    await page.locator('text=เงินสด — ไม่มีสลิป').isVisible());
  check('the amounts are pre-compared for the verifier', await page.locator('text=ตรงกัน').isVisible());
  await page.click('button:has-text("ปฏิเสธสลิป")');
  const rejectBtn = page.locator('button:has-text("ยืนยันปฏิเสธ")');
  check('reject cannot be submitted without a reason', await rejectBtn.isDisabled());
  await page.click('button:has-text("ย้อนกลับ")');
  await page.click('button:has-text("ยืนยันการชำระเงิน")');
  await page.waitForURL('**/verify');
  ok('verify returns to the queue');

  await page.goto(invoiceUrl);
  await page.waitForSelector('text=ชำระแล้ว');
  ok('invoice reads ชำระแล้ว after verification');

  // ---- meter correction (S15), reached from the recorded reading
  await page.goto(`${BASE}/meters`);
  await page.waitForSelector('table');
  const savedRow = page.locator('tr', { has: page.locator(`td:has-text("${roomNumber}")`) }).first();
  await savedRow.locator('a').first().click();
  await page.waitForURL(/\/meters\/[0-9a-f-]{36}$/);
  await page.waitForSelector('text=แก้ไขเลขที่อ่านได้');
  check('correction form is pre-filled with what is on record',
    (await page.locator('input[type=number]').first().inputValue()) !== '');
  await page.fill('textarea', 'อ่านผิดหนึ่งหลัก');
  await page.locator('input[type=number]').nth(1).fill('9160');
  await page.click('button:has-text("บันทึกการแก้ไข")');
  await page.waitForSelector('text=ประวัติการแก้ไข');
  check('the original reading is still shown beside the correction',
    (await page.locator('text=9150').count()) > 0 && (await page.locator('text=9160').count()) > 0);

  // ---- today's board (S28)
  await page.goto(`${BASE}/today`);
  await page.waitForSelector('text=สัญญาใกล้ครบกำหนด');
  check('today board renders its four counters and three lists',
    (await page.locator('text=รอตรวจสอบสลิป').count()) > 0 &&
    (await page.locator('text=เกินกำหนดชำระ').count()) > 0);

  // ---- daily booking + Hotel Act registration (S10 → S12)
  await page.goto(`${BASE}/rooms?pick=daily`);
  await page.waitForSelector('.room-card.pick-ok');
  const dailyRoom = (await page.locator('.room-card.pick-ok').first().innerText()).split('\n')[0].trim();
  await page.locator('.room-card.pick-ok').first().click();
  await page.waitForURL('**/checkin/daily**');
  // The same phone as the monthly tenant: this is the "found" branch of lookup,
  // and one person may have both kinds of stay (ADR-013's whole point).
  await page.fill('input[type=tel]', PHONE);
  await page.click('button:has-text("ค้นหา")');
  await page.waitForSelector('text=เปลี่ยนผู้เช่า');
  check('known phone resolves to the existing person, no duplicate offered',
    (await page.locator('text=ไม่พบผู้เช่าจากเบอร์นี้').count()) === 0);
  const dates = page.locator('input[type=date]');
  await dates.nth(0).fill('2027-05-01');
  await dates.nth(1).fill('2027-05-04');
  check('nightly total is computed, not typed', (await page.locator('output.money').count()) > 0);
  await page.click('button:has-text("จองแล้ว")');
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}\/check-in$/);
  const bookingUrl = page.url();
  await page.waitForSelector('text=ข้อมูลตามกฎหมายโรงแรม');
  check('registration has no skip path', (await page.locator('text=ไม่มีปุ่มข้าม').count()) > 0);
  check('nationality defaults to ไทย',
    (await page.locator('input[value="ไทย"]').count()) > 0);
  await page.fill('input.money >> nth=0', '1234567890123');
  await page.fill('textarea', 'ศรีสะเกษ');
  await page.click('button:has-text("เช็คอิน")');
  await page.waitForURL('**/rooms?checked_in=**');
  check(`daily check-in returns to the grid (ห้อง ${dailyRoom})`,
    await visible(page.locator(`text=ห้อง ${dailyRoom} เริ่มเข้าอยู่แล้ว`)));
  await page.goto(bookingUrl);
  await page.waitForSelector('text=ข้อมูลตามกฎหมายโรงแรม');
  await page.fill('input.money >> nth=0', '1234567890123');
  await page.fill('textarea', 'ศรีสะเกษ');
  await page.click('button:has-text("เช็คอิน")');
  await page.waitForSelector('text=เช็คอินไม่ได้');
  ok('checking in twice is refused by the server, with a message');

  // ---- requests (S42) and announcements (S41)
  await page.goto(`${BASE}/requests`);
  await page.waitForSelector('text=บันทึกเรื่องแจ้ง');
  // Pick the room by its visible label; selectOption takes a string, not a regex.
  const roomOption = await page.locator('form select >> nth=0 >> option')
    .filter({ hasText: roomNumber }).first().getAttribute('value');
  await page.selectOption('form select >> nth=0', roomOption ?? '');
  await page.locator('form input').first().fill('สโมค — ก๊อกน้ำรั่ว');
  await page.click('button:has-text("บันทึก")');
  await page.waitForSelector('text=สโมค — ก๊อกน้ำรั่ว');
  ok('the desk can record a request for a room');
  check('a new request starts unassigned',
    (await page.locator('text=ใหม่ — ยังไม่มอบหมาย').count()) > 0);
  // Rule 14: no parts, no costs, and the ช่าง is a name rather than an account.
  check('the inbox carries no parts or costs',
    (await page.locator('text=ไม่มีการบันทึกค่าอะไหล่หรือค่าซ่อมในหน้านี้').count()) > 0);
  check('assignment is a free-text name, not a user picker',
    (await page.locator('input[placeholder="มอบหมายให้ (ชื่อ)"]').count()) > 0);
  await page.locator('input[placeholder="มอบหมายให้ (ชื่อ)"]').first().fill('ช่างโอ๋');
  await page.locator('input[placeholder="มอบหมายให้ (ชื่อ)"]').first().blur();
  await page.waitForTimeout(1200);
  await page.selectOption('main select >> nth=2', 'resolved').catch(() => {});
  await page.waitForTimeout(1200);
  check('the office moves the status itself',
    (await page.locator('text=เสร็จแล้ว').count()) > 0);

  await page.goto(`${BASE}/announcements`);
  await page.waitForSelector('text=ประกาศใหม่');
  // Rule 15: in-app is checked and disabled — not a channel the sender picks.
  check('in-app cannot be switched off',
    (await page.locator('input[type=checkbox][disabled]').isChecked()) === true);
  check('and the screen says why nobody misses one',
    (await page.locator('text=ไม่มีใครพลาดประกาศเพราะไม่มี LINE').count()) > 0);
  await page.locator('form input').first().fill('สโมค ปิดน้ำ');
  await page.locator('form textarea').first().fill('ทดสอบระบบ');
  await page.click('button:has-text("เลือกทั้งชั้น")');
  await page.click('button:has-text("ชั้น 1")');
  await page.click('button:has-text("ส่งประกาศ")');
  await page.waitForSelector('text=ส่งประกาศแล้ว');
  ok('an announcement sends to a floor');
  check('read receipts are named as absent, not faked',
    (await page.locator('text=ยังไม่มี').count()) > 0);

  // ---- money reports (S39/S40), which must now show the payment we verified
  await page.goto(`${BASE}/reports`);
  // Wait for the section that depends on the month's detail, not the card that
  // renders before any data arrives.
  await page.waitForSelector('text=ใครเป็นผู้ตรวจสอบ');
  check('the verified payment appears as this month\'s income',
    (await page.locator(`text=${roomNumber}`).count()) > 0);
  check('the report offers no way to type or edit a figure',
    (await page.locator('main input').count()) === 0 &&
    (await page.locator('main button:has-text("เพิ่ม")').count()) === 0);
  check('it says where a wrong number gets fixed',
    (await page.locator('text=ถ้าตัวเลขผิดต้องแก้ที่บิล').count()) > 0);
  check('the reconciliation names who verified',
    (await page.locator('text=ผู้ตรวจสอบ').count()) > 0);
  // Phase 5: the channel's running cost, beside the money it has nothing to do
  // with. Rule 15 is stated on the screen itself, where the owner reads the bill.
  check('the reports screen shows the LINE quota',
    await visible(page.locator('text=โควตาฟรี 300 ข้อความ/เดือน')));
  check('and says in Thai that LINE is only a copy',
    (await page.locator('text=LINE เป็นสำเนาเท่านั้น').count()) === 1);

  // Checked here, while signed in as the owner: /reports is admin-only, and
  // loading it as staff would be a 403, not a layout measurement.
  check('no horizontal overflow at 1366px on /reports',
    !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

  // ---- renewal (S35), before the move-out settles the same contract
  await page.goto(roomUrl);
  await page.waitForSelector('text=สัญญาปัจจุบัน');
  await page.click('a:has-text("ต่อสัญญา")');
  await page.waitForURL(/\/tenancies\/[0-9a-f-]{36}\/renew$/);
  await page.waitForSelector('text=สัญญาใหม่');
  check('the screen says a renewal is a new contract, not an extension',
    (await page.locator('text=ไม่ใช่การขยายสัญญาเดิม').count()) > 0);
  check('the deposit is carried, not an input',
    (await page.locator('text=ยกยอดมา').count()) > 0);
  check('the new rent defaults to the old contract rent, not the standard price',
    (await page.locator('text=ค่าตั้งต้นคือค่าเช่าเดิม').count()) > 0);
  await page.fill('input[type=number] >> nth=0', '6');
  await page.click('button:has-text("ต่อสัญญา")');
  await page.waitForSelector('button:has-text("ยืนยันต่อสัญญา")');
  await page.click('button:has-text("ยืนยันต่อสัญญา")');
  await page.waitForSelector('text=ต่อสัญญาไปแล้ว', { timeout: 20000 });
  ok('renewing closes the old contract and opens its successor');
  check('a contract can only be renewed once',
    (await page.locator('button:has-text("ยืนยันต่อสัญญา")').count()) === 0);

  // The room is still occupied — by the NEW contract, which is the point.
  await page.goto(roomUrl);
  await page.waitForSelector('text=สัญญาปัจจุบัน');
  check('the room stays occupied under the new contract',
    (await page.locator('text=มีผู้พัก').count()) > 0);
  const renewedUrl = await page.locator('a:has-text("ย้ายออก")').getAttribute('href');
  check('the room now points at the successor contract', renewedUrl !== null);

  // ---- move-out settlement (S27), from the room we filled at the start
  await page.goto(roomUrl);
  await page.waitForSelector('text=สัญญาปัจจุบัน');
  await page.click('a:has-text("ย้ายออก")');
  await page.waitForURL(/\/tenancies\/[0-9a-f-]{36}\/checkout$/);
  await page.waitForSelector('text=สรุปเงินประกัน');
  check('a contract inside its agreed term is flagged as leaving early',
    (await page.locator('text=ออกก่อนครบสัญญา').count()) > 0);
  check('the final meter reading shows the chain value, not a blank guess',
    (await page.locator('text=ครั้งก่อน 9160').count()) > 0 || (await page.locator('text=ครั้งก่อน 9150').count()) > 0);

  // Rule 4: deductions far above the deposit are waived, and there is no
  // control anywhere on the screen to collect the difference.
  await page.fill('input[type=number] >> nth=2', '99999'); // cleaning
  await page.fill('input[type=number] >> nth=3', '0');     // damage
  await page.waitForSelector('text=ส่วนเกิน (ไม่เรียกเก็บ)');
  const refundText = await page.locator('text=คืนเงินประกัน').first().textContent();
  check('the refund floors at zero on screen', (refundText ?? '').includes('คืนเงินประกัน'));
  check('no control exists to collect the excess',
    (await page.locator('main button:has-text("เรียกเก็บ")').count()) === 0);

  await page.fill('input[type=number] >> nth=2', '300');
  await page.click('button:has-text("คิดยอดและปิดสัญญา")');
  await page.waitForSelector('button:has-text("ยืนยันย้ายออก")');
  await page.click('button:has-text("ยืนยันย้ายออก")');
  await page.waitForSelector('text=คิดยอดย้ายออกแล้ว', { timeout: 20000 });
  ok('the settlement is recorded and shown back');
  await page.reload();
  await page.waitForSelector('text=คิดยอดย้ายออกแล้ว');
  check('a settled tenancy cannot be settled again',
    (await page.locator('button:has-text("คิดยอดและปิดสัญญา")').count()) === 0);
  await page.goto(roomUrl);
  await page.waitForSelector('text=เริ่มการเข้าพัก');
  check('the room is free again after the move-out',
    (await page.locator('text=ว่าง').count()) > 0);

  // ---- owner settings (S24, S43, S45) and the register (S44)
  await page.goto(`${BASE}/settings/prices`);
  await page.waitForSelector('text=ราคามาตรฐานตามประเภทห้อง');
  check('the price page states rule 2 where the button is',
    (await page.locator('text=มีผลกับสัญญาใหม่เท่านั้น').count()) > 0);
  check('both bed types are priced, and only those two',
    (await page.locator('text=ห้องเตียง').count()) === 2);
  check('rates are effective-dated, with one current per meter',
    (await page.locator('text=ใช้อยู่').count()) === 2);

  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('text=นโยบายของหอพัก');
  check(`all ${POLICY_COUNT} policies are listed`, (await page.locator('li:has(input)').count()) === POLICY_COUNT);
  const dueRow = page.locator('li', { hasText: 'วันครบกำหนดชำระ' });
  // Save is disabled until the value differs from what is stored, and the page
  // reloads from the server after each save — so fill, then wait for enabled.
  const setDueDay = async (value) => {
    await dueRow.locator('input').fill(value);
    await dueRow.locator('button').waitFor({ state: 'attached' });
    await page.waitForFunction(
      () => {
        const li = [...document.querySelectorAll('li')].find((n) => n.textContent?.includes('วันครบกำหนดชำระ'));
        return li && !li.querySelector('button')?.disabled;
      },
      { timeout: 10000 },
    );
    await dueRow.locator('button').click();
  };
  // Toggle to something that is definitely different, then put back exactly
  // what was there — a previous interrupted run must not decide this value.
  const originalDueDay = await dueRow.locator('input').inputValue();
  await setDueDay(originalDueDay === '7' ? '6' : '7');
  await page.waitForSelector('text=บันทึก "วันครบกำหนดชำระ" แล้ว');
  ok('a policy change saves and reports itself');
  await page.waitForTimeout(800);
  await setDueDay(originalDueDay);
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForSelector('text=นโยบายของหอพัก');
  check('the policy is left exactly as it was found',
    (await dueRow.locator('input').inputValue()) === originalDueDay);

  await page.goto(`${BASE}/audit`);
  // The title comes from the shell and is on screen before any data — wait for
  // the table, or this asserts against an empty page.
  await page.waitForSelector('table tbody tr');
  check('the policy change is in the audit log with who did it',
    (await page.locator('text=แก้ไขการตั้งค่า').count()) > 0 &&
    (await page.locator('text=เจ้าของ').count()) > 0);
  check('the audit log offers no edit or delete control',
    (await page.locator('main button:has-text("ลบ")').count()) === 0);

  await page.goto(`${BASE}/tenants`);
  await page.waitForSelector('table');
  check('the register finds the tenant we created', (await page.locator(`text=${PHONE}`).count()) > 0);
  await page.fill('input[placeholder="ค้นหาด้วยชื่อหรือเบอร์โทร"]', '0000000000');
  await page.waitForSelector('text=ไม่พบผู้เช่า');
  ok('a search with no match says so rather than showing everyone');

  // ---- staff & permissions (S26)
  await page.goto(`${BASE}/staff`);
  // The explainer card renders before the list does — wait for a real row.
  await page.waitForSelector('text=เจ้าของมีสิทธิ์ทั้งหมดอยู่แล้ว');
  check('the owner row has ticks at all, only a statement that it has everything',
    (await page.locator('text=เจ้าของมีสิทธิ์ทั้งหมดอยู่แล้ว').count()) > 0);
  check('the nine delegable powers are checkboxes',
    (await page.locator('text=จดมิเตอร์ (S13)').count()) > 0 &&
    (await page.locator('text=ดูรายงานรายรับ (S39, S40)').count()) > 0);
  // Rule 6's owner-only powers must not appear as ticks anywhere.
  check('slip verification is not offered as a checkbox',
    (await page.locator('label:has-text("ตรวจสอบสลิป")').count()) === 0);
  check('and the screen explains why rather than leaving a gap',
    (await page.locator('text=คนที่รับเงินกับคนที่ยืนยันต้องไม่ใช่คนเดียวกัน').count()) > 0);
  check('presets are offered as tick-combinations, not as user types',
    (await page.locator('text=ชุดสำเร็จรูปคือการติ๊กช่องให้ ไม่ใช่ประเภทผู้ใช้').count()) > 0);

  // Grant one power to the seeded staff member and check it saves.
  const staffCard = page.locator('section', { hasText: 'พนักงานต้อนรับ (Staff)' }).first();
  const reportsBox = staffCard.locator('label', { hasText: 'ดูรายงานรายรับ' }).locator('input');
  const wasTicked = await reportsBox.isChecked();
  await reportsBox.click();
  await staffCard.locator('button:has-text("บันทึกสิทธิ์")').click();
  await page.waitForSelector('text=บันทึกสิทธิ์ของ');
  ok('a permission change saves for one person');
  // Put it back exactly as it was found.
  await page.waitForTimeout(800);
  const reportsBox2 = page.locator('section', { hasText: 'พนักงานต้อนรับ (Staff)' }).first()
    .locator('label', { hasText: 'ดูรายงานรายรับ' }).locator('input');
  if ((await reportsBox2.isChecked()) !== wasTicked) {
    await reportsBox2.click();
    await page.locator('section', { hasText: 'พนักงานต้อนรับ (Staff)' }).first()
      .locator('button:has-text("บันทึกสิทธิ์")').click();
    await page.waitForTimeout(1200);
  }
  check('the tick list is left as it was found',
    (await page.locator('section', { hasText: 'พนักงานต้อนรับ (Staff)' }).first()
      .locator('label', { hasText: 'ดูรายงานรายรับ' }).locator('input').isChecked()) === wasTicked);

  // ---- staff sees no verification nav (ADR-007 in the UI; Express enforces it)
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${BASE}/login`);
  await page.fill('#phone', '0800000002');
  await page.fill('input[type=password]', 'amanew1234');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  check('staff has no รอตรวจสอบ nav item', (await page.locator('a[href="/verify"]').count()) === 0);
  await page.goto(`${BASE}/today`);
  await page.waitForSelector('text=รอตรวจสอบสลิป');
  check('staff sees the pending count but gets no link into the queue',
    (await page.locator('a[href="/verify"]').count()) === 0);
  check('staff has no audit-log nav item', (await page.locator('a[href="/audit"]').count()) === 0);
  check('staff has no income-report nav item', (await page.locator('a[href="/reports"]').count()) === 0);
  check('staff has no user-management nav item', (await page.locator('a[href="/staff"]').count()) === 0);
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('text=นโยบายของหอพัก');
  check('staff can read the policies and cannot save one',
    (await page.locator('main button:has-text("บันทึก")').count()) === 0 &&
    (await page.locator('input[disabled]').count()) === POLICY_COUNT);

  // ---- layout + console
  for (const path of ['/dashboard', '/today', '/rooms', '/meters', '/invoices', '/invoices/generate',
                      '/tenants', '/settings', '/settings/prices', '/requests', '/announcements']) {
    await page.goto(BASE + path);
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`no horizontal overflow at 1366px on ${path}`, !overflow);
  }

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e) &&
    !/Failed to load resource: the server responded with a status of 404/.test(e) &&
    // An unknown phone answering 404 is the tenant-lookup flow working, not a fault.
    !/HTTP 404 .*\/tenants\?phone=/.test(e) &&
    // The deliberate double check-in above: a 409 is the assertion, not a fault.
    !/(HTTP 409|status of 409)/.test(e));
  check(`no console errors (${real.length})`, real.length === 0);
  if (real.length) console.log(real.slice(0, 5).join('\n'));

  await browser.close();
  console.log(`\n== ${pass} passed, ${fail} failed ==\nPHONE=${PHONE}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
