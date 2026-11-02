/* ── Glo Karts 2027 Updates Subscribe API ──────────────────────
   POST /api/subscribe

   Storage priority:
     1. Vercel KV (Upstash Redis REST) — KV_REST_API_URL + KV_REST_API_TOKEN
     2. Supabase                       — SUPABASE_URL + SUPABASE_SERVICE_KEY
        Table: subscribe_2027 (name TEXT, email TEXT UNIQUE, phone TEXT,
                               subscribed_at TIMESTAMPTZ DEFAULT now())

   Notifications:
     PUSHOVER_APP_TOKEN + PUSHOVER_USER_KEY (required, server-side only)
     One alert per new signup; retried once on failure.
     A notification failure never invalidates a saved record.
──────────────────────────────────────────────────────────────── */
import https from 'https';

/* ── HTTP helper with per-request timeout ───────────────────── */
function httpsRequest(method, url, payload, extraHeaders, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const data = payload ? JSON.stringify(payload) : null;
    let done   = false;

    const req = https.request({
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
  });
}

const httpPost = (url, payload, hdrs, ms) => httpsRequest('POST', url, payload, hdrs, ms);
const httpGet  = (url, hdrs, ms)           => httpsRequest('GET',  url, null,    hdrs, ms);

/* ── Vercel KV (Upstash Redis REST) ────────────────────────── */
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
    /* Upstash returned an error object — treat as write failure, never as 'exists' */
    console.error('[Glo Karts] KV SET NX error:', r?.error);
    return false;
  }
  /* result='OK' → key written (new); result=null → NX blocked because key exists */
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
    /* Duplicate email check */
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

    /* Duplicate phone check */
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

    /* Insert */
    const ins = await httpPost(
      `${url}/rest/v1/subscribe_2027`,
      { name, email, phone: phone || null, subscribed_at: new Date().toISOString() },
      { ...hdrs, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
    );
    if (ins.status === 201) return 'new';
    if (ins.status === 409) return 'exists'; /* UNIQUE constraint race */

    console.error('[Glo Karts] Supabase insert HTTP', ins.status);
    return 'error';
  } catch (e) {
    console.error('[Glo Karts] Supabase exception:', e.message);
    return 'error';
  }
}

