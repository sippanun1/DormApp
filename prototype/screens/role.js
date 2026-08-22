/* Amanew prototype — demo role switch (Admin/Staff/Worker), same
   carry-through-links pattern as switcher.js. Per the Frontend Specification:
   role-gated actions are hidden, not disabled-with-tooltip, and Worker never
   sees tenant names or financial data (§5.3 / cross-cutting frontend rules).
   Not part of the production design system — role is normally set by login,
   not a page control. */
(function () {
  function currentRole() {
    var r = new URLSearchParams(location.search).get('role');
    return (r === 'staff' || r === 'worker') ? r : 'admin';
  }

  function apply(role) {
    document.body.dataset.role = role;

    document.querySelectorAll('[data-admin-only]').forEach(function (el) {
      el.style.display = (role === 'admin') ? '' : 'none';
    });
    document.querySelectorAll('[data-hide-worker]').forEach(function (el) {
      el.style.display = (role === 'worker') ? 'none' : '';
    });

    var roleLabel = { admin: 'เจ้าของ (Admin)', staff: 'พนักงาน (Staff)', worker: 'ฝ่ายซ่อมบำรุง (Worker)' }[role];
    var roleInitial = { admin: 'อ', staff: 'พ', worker: 'ซ' }[role];
    document.querySelectorAll('.role-name').forEach(function (el) { el.textContent = roleLabel; });
    document.querySelectorAll('.role-avatar').forEach(function (el) { el.textContent = roleInitial; });

    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^https?:/i.test(href)) return;
      var hashSplit = href.split('#');
      var qIndex = hashSplit[0].indexOf('?');
      var base = qIndex === -1 ? hashSplit[0] : hashSplit[0].slice(0, qIndex);
      var params = new URLSearchParams(qIndex === -1 ? '' : hashSplit[0].slice(qIndex + 1));
      params.set('role', role);
      a.setAttribute('href', base + '?' + params.toString() + (hashSplit[1] ? '#' + hashSplit[1] : ''));
    });
  }

  window.AmanewRole = { current: currentRole, apply: apply };
  apply(currentRole());
})();
