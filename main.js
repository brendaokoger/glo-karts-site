/* ── Footer year ─────────────────────────────────────── */
document.getElementById('footer-year').textContent = new Date().getFullYear();

/* ── Hamburger menu ───────────────────────────────────── */
const hamburger = document.getElementById('hamburger-btn');
const mobileNav = document.getElementById('mobile-nav');

hamburger.addEventListener('click', () => {
  const isOpen = hamburger.classList.toggle('open');
  mobileNav.classList.toggle('open', isOpen);
  hamburger.setAttribute('aria-expanded', isOpen);
});

document.querySelectorAll('.mobile-link').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('open');
    mobileNav.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  });
});

/* ── Scroll-reveal ────────────────────────────────────── */
const revealEls = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
revealEls.forEach(el => revealObserver.observe(el));

/* ── Header darkens on scroll ─────────────────────────── */
const header = document.getElementById('site-header');
window.addEventListener('scroll', () => {
  header.style.background = window.scrollY > 40
    ? 'rgba(5,5,5,0.98)'
    : 'rgba(5,5,5,0.92)';
}, { passive: true });

/* ── Formspree AJAX submission ────────────────────────── */
const form      = document.getElementById('inquiry-form');
const success   = document.getElementById('form-success');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', async e => {
  e.preventDefault();

  const name  = form.querySelector('#full-name').value.trim();
  const email = form.querySelector('#email').value.trim();
  if (!name || !email) {
    form.querySelector(!name ? '#full-name' : '#email').focus();
    return;
  }

  submitBtn.disabled     = true;
  submitBtn.textContent  = 'Sending…';

  try {
    const res = await fetch(form.action, {
      method:  'POST',
      body:    new FormData(form),
      headers: { Accept: 'application/json' }
    });

    if (res.ok) {
      form.style.display = 'none';
      success.classList.add('visible');
      success.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Send My Inquiry';
      alert('Something went wrong. Please try again or email us at info@glokarts.com.');
    }
  } catch {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Send My Inquiry';
    alert('Network error. Please check your connection and try again.');
  }
});