/* ── Past-booking lookup ─────────────────────────────────────── */
async function findPastBooking(email, normalizedPhone) {
  if (!sbOk()) return 'unavailable';
  const url  = sbBase();
  const hdrs = sbHdrs();
  try {
    /* Email lookup */
    const r1 = await httpGet(
      `${url}/rest/v1/bookings?contact_email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
      hdrs
    );
    if (r1.status === 200 && Array.isArray(r1.data) && r1.data.length > 0) return 'found';
    if (r1.status !== 200) {
      console.error('[Glo Karts] Booking email lookup HTTP', r1.status);
      return 'unavailable';
    }

    /* Phone lookup — only when email clean-miss */
    if (normalizedPhone) {
      const r2 = await httpGet(
        `${url}/rest/v1/bookings?contact_phone=eq.${encodeURIComponent(normalizedPhone)}&select=id&limit=1`,
        hdrs
      );
      if (r2.status === 200 && Array.isArray(r2.data) && r2.data.length > 0) return 'found';
      if (r2.status !== 200) {
        console.error('[Glo Karts] Booking phone lookup HTTP', r2.status);
        return 'unavailable';
      }
    }

    return 'not_found';
  } catch (e) {
    console.error('[Glo Karts] Booking lookup exception:', e.message);
    return 'unavailable';
  }
}

/* ── Pushover — retried once, failure is non-fatal ──────────── */
async function sendPushover(title, message) {
  const token = process.env.PUSHOVER_APP_TOKEN;
  const user  = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) {
    console.error('[Glo Karts] Pushover: credentials not configured');
    return;
  }
  const payload = { token, user, title, message: message.slice(0, 1024), priority: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await httpPost('https://api.pushover.net/1/messages.json', payload, {}, 6000);
      if (r.status === 200 && r.data?.status === 1) return; /* delivered */
      console.error('[Glo Karts] Pushover attempt', attempt,
        'HTTP', r.status, 'api-status:', r.data?.status,
        'errors:', JSON.stringify((r.data?.errors || []).map(String)));
    } catch (e) {
      console.error('[Glo Karts] Pushover attempt', attempt, 'exception:', e.message);
    }
    if (attempt < 2) await new Promise(res => setTimeout(res, 2500));
  }
}

/* ── Helpers ─────────────────────────────────────────────────── */
function safeFirst(name) {
  return String(name || '').split(/\s+/)[0]
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    || 'there';
}

const CUSTOMER_STATUS_MAP = {
  found:       ['2027 Updates — Past Customer',       'Past booking found'],
  not_found:   ['2027 Updates — New Customer',        'No past booking found'],
  unavailable: ['2027 Updates — History Unavailable', 'Booking history unavailable'],
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

  const email           = rawEmail.toLowerCase();
  const normalizedPhone = rawPhone.replace(/\D/g, '');
  const firstName       = safeFirst(rawName);

  /* ── Storage availability ───────────────────────────────────── */
  const hasKV = kvOk();
  const hasSB = sbOk();

  if (!hasKV && !hasSB) {
    console.error('[Glo Karts] FATAL: no storage.',
      'KV_URL:', !!process.env.KV_REST_API_URL,
      'KV_TOKEN:', !!process.env.KV_REST_API_TOKEN,
      'SB_URL:', !!process.env.SUPABASE_URL,
      'SB_KEY:', !!process.env.SUPABASE_SERVICE_KEY);
    return res.status(503).json({
      ok: false,
      error: "We couldn't save your signup right now. Please try again in a moment.",
    });
  }

  /* ── Path A: Vercel KV ──────────────────────────────────────── */
  if (hasKV) {
    const emailKey = `sub:2027:${email}`;
    const phoneKey = normalizedPhone ? `sub:2027:phone:${normalizedPhone}` : null;
    const record   = JSON.stringify({
      name: rawName, email, phone: rawPhone,
      subscribedAt: new Date().toISOString(),
    });

    /* Phone duplicate check */
    if (phoneKey) {
      const existingPhone = await kvGet(phoneKey);
      if (existingPhone !== null) {
        return res.status(200).json({
          ok: true, duplicate: true,
          message: `Hi, ${firstName}! You're already in the GLO! We'll email you when 2027 bookings open.`,
        });
      }
    }

    /* Atomic email write */
    const saveResult = await kvSetNX(emailKey, record);

    if (saveResult === 'exists') {
      return res.status(200).json({
        ok: true, duplicate: true,
        message: `Hi, ${firstName}! You're already in the GLO! We'll email you when 2027 bookings open.`,
      });
    }

    if (saveResult === false) {
      /* Write error — fall through to Supabase if available */
      console.error('[Glo Karts] KV write failed, falling through to Supabase');
      if (!hasSB) {
        return res.status(503).json({
          ok: false,
          error: "We couldn't save your signup right now. Please try again in a moment.",
        });
      }
      /* falls through to Path B below */
    } else {
      /* KV save confirmed → write phone index, notify */
      if (phoneKey) await kvSet(phoneKey, emailKey);

      const past = await findPastBooking(email, normalizedPhone);
      const [poTitle, customerStatus] = CUSTOMER_STATUS_MAP[past] || CUSTOMER_STATUS_MAP.unavailable;
      console.log('[Glo Karts] KV save ok, booking status:', past);

      await sendPushover(poTitle,
        `Name: ${rawName}\nPhone: ${rawPhone}\nEmail: ${email}\nCustomer status: ${customerStatus}\nSource: 2027 Season Updates`);

      return res.status(200).json({
        ok: true,
        message: `Hi, ${firstName}! You're in the GLO! We'll email you when 2027 bookings open.`,
      });
    }
  }

  /* ── Path B: Supabase ───────────────────────────────────────── */
  const sbResult = await sbSave(rawName, email, normalizedPhone);

  if (sbResult === 'exists') {
    return res.status(200).json({
      ok: true, duplicate: true,
      message: `Hi, ${firstName}! You're already in the GLO! We'll email you when 2027 bookings open.`,
    });
  }

  if (sbResult !== 'new') {
    console.error('[Glo Karts] All storage paths failed. KV:', hasKV, '| SB result:', sbResult);
    return res.status(503).json({
      ok: false,
      error: "We couldn't save your signup right now. Please try again in a moment.",
    });
  }

  /* Supabase save confirmed → notify */
  const past = await findPastBooking(email, normalizedPhone);
  const [poTitle, customerStatus] = CUSTOMER_STATUS_MAP[past] || CUSTOMER_STATUS_MAP.unavailable;
  console.log('[Glo Karts] Supabase save ok, booking status:', past);

  await sendPushover(poTitle,
    `Name: ${rawName}\nPhone: ${rawPhone}\nEmail: ${email}\nCustomer status: ${customerStatus}\nSource: 2027 Season Updates`);

  return res.status(200).json({
    ok: true,
    message: `Hi, ${firstName}! You're in the GLO! We'll email you when 2027 bookings open.`,
  });
}
