// Masthead menu, shared by every Rent vs Buy page.
//
// The nav is plain markup that works with no JavaScript at all: without this
// file the links are simply always visible, which is a worse layout on a phone
// but never a broken one. Nothing here is required to reach a page.

(function () {
  var head = document.querySelector('.masthead');
  if (!head) return;
  var toggle = head.querySelector('.mast-toggle');
  var nav = head.querySelector('.mast-nav');
  if (!toggle || !nav) return;

  function setOpen(open) {
    head.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(!head.classList.contains('open'));
  });

  // Tapping a link navigates, but same-page anchors would otherwise leave the
  // menu covering what the reader just jumped to.
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });

  document.addEventListener('click', function (e) {
    if (!head.contains(e.target)) setOpen(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !head.classList.contains('open')) return;
    setOpen(false);
    toggle.focus();
  });

  // Leaving the breakpoint with the menu open would otherwise strand the
  // toggle in its cross state next to a nav the stylesheet has already shown.
  var wide = window.matchMedia('(min-width: 701px)');
  var onChange = function (e) { if (e.matches) setOpen(false); };
  if (wide.addEventListener) wide.addEventListener('change', onChange);
  else wide.addListener(onChange);
})();
