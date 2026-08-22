/* Amanew prototype — shared demo behaviors (cross-cutting interaction rules
   from the Master Document, Section 11 UI pattern principles + build brief
   "Interaction rules for ALL screens"). Small helpers reused across screens,
   not a framework:
   - Primary-button spinner while a "request" is in flight (no optimistic UI)
   - Dialog/modal: Escape closes, focus returns to the opener
   - Unsaved-changes guard on full-screen forms
   - Tab switching (Monthly/Daily/All, invoice filters) */
window.Demo = (function () {
  var lastOpener = null;

  function submitWithSpinner(form, onDone, delay) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('[data-primary]');
      if (!btn || btn.disabled) return;
      var original = btn.innerHTML;
      btn.disabled = true;
      btn.dataset.originalLabel = original;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> กำลังบันทึก…';
      setTimeout(function () {
        onDone(e, function restore() {
          btn.disabled = false;
          btn.innerHTML = btn.dataset.originalLabel;
        });
      }, delay || 700);
    });
  }

  function openDialog(id, opener) {
    var el = document.getElementById(id);
    if (!el) return;
    lastOpener = opener || document.activeElement;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    var focusable = el.querySelector('button, [href], input, select, textarea');
    if (focusable) focusable.focus();
  }

  function closeDialog(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    if (lastOpener && lastOpener.focus) lastOpener.focus();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelectorAll('.dialog-overlay.open, .modal-overlay.open');
    if (!open.length) return;
    closeDialog(open[open.length - 1].id);
  });

  document.addEventListener('click', function (e) {
    var overlay = e.target.closest('.dialog-overlay, .modal-overlay');
    if (overlay && e.target === overlay) closeDialog(overlay.id);
  });

  // Unsaved-changes guard: "Leave without saving? — Discard / Stay"
  var dirtyForms = new WeakSet();
  function guardUnsaved(form) {
    form.addEventListener('input', function () { dirtyForms.add(form); });
    form.addEventListener('submit', function () { dirtyForms.delete(form); });
    document.querySelectorAll('a[href]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (dirtyForms.has(form)) {
          var ok = confirm('ออกโดยไม่บันทึก? ข้อมูลที่กรอกจะหายไป — Discard / Stay');
          if (!ok) e.preventDefault();
          else dirtyForms.delete(form);
        }
      });
    });
  }

  function bindTabs(container, onSwitch) {
    container.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        onSwitch(btn.dataset.tab);
      });
    });
  }

  return {
    submitWithSpinner: submitWithSpinner,
    openDialog: openDialog,
    closeDialog: closeDialog,
    guardUnsaved: guardUnsaved,
    bindTabs: bindTabs
  };
})();
