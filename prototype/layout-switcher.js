/* Amanew prototype — layout switcher (demo tool).
   Auto-detects "s##-layoutN.html" in the current URL — OR a canonical file
   that itself IS Layout 1 for its screen (see CANONICAL_LAYOUT1 below) — and
   renders a floating pill (bottom-left, mirrors style-switcher's bottom-right)
   linking to the sibling layout files, carrying ?style= and any other
   query params along so switching layout never loses the chosen style. */
(function () {
  // S02/S03/S05 have no separate "layout1.html" — their canonical file IS
  // Layout 1 (the layout1.html copies were deleted as exact duplicates).
  // This map is used both to build the "1" link on layout2/3 pages AND to
  // recognize when the current page itself is one of these canonical files.
  var CANONICAL_LAYOUT1 = { s02: 'dashboard', s03: 'room-grid', s05: 'daily-calendar' };

  var m = location.pathname.match(/^(.*\/)?(s\d+)-layout(\d)\.html$/);
  var dir, prefix, current;
  if (m) {
    dir = m[1] || '';
    prefix = m[2];
    current = m[3];
  } else {
    var fm = location.pathname.match(/^(.*\/)?([^\/]+)$/);
    var fname = fm ? fm[2] : '';
    var canonPrefix = Object.keys(CANONICAL_LAYOUT1).filter(function (p) {
      return fname === p + '-' + CANONICAL_LAYOUT1[p] + '.html';
    })[0];
    if (!canonPrefix) return;
    dir = fm[1] || '';
    prefix = canonPrefix;
    current = '1';
  }

  var box = document.createElement('div');
  box.className = 'layout-switcher';
  var label = document.createElement('span');
  label.className = 'ls-label';
  label.textContent = 'เลย์เอาต์';
  box.appendChild(label);

  ['1', '2', '3'].forEach(function (n) {
    var a = document.createElement('a');
    a.textContent = n;
    var file = (n === '1' && CANONICAL_LAYOUT1[prefix])
      ? prefix + '-' + CANONICAL_LAYOUT1[prefix] + '.html'
      : prefix + '-layout' + n + '.html';
    a.href = dir + file + location.search;
    if (n === current) a.classList.add('active');
    box.appendChild(a);
  });

  var pickerLink = document.createElement('a');
  pickerLink.className = 'ls-picker-link';
  pickerLink.href = dir + prefix + '-layout-picker.html' + location.search;
  pickerLink.title = 'เปรียบเทียบทั้ง 3 เลย์เอาต์';
  pickerLink.textContent = '⊞';
  box.appendChild(pickerLink);

  document.body.appendChild(box);
})();
