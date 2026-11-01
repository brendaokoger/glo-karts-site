/* ── Glo Karts 2027 Updates Subscribe API ──────────────────────
   POST /api/subscribe
   Saves 2027 season updates signup, checks past bookings,
   sends Pushover notification, prevents duplicates.

   Storage (in priority order):
     1. Vercel KV (Upstash Redis REST) — if KV_REST_API_URL + KV_REST_API_TOKEN set
     2. Supabase — if SUPABASE_URL + SUPABASE_SERVICE_KEY set
        Requires table: subscribe_2027 (name, email, phone, subscribed_at)
        with UNIQUE constraint on email

   Required env vars (Vercel dashboard):
     KV_REST_API_URL        — Vercel KV REST API URL         (option 1)
     KV_REST_API_TOKEN      — Vercel KV REST API token       (option 1)
     SUPABASE_URL           — Supabase project URL           (option 2)
     SUPABASE_SERVICE_KEY   — Supabase service role key      (option 2)
     PUSHOVER_APP_TOKEN     — Pushover application token     (required)
     PUSHOVER_USER_KEY      — Pushover user/group key        (required)
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

async function kvSet(key, value) {
  const results = await kvPipeline([['SET', key, value]]);
  if (!results) return false;
  return results[0]?.result === 'OK';
}

/* ── Supabase storage (fallback when KV not configured) ─────── */
function sbOk() { return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY); }
function sbHdrs() {
  return {
    apikey:        process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  };
}

