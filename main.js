/* ── Footer year ─────────────────────────────────────── */
var footerYear = document.getElementById('footer-year');
if (footerYear) footerYear.textContent = new Date().getFullYear();

/* ── Hamburger / mobile nav ───────────────────────────── */
var hamburger = document.getElementById('hamburger-btn');
var mobileNav = document.getElementById('mobile-nav');

function closeNav() {
  if (!hamburger || !mobileNav) return;
  hamburger.classList.remove('open');
  mobileNav.classList.remove('open');
  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.setAttribute('aria-label', 'Open navigation menu');
  mobileNav.setAttribute('aria-hidden', 'true');
}

function openNav() {
  if (!hamburger || !mobileNav) return;
  hamburger.classList.add('open');
  mobileNav.classList.add('open');
  hamburger.setAttribute('aria-expanded', 'true');
  hamburger.setAttribute('aria-label', 'Close navigation menu');
  mobileNav.setAttribute('aria-hidden', 'false');
}

if (hamburger && mobileNav) {
  hamburger.addEventListener('click', function () {
    if (hamburger.classList.contains('open')) { closeNav(); } else { openNav(); }
  });

  /* Close when any nav link or BOOK NOW is clicked */
  document.querySelectorAll('.mobile-link').forEach(function (link) {
    link.addEventListener('click', closeNav);
  });

  /* Close on tap/click outside the drawer */
  document.addEventListener('click', function (e) {
    if (!mobileNav.classList.contains('open')) return;
    if (!hamburger.contains(e.target) && !mobileNav.contains(e.target)) {
      closeNav();
    }
  });

  /* Close on Escape */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
      closeNav();
      hamburger.focus();
    }
  });
}

/* ── Scroll reveal ────────────────────────────────────── */
var revealEls = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  revealEls.forEach(function (el) { revealObserver.observe(el); });
} else {
  revealEls.forEach(function (el) { el.classList.add('visible'); });
}

/* ── Header darkens on scroll ─────────────────────────── */
var header = document.getElementById('site-header');
if (header) {
  window.addEventListener('scroll', function () {
    header.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
}

/* ── Mobile sticky BOOK NOW ───────────────────────────────
   Shows after the hero exits view. Hides when the footer
   comes into view so it never overlaps footer links.
   Safe-area bottom padding is handled in CSS.
─────────────────────────────────────────────────────────── */
var mobileStickyEl = document.getElementById('mobile-sticky-cta');
if (mobileStickyEl) {
  /* Start hidden to prevent flash on load */
  mobileStickyEl.style.display = 'none';

  if ('IntersectionObserver' in window) {
    var _heroVis   = true;   /* hero visible on load */
    var _footerVis = false;

    function _updateSticky() {
      /* Show on mobile only when hero is gone and footer hasn't appeared yet */
      mobileStickyEl.style.display = (!_heroVis && !_footerVis) ? '' : 'none';
    }

    var _heroEl = document.getElementById('hero');
    if (_heroEl) {
      new IntersectionObserver(function (entries) {
        _heroVis = entries[0].isIntersecting;
        _updateSticky();
      }, { threshold: 0.05 }).observe(_heroEl);
    }

    /* Hide when the footer (id="faq") enters view */
    var _footerEl = document.getElementById('faq');
    if (_footerEl) {
      new IntersectionObserver(function (entries) {
        _footerVis = entries[0].isIntersecting;
        _updateSticky();
      }, { threshold: 0.1 }).observe(_footerEl);
    }
  }
}
