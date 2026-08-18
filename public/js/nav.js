(function () {
  const navbar = document.querySelector('.navbar');
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('.nav-menu');

  // ── Hamburger ──────────────────────────────────────────────────────────────
  function closeAllDropdowns() {
    document.querySelectorAll('.dropdown--open').forEach(function (li) {
      li.classList.remove('dropdown--open');
      const caret = li.querySelector('.dropdown-caret');
      if (caret) caret.setAttribute('aria-expanded', 'false');
    });
  }

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function () {
      const open = navMenu.classList.toggle('active');
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      // Collapsing the menu should not leave submenus expanded behind it.
      if (!open) closeAllDropdowns();
    });
  }

  // ── Submenu disclosure ─────────────────────────────────────────────────────
  // CSS also opens these on :hover at desktop widths. Touch has no hover, so below
  // 1024px this button is the only way to reach the pages underneath — without it
  // /bios and /man-crush-monday were unreachable on a phone. The class this toggles is
  // what aria-expanded reports, which is why :focus-within must not open the menu too.
  document.querySelectorAll('.dropdown-caret').forEach(function (caret) {
    caret.addEventListener('click', function () {
      const li = caret.closest('.dropdown');
      if (!li) return;
      const open = !li.classList.contains('dropdown--open');
      closeAllDropdowns();
      if (open) li.classList.add('dropdown--open');
      caret.setAttribute('aria-expanded', String(open));
    });
  });

  // A caret click pins the submenu open, so it needs a way out other than the caret
  // itself: without this, clicking the caret at desktop width left the panel overlaying
  // the page for as long as the visitor stayed there.
  document.addEventListener('click', function (e) {
    if (!document.querySelector('.dropdown--open')) return;
    if (e.target.closest('.dropdown')) return;
    closeAllDropdowns();
  });

  // Escape closes whatever is open, and returns focus somewhere sensible.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const openLi = document.querySelector('.dropdown--open');
    if (openLi) {
      closeAllDropdowns();
      const caret = openLi.querySelector('.dropdown-caret');
      if (caret) caret.focus();
    } else if (navMenu && navMenu.classList.contains('active') && navToggle) {
      navMenu.classList.remove('active');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.setAttribute('aria-label', 'Open menu');
      navToggle.focus();
    }
  });

  // ── Shrink-on-scroll ───────────────────────────────────────────────────────
  if (!navbar) return;

  const SCROLL_ADD = 70;
  const SCROLL_REMOVE = 50;

  function onScroll() {
    const y = window.scrollY;
    if (y > SCROLL_ADD) {
      navbar.classList.add('navbar--scrolled');
    } else if (y < SCROLL_REMOVE) {
      navbar.classList.remove('navbar--scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
