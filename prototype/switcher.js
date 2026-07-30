/* Amanew prototype — style switcher (demo tool).
   Sets data-style on <body> and carries ?style= across page links,
   so the whole prototype can be browsed in A, B or C. */
(function () {
  var NAMES = {
    a: 'A · เรียบ มืออาชีพ (Clean Professional)',
    b: 'B · อบอุ่น ใช้ง่าย (Warm Thai)',
    c: 'C · ทันสมัย จริงจัง (Bold Operator)'
  };

  function apply(style) {
    document.body.dataset.style = style;
    var buttons = document.querySelectorAll('.style-switcher button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].dataset.s === style);
    }
    // carry the chosen style through every internal link, preserving
    // any other query params the link already carries (e.g. S34
    // Layout 2's ?pay=1 deep link from S33's inline Pay Now shortcut)
    // instead of dropping them.
    var links = document.querySelectorAll('a[href]');
    for (var j = 0; j < links.length; j++) {
      var href = links[j].getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^https?:/i.test(href)) continue;
      var hashSplit = href.split('#');
      var qIndex = hashSplit[0].indexOf('?');
      var base = qIndex === -1 ? hashSplit[0] : hashSplit[0].slice(0, qIndex);
      var params = new URLSearchParams(qIndex === -1 ? '' : hashSplit[0].slice(qIndex + 1));
      params.set('style', style);
      links[j].setAttribute('href', base + '?' + params.toString() + (hashSplit[1] ? '#' + hashSplit[1] : ''));
    }
  }

  var initial = new URLSearchParams(location.search).get('style');
  if (!['a', 'b', 'c'].includes(initial)) initial = document.body.dataset.style || 'a';

  var box = document.createElement('div');
  box.className = 'style-switcher';
  box.innerHTML = '<span class="ss-label">สไตล์</span>' +
    ['a', 'b', 'c'].map(function (s) {
      return '<button type="button" data-s="' + s + '" title="' + NAMES[s] + '">' + s.toUpperCase() + '</button>';
    }).join('');
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) apply(b.dataset.s);
  });
  document.body.appendChild(box);

  apply(initial);
})();
