/* ── Glo Karts 2027 Updates Subscribe API ──────────────────────
   POST /api/subscribe

   Contact classification (server-side only):
     GLO_PAST_CUSTOMERS_JSON — compact [{email,phone}] from booking history
     GLO_SIGNUP_ONLY_JSON    — [{emails:[],phone}] signup-only contacts
       (always classified 'unavailable')

   Notifications (primary):
     PUSHOVER_APP_TOKEN + PUSHOVER_USER_KEY

   Storage (secondary, optional):
     1. Vercel KV (Upstash Redis REST) — KV_REST_API_URL + KV_REST_API_TOKEN
     2. Supabase                       — SUPABASE_URL + SUPABASE_SERVICE_KEY
──────────────────────────────────────────────────────────────── */
import https from 'https';

/* ── HTTP helper ─────────────────────────────────────────────── */
function httpsRequest(method, url, payload, extraHeaders, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let done = false;
    try {
      const u    = new URL(url);
      const data = payload ? JSON.stringify(payload) : null;
      const req  = https.request({
        hostname: u.hostname,
        path:     u.pathname + (u.search || ''),
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(extraHeaders || {}),
        },
      }, (res) => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          if (done) return;
          done = true;
          try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
          catch { resolve({ status: res.statusCode, data: body }); }
        });
      });
      req.setTimeout(timeoutMs, () => {
        if (!done) { done = true; req.destroy(); reject(new Error(`Timeout ${timeoutMs}ms`)); }
      });
      req.on('error', e => { if (!done) { done = true; reject(e); } });
      if (data) req.write(data);
      req.end();
    } catch (e) { reject(e); }
  });
}

const httpPost = (url, payload, hdrs, ms) => httpsRequest('POST', url, payload, hdrs, ms);
const httpGet  = (url, hdrs, ms)           => httpsRequest('GET',  url, null,    hdrs, ms);

/* ── Contact classification helpers (exported for tests) ──────── */

export function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}

/* Strip non-digits, strip leading '1' from 11-digit, require 10 digits → null if malformed */
export function normalizePhone(p) {
  let digits = String(p || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

export function loadPastCustomers() {
  const raw = process.env.GLO_PAST_CUSTOMERS_JSON;
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) {
      console.error('[Glo Karts] GLO_PAST_CUSTOMERS_JSON is not an array');
      return null;
    }
    return list;
  } catch {
    console.error('[Glo Karts] GLO_PAST_CUSTOMERS_JSON parse error');
    return null;
  }
}

export function loadSignupOnly() {
  const raw = process.env.GLO_SIGNUP_ONLY_JSON;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    console.error('[Glo Karts] GLO_SIGNUP_ONLY_JSON parse error');
    return [];
  }
}

/* Returns: 'returning' | 'new' | 'unavailable' */
export function classifyContact(email, normPhone, pastCustomers, signupOnly) {
  if (!Array.isArray(pastCustomers)) return 'unavailable';
  const normEmail = normalizeEmail(email);

  /* Signup-only contacts are always unavailable regardless of match */
  for (const entry of (signupOnly || [])) {
    const emailMatch = Array.isArray(entry.emails)
      && entry.emails.some(e => normalizeEmail(e) === normEmail);
    const phoneMatch = entry.phone && normPhone && entry.phone === normPhone;
    if (emailMatch || phoneMatch) return 'unavailable';
  }

  /* Check booking history */
  for (const entry of pastCustomers) {
    const emailMatch = entry.email && normalizeEmail(entry.email) === normEmail;
    const phoneMatch = entry.phone && normPhone && entry.phone === normPhone;
    if (emailMatch || phoneMatch) return 'returning';
  }

  return 'new';
}

