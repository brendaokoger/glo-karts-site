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

/* SET key value NX — returns 'new' | 'exists' | false */
async function kvSetNX(key, value) {
  const results = await kvPipeline([['SET', key, value, 'NX']]);
  if (!results) return false;
  return results[0]?.result === 'OK' ? 'new' : 'exists';
}

/* ── Past-booking lookup via Supabase ──────────────────────── */
async function findPastBooking(email) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return 'unavailable';
  try {
    const endpoint = `${url}/rest/v1/bookings?contact_email=eq.${encodeURIComponent(email)}&select=id&limit=1`;
    const r = await httpGet(endpoint, { apikey: key, Authorization: `Bearer ${key}` });
    if (r.status === 200 && Array.isArray(r.data)) return r.data.length > 0 ? 'found' : 'not_found';
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

  const email     = rawEmail.toLowerCase();
  const firstName = safeFirst(rawName);
  const kvKey     = `sub:2027:${email}`;
  const record    = JSON.stringify({ name: rawName, email, phone: rawPhone, subscribedAt: new Date().toISOString() });

  /* ── Duplicate check & save atomically ──────────────────── */
  const saveResult = await kvSetNX(kvKey, record);

  if (saveResult === 'exists') {
    return res.status(200).json({
      ok: true, duplicate: true,
      message: `Hi, ${firstName}! You're already in the GLO! We'll email you when 2027 bookings open.`,
    });
  }

  /* ── Past booking check ──────────────────────────────────── */
  const past = await findPastBooking(email);

  /* ── Pushover notification ───────────────────────────────── */
  const statusMap = {
    found:       ['2027 Updates — Past Customer',        'Past booking request found'],
    not_found:   ['2027 Updates — New Customer',         'No past booking request found'],
    unavailable: ['2027 Updates — History Unavailable',  'Booking history unavailable'],
  };
  const [poTitle, customerStatus] = statusMap[past] || statusMap.unavailable;

  await pushover(poTitle,
    `Name: ${rawName}\nPhone: ${rawPhone}\nEmail: ${email}\nCustomer status: ${customerStatus}\nSource: 2027 Season Updates`);

  /* ── Response ────────────────────────────────────────────── */
  if (saveResult === false) {
    return res.status(503).json({
      ok: false,
      error: "We couldn't save your signup right now. Please try again in a moment.",
    });
  }

  return res.status(200).json({
    ok: true,
    message: `Hi, ${firstName}! You're in the GLO! We'll email you when 2027 bookings open.`,
  });
}
