/* ── Footer year ─────────────────────────────────────── */
var footerYear = document.getElementById('footer-year');
if (footerYear) footerYear.textContent = new Date().getFullYear();

/* ── Hamburger menu ───────────────────────────────────── */
var hamburger = document.getElementById('hamburger-btn');
var mobileNav = document.getElementById('mobile-nav');

if (hamburger && mobileNav) {
  hamburger.addEventListener('click', function () {
    var isOpen = hamburger.classList.toggle('open');
    mobileNav.classList.toggle('open', isOpen);
    hamburger.setAttribute('aria-expanded', String(isOpen));
  });

  document.querySelectorAll('.mobile-link').forEach(function (link) {
    link.addEventListener('click', function () {
      hamburger.classList.remove('open');
      mobileNav.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
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
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }, { passive: true });
}

/* ── Mobile sticky CTA: visible only after hero exits, hides at booking bar ── */
var mobileStickyEl = document.getElementById('mobile-sticky-cta');
if (mobileStickyEl && 'IntersectionObserver' in window) {
  var _heroVis = true;
  var _barVis  = false;
  function _updateSticky() {
    mobileStickyEl.style.display = (!_heroVis && !_barVis) ? '' : 'none';
  }
  var _heroEl = document.getElementById('hero');
  if (_heroEl) {
    new IntersectionObserver(function (entries) {
      _heroVis = entries[0].isIntersecting;
      _updateSticky();
    }, { threshold: 0.05 }).observe(_heroEl);
  }
  var _barEl = document.getElementById('booking-bar');
  if (_barEl) {
    new IntersectionObserver(function (entries) {
      _barVis = entries[0].isIntersecting;
      _updateSticky();
    }, { threshold: 0.1 }).observe(_barEl);
  }
}