/* ── Vercel KV ───────────────────────────────────────────────── */
const kvBase    = () => (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const kvHeaders = () => ({ Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` });
const kvOk      = () => !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

async function kvPipeline(commands) {
  if (!kvOk()) return null;
  try {
    const r = await httpPost(`${kvBase()}/pipeline`, commands, kvHeaders());
    return Array.isArray(r.data) ? r.data : null;
  } catch { return null; }
}

async function kvGet(key) {
  if (!kvOk()) return null;
  try {
    const r = await httpGet(`${kvBase()}/get/${encodeURIComponent(key)}`, kvHeaders());
    if (r.status === 200 && r.data && !r.data.error && r.data.result !== undefined)
      return r.data.result;
    if (r.data?.error)
      console.error('[Glo Karts] KV GET error:', r.data.error);
    return null;
  } catch (e) {
    console.error('[Glo Karts] KV GET exception:', e.message);
    return null;
  }
}

/* SET key value NX → 'new' | 'exists' | false (false = write error) */
async function kvSetNX(key, value) {
  const results = await kvPipeline([['SET', key, value, 'NX']]);
  if (!results) return false;
  const r = results[0];
  if (!r || r.error) {
    console.error('[Glo Karts] KV SET NX error:', r?.error);
    return false;
  }
  return r.result === 'OK' ? 'new' : 'exists';
}

async function kvSet(key, value) {
  const results = await kvPipeline([['SET', key, value]]);
  if (!results) return false;
  return results?.[0]?.result === 'OK';
}

/* ── Supabase ────────────────────────────────────────────────── */
const sbOk   = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const sbBase = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const sbHdrs = () => ({
  apikey:        process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
});

/* Returns: 'new' | 'exists' | 'error' | 'unavailable' */
async function sbSave(name, email, phone) {
  if (!sbOk()) return 'unavailable';
  const url  = sbBase();
  const hdrs = sbHdrs();

  try {
    const emailChk = await httpGet(
      `${url}/rest/v1/subscribe_2027?email=eq.${encodeURIComponent(email)}&select=email&limit=1`,
      hdrs
    );
    if (emailChk.status === 200 && Array.isArray(emailChk.data) && emailChk.data.length > 0)
      return 'exists';
    if (emailChk.status !== 200) {
      console.error('[Glo Karts] Supabase email dup-check HTTP', emailChk.status);
      return 'error';
    }

    if (phone) {
      const phoneChk = await httpGet(
        `${url}/rest/v1/subscribe_2027?phone=eq.${encodeURIComponent(phone)}&select=phone&limit=1`,
        hdrs
      );
      if (phoneChk.status === 200 && Array.isArray(phoneChk.data) && phoneChk.data.length > 0)
        return 'exists';
      if (phoneChk.status !== 200) {
        console.error('[Glo Karts] Supabase phone dup-check HTTP', phoneChk.status);
        return 'error';
      }
    }

    const ins = await httpPost(
      `${url}/rest/v1/subscribe_2027`,
      { name, email, phone: phone || null, subscribed_at: new Date().toISOString() },
      { ...hdrs, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
    );
    if (ins.status === 201) return 'new';
    if (ins.status === 409) return 'exists';

    console.error('[Glo Karts] Supabase insert HTTP', ins.status);
    return 'error';
  } catch (e) {
    console.error('[Glo Karts] Supabase exception:', e.message);
    return 'error';
  }
}

/* ── Pushover — retried once, non-fatal ──────────────────────── */
async function sendPushover(title, message) {
  const token = process.env.PUSHOVER_APP_TOKEN;
  const user  = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) {
    console.error('[Glo Karts] Pushover: credentials not configured');
    return false;
  }
  const payload = { token, user, title, message: message.slice(0, 1024), priority: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await httpPost('https://api.pushover.net/1/messages.json', payload, {}, 6000);
      if (r.status === 200 && r.data?.status === 1) return true;
      console.error('[Glo Karts] Pushover attempt', attempt,
        'HTTP', r.status, 'api-status:', r.data?.status,
        'errors:', JSON.stringify((r.data?.errors || []).map(String)));
    } catch (e) {
      console.error('[Glo Karts] Pushover attempt', attempt, 'exception:', e.message);
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2500));
  }
  return false;
}

/* ── Helpers ─────────────────────────────────────────────────── */
function safeFirst(name) {
  return String(name || '').split(/\s+/)[0]
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    || 'there';
}

const MESSAGES = {
  returning:   fn => `Welcome back, ${fn}! Your request for 2027 season updates is in. Stay in the GLO!`,
  new:         fn => `Welcome to the GLO, ${fn}! Your request for 2027 season updates is in. We're excited to have you!`,
  unavailable: fn => `Thanks, ${fn}! We received your request for 2027 season updates. Stay in the GLO!`,
  duplicate:   fn => `Hi, ${fn}! You're already on the list. We'll reach out when 2027 bookings open.`,
};

const PUSHOVER_TITLES = {
  returning:   'Returning Customer — matched supplied booking list',
  new:         'New Customer — no match in supplied list',
  unavailable: 'History Unavailable',
};

/* ── Handler ─────────────────────────────────────────────────── */
export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok: false, error: 'Invalid request.' }); }

  const rawName  = String(body?.name  || '').trim();
  const rawEmail = String(body?.email || '').trim();
  const rawPhone = String(body?.phone || '').trim();

  if (!rawName || !rawEmail || !rawPhone)
    return res.status(400).json({ ok: false, error: 'Name, email, and phone number are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail))
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });

  const normPhone = normalizePhone(rawPhone);
  if (normPhone === null)
    return res.status(400).json({ ok: false, error: 'Please enter a valid 10-digit phone number.' });

  const email     = normalizeEmail(rawEmail);
  const firstName = safeFirst(rawName);

  const hasKV = kvOk();
  const hasSB = sbOk();

  /* ── Path A: Vercel KV ──────────────────────────────────────── */
  if (hasKV) {
    const emailKey = `sub:2027:${email}`;
    const phoneKey = `sub:2027:phone:${normPhone}`;

    /* Phone duplicate check */
    const existingPhone = await kvGet(phoneKey);
    if (existingPhone !== null)
      return res.status(200).json({ ok: true, duplicate: true, message: MESSAGES.duplicate(firstName) });

    /* Atomic email write */
    const record     = JSON.stringify({ name: rawName, email, phone: rawPhone, subscribedAt: new Date().toISOString() });
    const saveResult = await kvSetNX(emailKey, record);

    if (saveResult === 'exists')
      return res.status(200).json({ ok: true, duplicate: true, message: MESSAGES.duplicate(firstName) });

    if (saveResult !== false) {
      await kvSet(phoneKey, emailKey);
    } else {
      console.error('[Glo Karts] KV write failed — continuing to notify');
    }

    const classification = classifyContact(email, normPhone, loadPastCustomers(), loadSignupOnly());
    console.log('[Glo Karts] KV path, classification:', classification);

    await sendPushover(
      PUSHOVER_TITLES[classification] || PUSHOVER_TITLES.unavailable,
      `Name: ${rawName}\nPhone: ${rawPhone}\nEmail: ${email}\nClassification: ${classification}\nSource: 2027 Season Updates`
    );

    return res.status(200).json({ ok: true, message: (MESSAGES[classification] || MESSAGES.unavailable)(firstName) });
  }

  /* ── Path B: Supabase ───────────────────────────────────────── */
  if (hasSB) {
    const sbResult = await sbSave(rawName, email, normPhone);

    if (sbResult === 'exists')
      return res.status(200).json({ ok: true, duplicate: true, message: MESSAGES.duplicate(firstName) });

    if (sbResult !== 'new')
      console.error('[Glo Karts] Supabase write failed:', sbResult, '— continuing to notify');

    const classification = classifyContact(email, normPhone, loadPastCustomers(), loadSignupOnly());
    console.log('[Glo Karts] Supabase path, classification:', classification);

    await sendPushover(
      PUSHOVER_TITLES[classification] || PUSHOVER_TITLES.unavailable,
      `Name: ${rawName}\nPhone: ${rawPhone}\nEmail: ${email}\nClassification: ${classification}\nSource: 2027 Season Updates`
    );

    return res.status(200).json({ ok: true, message: (MESSAGES[classification] || MESSAGES.unavailable)(firstName) });
  }

  /* ── Path C: Pushover-only (no storage configured) ─────────── */
  console.warn('[Glo Karts] No storage configured — recording signup via Pushover only');

  const classification = classifyContact(email, normPhone, loadPastCustomers(), loadSignupOnly());
  console.log('[Glo Karts] No-storage path, classification:', classification);

  await sendPushover(
    PUSHOVER_TITLES[classification] || PUSHOVER_TITLES.unavailable,
    `Name: ${rawName}\nPhone: ${rawPhone}\nEmail: ${email}\nClassification: ${classification}\nSource: 2027 Season Updates (no storage)`
  );

  return res.status(200).json({ ok: true, message: (MESSAGES[classification] || MESSAGES.unavailable)(firstName) });
}