/* Returns: 'new' | 'exists' | 'error' | 'unavailable' */
async function sbSave(name, email, phone) {
  if (!sbOk()) return 'unavailable';
  const url = process.env.SUPABASE_URL.replace(/\/$/, '');
  const hdrs = sbHdrs();

  try {
    /* Check email duplicate */
    const emailChk = await httpGet(
      `${url}/rest/v1/subscribe_2027?email=eq.${encodeURIComponent(email)}&select=email&limit=1`,
      hdrs
    );
    if (emailChk.status === 200 && Array.isArray(emailChk.data) && emailChk.data.length > 0) {
      return 'exists';
    }

    /* Check phone duplicate */
    if (phone) {
      const phoneChk = await httpGet(
        `${url}/rest/v1/subscribe_2027?phone=eq.${encodeURIComponent(phone)}&select=phone&limit=1`,
        hdrs
      );
      if (phoneChk.status === 200 && Array.isArray(phoneChk.data) && phoneChk.data.length > 0) {
        return 'exists';
      }
    }

    /* Insert new record */
    const ins = await httpPost(
      `${url}/rest/v1/subscribe_2027`,
      { name, email, phone: phone || null, subscribed_at: new Date().toISOString() },
      { ...hdrs, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
    );

    if (ins.status === 201) return 'new';
    /* 409 = unique constraint (shouldn't reach here after the SELECT, but handle it) */
    if (ins.status === 409) return 'exists';

    console.error('[Glo Karts] Supabase insert error:', ins.status, JSON.stringify(ins.data));
    return 'error';
  } catch (e) {
    console.error('[Glo Karts] Supabase exception:', e.message);
    return 'error';
  }
}

/* ── Past-booking lookup via Supabase ──────────────────────── */
async function findPastBooking(email, normalizedPhone) {
  if (!sbOk()) return 'unavailable';
  const url = process.env.SUPABASE_URL.replace(/\/$/, '');
  try {
    const hdrs = sbHdrs();
    const byEmail = `${url}/rest/v1/bookings?contact_email=eq.${encodeURIComponent(email)}&select=id&limit=1`;
    const r1 = await httpGet(byEmail, hdrs);
    if (r1.status === 200 && Array.isArray(r1.data) && r1.data.length > 0) return 'found';

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
  } catch (e) { console.error('[Glo Karts] Pushover error:', e.message); }
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

  /* ── Determine which storage backend is available ─────────── */
  const hasKV  = kvOk();
  const hasSB  = sbOk();

  if (!hasKV && !hasSB) {
    console.error('[Glo Karts] FATAL: no storage configured.',
      'KV_REST_API_URL:', !!process.env.KV_REST_API_URL,
      'KV_REST_API_TOKEN:', !!process.env.KV_REST_API_TOKEN,
      'SUPABASE_URL:', !!process.env.SUPABASE_URL,
      'SUPABASE_SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_KEY);
    return res.status(503).json({
      ok: false,
      error: "We couldn’t save your signup right now. Please try again in a moment.",
    });
  }

  /* ──────────────────────────────────────────────────────────
     PATH A: Vercel KV
  ─────────────────────────────────────────────────────────── */
  if (hasKV) {
    const emailKey = `sub:2027:${email}`;
    const phoneKey = normalizedPhone ? `sub:2027:phone:${normalizedPhone}` : null;
    const record   = JSON.stringify({ name: rawName, email, phone: rawPhone, subscribedAt: new Date().toISOString() });

    /* Phone duplicate check (GET, cheap) */
    if (phoneKey) {
      const existingPhone = await kvGet(phoneKey);
      if (existingPhone !== null) {
        return res.status(200).json({
          ok: true, duplicate: true,
          message: `Hi, ${firstName}! You’re already in the GLO! We’ll email you when 2027 bookings open.`,
        });
      }
    }

    /* Atomic email SET NX */
    const saveResult = await kvSetNX(emailKey, record);

    if (saveResult === 'exists') {
      return res.status(200).json({
        ok: true, duplicate: true,
        message: `Hi, ${firstName}! You’re already in the GLO! We’ll email you when 2027 bookings open.`,
      });
    }

    if (saveResult === false) {
      /* KV returned an unexpected error — try Supabase fallback if available */
      console.error('[Glo Karts] KV save failed for email:', email);
      if (hasSB) {
        /* Fall through to Supabase path below */
      } else {
        return res.status(503).json({
          ok: false,
          error: "We couldn’t save your signup right now. Please try again in a moment.",
        });
      }
    } else {
      /* KV save succeeded */
      if (phoneKey) await kvSet(phoneKey, emailKey);

      const past = await findPastBooking(email, normalizedPhone);
      const statusMap = {
        found:       ['2027 Updates — Past Customer',       'Past booking found'],
        not_found:   ['2027 Updates — New Customer',        'No past booking found'],
        unavailable: ['2027 Updates — History Unavailable', 'Booking history unavailable'],
      };
      const [poTitle, customerStatus] = statusMap[past] || statusMap.unavailable;

      await pushover(poTitle,
        `Name: ${rawName}\nPhone: ${rawPhone}\nEmail: ${email}\nCustomer status: ${customerStatus}\nSource: 2027 Season Updates`);

      return res.status(200).json({
        ok: true,
        message: `Hi, ${firstName}! You’re in the GLO! We’ll email you when 2027 bookings open.`,
      });
    }
  }

  /* ──────────────────────────────────────────────────────────
     PATH B: Supabase (no KV, or KV failed)
  ─────────────────────────────────────────────────────────── */
  const sbResult = await sbSave(rawName, email, normalizedPhone);

  if (sbResult === 'exists') {
    return res.status(200).json({
      ok: true, duplicate: true,
      message: `Hi, ${firstName}! You’re already in the GLO! We’ll email you when 2027 bookings open.`,
    });
  }

  if (sbResult === 'unavailable' || sbResult === 'error') {
    console.error('[Glo Karts] All storage paths failed. KV:', hasKV, '| SB:', hasSB, '| sbResult:', sbResult);
    return res.status(503).json({
      ok: false,
      error: "We couldn’t save your signup right now. Please try again in a moment.",
    });
  }

  /* Supabase save succeeded ('new') */
  const past = await findPastBooking(email, normalizedPhone);
  const statusMap = {
    found:       ['2027 Updates — Past Customer',       'Past booking found'],
    not_found:   ['2027 Updates — New Customer',        'No past booking found'],
    unavailable: ['2027 Updates — History Unavailable', 'Booking history unavailable'],
  };
  const [poTitle, customerStatus] = statusMap[past] || statusMap.unavailable;

  await pushover(poTitle,
    `Name: ${rawName}\nPhone: ${rawPhone}\nEmail: ${email}\nCustomer status: ${customerStatus}\nSource: 2027 Season Updates`);

  return res.status(200).json({
    ok: true,
    message: `Hi, ${firstName}! You’re in the GLO! We’ll email you when 2027 bookings open.`,
  });
}
