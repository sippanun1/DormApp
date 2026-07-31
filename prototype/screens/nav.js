/* Amanew prototype — persistent navigation shell (sidebar + topbar).
   Injected via JS so all 17 screens share exactly one definition instead of
   copy-pasted markup drifting screen to screen. Reads data-screen/data-title
   off <body> to highlight the active item and label the topbar.
   Nav items per the build brief: Dashboard | Invoices | Verify payments |
   Room settings — the latter two are Admin-only (hidden, not disabled).
   Staff & permissions (S26) added 2026-07-30 at owner request, Admin-only. */
(function () {
  var NAV_GROUPS = {
    S02: 'dash', S04: 'dash', S05: 'dash', S06: 'dash', S07: 'dash', S08: 'dash',
    S09: 'dash', S10: 'dash', S11: 'dash', S12: 'dash', S13: 'dash', S35: 'dash', S37: 'dash',
    S16: 'inv', S17: 'inv', S18: 'inv', S19: 'inv', S20: 'inv',
    S21: 'verify', S22: 'verify', S23: 'verify',
    S24: 'settings', S25: 'settings',
    S26: 'staff',
    S42: 'inbox',
    S39: 'money', S40: 'money',
    S41: 'announce'
  };

  var screenId = document.body.dataset.screen || '';
  var screenTitle = document.body.dataset.title || '';
  if (!screenId) return; // S01 login has no shell

  var qs = location.search;
  var activeGroup = NAV_GROUPS[screenId] || '';

  var data = window.AmanewData;
  var unpaidCount = data ? data.invoiceList.filter(function (i) { return i.status === 'unpaid'; }).length : 0;
  var verifyCount = data ? data.invoiceList.filter(function (i) { return i.status === 'pending_verification'; }).length : 0;
  var inboxCount = data && data.newRequestCount ? data.newRequestCount() : 0;

  var items = [
    { key: 'dash', href: 's02-dashboard.html', icon: '▦', label: 'แดชบอร์ด' },
    { key: 'inv', href: 's18-invoice-list.html', icon: '☷', label: 'ใบแจ้งหนี้', count: unpaidCount },
    { key: 'verify', href: 's21-verification-queue.html', icon: '✓', label: 'ตรวจสอบสลิป', count: verifyCount, adminOnly: true },
    // Label says "ราคา" out loud: room prices live here and nowhere else, and the
    // old bare "ตั้งค่าห้อง" didn't tell anyone that.
    { key: 'settings', href: 's24-room-settings.html', icon: '⚙', label: 'ห้องและราคา', adminOnly: true },
    // Cash book + reports: the owner's own view of the business (Business Rules
    // §13/§15). Announcements are staff-usable, so not admin-gated.
    // Everything sent INTO the office — tenant requests + worker reports.
    { key: 'inbox', href: 's42-requests-inbox.html', icon: '✉', label: 'เรื่องแจ้งเข้า', count: inboxCount },
    { key: 'money', href: 's39-cash-book.html', icon: '฿', label: 'รายรับ-รายจ่าย', adminOnly: true },
    { key: 'announce', href: 's41-announcements.html', icon: '📣', label: 'ประกาศ' },
    { key: 'staff', href: 's26-staff-permissions.html', icon: '☺', label: 'พนักงานและสิทธิ์', adminOnly: true }
  ];

  var navHtml = items.map(function (it) {
    var attrs = it.adminOnly ? ' data-admin-only' : '';
    var active = it.key === activeGroup ? ' active' : '';
    var count = it.count ? '<span class="nav-count">' + it.count + '</span>' : '';
    return '<a class="nav-item' + active + '" href="' + it.href + qs + '"' + attrs + '>' +
      '<span class="nav-ic">' + it.icon + '</span><span>' + it.label + '</span>' + count + '</a>';
  }).join('');

  var sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.innerHTML =
    '<div class="brand"><span class="logo-dot">A</span><span>อมาเนว์ เรสซิเดนซ์</span></div>' +
    '<div class="nav-section">เมนูหลัก</div>' +
    navHtml;

  var topbar = document.createElement('div');
  topbar.className = 'topbar';
  topbar.innerHTML =
    '<span class="screen-id">' + screenId + ' · ' + screenTitle + '</span>' +
    '<h1>' + screenTitle + '</h1>' +
    '<div class="spacer"></div>' +
    // Global lookup — "who is in 105", "where is คุณสมชาย", "is #1042 paid".
    // Deliberately NOT the check-in entry point: that starts on the floor plan.
    '<div class="topbar-search">' +
      '<span class="ts-ic">🔍</span>' +
      '<input type="search" id="global-search" placeholder="ค้นหา เลขห้อง / ชื่อ / เบอร์โทร / เลขบิล" autocomplete="off">' +
      '<div class="ts-results" id="ts-results"></div>' +
    '</div>' +
    '<span class="date-chip">Amanew Residence ศรีสะเกษ</span>' +
    '<div class="user-chip"><span class="avatar role-avatar">อ</span><span class="role-name">เจ้าของ (Admin)</span></div>' +
    '<a class="btn btn-ghost btn-sm" href="s01-login.html">ออกจากระบบ</a>';

  var pageContent = document.getElementById('page-content');
  var main = document.createElement('div');
  main.className = 'main';
  main.appendChild(topbar);

  var app = document.createElement('div');
  app.className = 'app';
  app.appendChild(sidebar);
  app.appendChild(main);

  document.body.insertBefore(app, pageContent);
  main.appendChild(pageContent);

  // Success banner on arrival (Section 11 rule: banner on destination, not a
  // silent redirect) — carried via ?banner=, shown once at the top of the page.
  var bannerMsg = new URLSearchParams(qs).get('banner');
  if (bannerMsg) {
    var banner = document.createElement('div');
    banner.className = 'success-banner';
    banner.textContent = '✓ ' + decodeURIComponent(bannerMsg);
    pageContent.insertBefore(banner, pageContent.firstChild);
  }

  // ---- Global search behaviour ----
  var searchInput = document.getElementById('global-search');
  var resultsBox = document.getElementById('ts-results');
  if (searchInput && data && data.searchAll) {
    var cursor = -1;

    var runSearch = function () {
      var hits = data.searchAll(searchInput.value);
      cursor = -1;
      if (!searchInput.value.trim()) { resultsBox.classList.remove('open'); return; }
      if (!hits.length) {
        resultsBox.innerHTML = '<div class="ts-empty">ไม่พบข้อมูลที่ตรงกัน</div>';
        resultsBox.classList.add('open');
        return;
      }
      var ICON = { room: '▦', tenant: '☺', invoice: '☷' };
      resultsBox.innerHTML = hits.map(function (h) {
        // Carry the demo role/query params through, same as every nav link.
        var sep = h.href.indexOf('?') === -1 ? '?' : '&';
        var href = h.href + (qs ? sep + qs.replace(/^\?/, '') : '');
        return '<a href="' + href + '">' +
          '<span class="ts-label">' + ICON[h.kind] + ' ' + h.label + '</span>' +
          '<span class="ts-sub">' + h.sub + '</span></a>';
      }).join('');
      resultsBox.classList.add('open');
    };

    searchInput.addEventListener('input', runSearch);
    searchInput.addEventListener('focus', runSearch);

    searchInput.addEventListener('keydown', function (e) {
      var links = resultsBox.querySelectorAll('a');
      if (e.key === 'Escape') { resultsBox.classList.remove('open'); searchInput.blur(); return; }
      if (!links.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach(function (a, i) { a.classList.toggle('cursor', i === cursor); });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        (links[cursor] || links[0]).click();
      }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.topbar-search')) resultsBox.classList.remove('open');
    });
  }

  // Re-apply role now that the sidebar/topbar nodes exist (role.js ran
  // before this shell was built, so its first pass had nothing to hide yet).
  if (window.AmanewRole) window.AmanewRole.apply(window.AmanewRole.current());
})();
