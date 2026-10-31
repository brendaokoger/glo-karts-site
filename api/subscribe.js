/* ── Glo Karts 2027 Updates Subscribe API ──────────────────────
   POST /api/subscribe
   Saves 2027 season updates signup, checks past bookings,
   sends Pushover notification, prevents duplicates.

   Required env vars (Vercel dashboard):
     KV_REST_API_URL        — Vercel KV REST API URL
     KV_REST_API_TOKEN      — Vercel KV REST API token
     PUSHOVER_APP_TOKEN     — Pushover application token
     PUSHOVER_USER_KEY      — Pushover user/group key

   Optional (for past-booking lookup):
     SUPABASE_URL           — Supabase project URL
     SUPABASE_SERVICE_KEY   — Supabase service role key
──────────────────────────────────────────────────────────────── */

import https from 'https';

function httpsRequest(method, url, payload, extraHeaders) {
  return new Promise((resolve, reject) => {
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
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const httpPost = (url, payload, hdrs) => httpsRequest('POST', url, payload, hdrs);
const httpGet  = (url, hdrs)          => httpsRequest('GET',  url, null,    hdrs);

/* ── Vercel KV (Upstash Redis REST) ────────────────────────── */
function kvBase()    { return (process.env.KV_REST_API_URL || '').replace(/\/$/, ''); }
function kvHeaders() { return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }; }
function kvOk()      { return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN); }

/* Pipeline: run multiple Redis commands in one HTTP call */
async function kvPipeline(commands) {
  if (!kvOk()) return null;
  try {
    const r = await httpPost(`${kvBase()}/pipeline`, commands, kvHeaders());
    return Array.isArray(r.data) ? r.data : null;
  } catch { return null; }
}

/* GET a single key — returns the stored value or null */
async function kvGet(key) {
  if (!kvOk()) return null;
  try {
    const r = await httpGet(`${kvBase()}/get/${encodeURIComponent(key)}`, kvHeaders());
    if (r.status === 200 && r.data?.result !== undefined) return r.data.result;
    return null;
  } catch { return null; }
}

/* SET key value NX — returns 'new' | 'exists' | false */
async function kvSetNX(key, value) {
  const results = await kvPipeline([['SET', key, value, 'NX']]);
  if (!results) return false;
  return results[0]?.result === 'OK' ? 'new' : 'exists';
}

/* SET key value (unconditional, for secondary index) */
async function kvSet(key, value) {
  const results = await kvPipeline([['SET', key, value]]);
  if (!results) return false;
  return results[0]?.result === 'OK';
}

/* DEL key — used to rollback if phone key is duplicate */
async function kvDel(key) {
  if (!kvOk()) return;
  try { await httpGet(`${kvBase()}/del/${encodeURIComponent(key)}`, kvHeaders()); }
  catch { /* ignore rollback errors */ }
}

/* ── Past-booking lookup via Supabase ──────────────────────── */
async function findPastBooking(email, normalizedPhone) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return 'unavailable';
  try {
    const hdrs = { apikey: key, Authorization: `Bearer ${key}` };

    /* Try email first */
    const byEmail = `${url}/rest/v1/bookings?contact_email=eq.${encodeURIComponent(email)}&select=id&limit=1`;
    const r1 = await httpGet(byEmail, hdrs);
    if (r1.status === 200 && Array.isArray(r1.data) && r1.data.length > 0) return 'found';

    /* Try normalized phone if provided */
    if (normalizedPhone) {
      const byPhone = `${url}/rest/v1/bookings?contact_phone=eq.${encodeURIComponent(normalizedPhone)}&select=id&limit=1`;
      const r2 = await httpGet(byPhone, hdrs);
      if (r2.status === 200 && Array.isArray(r2.data) && r2.data.length > 0) return 'found';
      if (r2.status === 200) return 'not_found';
    }

    if (r1.status === 200) return 'not_found';
    return 'unavailable';
  } catch { return 'unavailable'; }
}

/* ── Pushover ───────────────────────────────────────────────── */
async function pushover(title, message) {
  const token = process.env.PUSHOVER_APP_TOKEN;
  const user  = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) return;
  try {
    await httpPost('https://api.pushover.net/1/messages.json',
      { token, user, title, message: message.slice(0, 1024), priority: 0 });
  } catch (e) { console.error('[Glo Karts] Pushover subscribe error:', e.message); }
}

/* ── Safe first-name escape ─────────────────────────────────── */
function safeFirst(name) {
  return String(name || '').split(/\s+/)[0]
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])) || 'there';
}

/* ── Handler ────────────────────────────────────────────────── */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

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

  const email           = rawEmail.toLowerCase();
  const normalizedPhone = rawPhone.replace(/\D/g, '');
  const firstName       = safeFirst(rawName);

  const emailKey = `sub:2027:${email}`;
  const phoneKey = normalizedPhone ? `sub:2027:phone:${normalizedPhone}` : null;
  const record   = JSON.stringify({ name: rawName, email, phone: rawPhone, subscribedAt: new Date().toISOString() });

  /* ── Duplicate check: email ─────────────────────────────── */
  if (!kvOk()) {
    console.error('[Glo Karts] KV not configured — missing KV_REST_API_URL or KV_REST_API_TOKEN');
    return res.status(503).json({
      ok: false,
      error: "We couldn't save your signup right now. Please try again in a moment.",
    });
  }

  /* Check phone index first (GET) so we can detect cross-email phone dups cheaply */
  if (phoneKey) {
    const existingPhone = await kvGet(phoneKey);
    if (existingPhone !== null) {
      return res.status(200).json({
        ok: true, duplicate: true,
        message: `Hi, ${firstName}! You're already in the GLO! We'll email you when 2027 bookings open.`,
      });
    }
  }

  /* Atomic SET email key NX — also catches same-email duplicates */
  const saveResult = await kvSetNX(emailKey, record);

  if (saveResult === 'exists') {
    return res.status(200).json({
      ok: true, duplicate: true,
      message: `Hi, ${firstName}! You're already in the GLO! We'll email you when 2027 bookings open.`,
    });
  }

  if (saveResult === false) {
    /* KV returned an error — do NOT fire notification; tell customer to retry */
    console.error('[Glo Karts] KV save failed for email:', email);
    return res.status(503).json({
      ok: false,
      error: "We couldn't save your signup right now. Please try again in a moment.",
    });
  }

  /* ── Save succeeded — now write phone index ─────────────── */
  if (phoneKey) {
    const phoneSet = await kvSet(phoneKey, emailKey);
    if (!phoneSet) {
      console.warn('[Glo Karts] Phone index save failed for:', normalizedPhone, '— record still saved under email key');
    }
  }

  /* ── Past booking check ──────────────────────────────────── */
  const past = await findPastBooking(email, normalizedPhone);

  /* ── Pushover notification (only fires after confirmed save) */
  const statusMap = {
    found:       ['2027 Updates — Past Customer',        'Past booking request found'],
    not_found:   ['2027 Updates — New Customer',         'No past booking request found'],
    unavailable: ['2027 Updates — History Unavailable',  'Booking history unavailable'],
  };
  const [poTitle, customerStatus] = statusMap[past] || statusMap.unavailable;

  await pushover(poTitle,
    `Name: ${rawName}\nPhone: ${rawPhone}\nEmail: ${email}\nCustomer status: ${customerStatus}\nSource: 2027 Season Updates`);

  /* ── Success ─────────────────────────────────────────────── */
  return res.status(200).json({
    ok: true,
    message: `Hi, ${firstName}! You're in the GLO! We'll email you when 2027 bookings open.`,
  });
}
