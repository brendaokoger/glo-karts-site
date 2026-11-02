/* ── /api/check-config — production diagnostic (GET only) ──────
   Reports which env vars are present and whether each backend
   is actually reachable. Never exposes credential values or
   raw provider error messages.
───────────────────────────────────────────────────────────── */
import https from 'https';

function httpsRequest(method, url, payload, extraHeaders, timeoutMs = 6000) {
  return new Promise((resolve) => {
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
        if (!done) { done = true; req.destroy(); resolve({ status: 0, data: null }); }
      });
      req.on('error', () => { if (!done) { done = true; resolve({ status: 0, data: null }); } });
      if (data) req.write(data);
      req.end();
    } catch { resolve({ status: 0, data: null }); }
  });
}

/* Sanitize Supabase status — never expose raw error bodies */
function sbStatusLabel(status, data) {
  if (status === 200)        return 'reachable';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 404) {
    const msg = typeof data?.message === 'string' ? data.message : '';
    return msg.includes('does not exist') ? 'table_not_found' : 'not_found';
  }
  if (status === 0)          return 'network_error';
  return `http_${status}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  /* ── Env var presence (true/false only) ─────────────────────── */
  const vars = {
    KV_REST_API_URL:    !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN:  !!process.env.KV_REST_API_TOKEN,
    SUPABASE_URL:       !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    PUSHOVER_APP_TOKEN: !!process.env.PUSHOVER_APP_TOKEN,
    PUSHOVER_USER_KEY:  !!process.env.PUSHOVER_USER_KEY,
  };

  const kvVars = vars.KV_REST_API_URL && vars.KV_REST_API_TOKEN;
  const sbVars = vars.SUPABASE_URL && vars.SUPABASE_SERVICE_KEY;
  const poVars = vars.PUSHOVER_APP_TOKEN && vars.PUSHOVER_USER_KEY;

  const probes = {};

  /* ── Probe Vercel KV ─────────────────────────────────────────── */
  if (kvVars) {
    const base = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
    const hdrs = { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
    const r = await httpsRequest('GET', `${base}/ping`, null, hdrs);
    probes.kv = r.status === 200 && (r.data === 'PONG' || r.data?.result === 'PONG')
      ? 'ok'
      : r.status === 0 ? 'network_error' : `http_${r.status}`;
  }

  /* ── Probe Supabase auth ─────────────────────────────────────── */
  if (sbVars) {
    const url  = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const hdrs = {
      apikey:        process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    };

    /* Auth probe — hit a known safe endpoint */
    const authR = await httpsRequest('GET', `${url}/rest/v1/`, null, hdrs);
    probes.supabase_auth = sbStatusLabel(authR.status, authR.data);

    /* subscribe_2027 table probe */
    if (probes.supabase_auth !== 'auth_error' && probes.supabase_auth !== 'network_error') {
      const tblR = await httpsRequest('GET',
        `${url}/rest/v1/subscribe_2027?select=email&limit=0`, null, hdrs);
      probes.supabase_subscribe_2027 = sbStatusLabel(tblR.status, tblR.data);
    }

    /* bookings table probe (for past-booking lookup) */
    if (probes.supabase_auth !== 'auth_error' && probes.supabase_auth !== 'network_error') {
      const bkR = await httpsRequest('GET',
        `${url}/rest/v1/bookings?select=id&limit=0`, null, hdrs);
      probes.supabase_bookings = sbStatusLabel(bkR.status, bkR.data);
    }
  }

  /* ── Probe Pushover credentials ──────────────────────────────── */
  if (poVars) {
    const r = await httpsRequest('POST', 'https://api.pushover.net/1/validate.json', {
      token: process.env.PUSHOVER_APP_TOKEN,
      user:  process.env.PUSHOVER_USER_KEY,
    }, {}, 5000);
    probes.pushover = r.status === 200 && r.data?.status === 1
      ? 'valid'
      : r.status === 0 ? 'network_error'
      : r.data?.status === 0 ? 'invalid_credentials'
      : `http_${r.status}`;
  }

  /* ── Storage readiness ───────────────────────────────────────── */
  const kvReady = kvVars && probes.kv === 'ok';
  const sbReady = sbVars
    && probes.supabase_auth === 'reachable'
    && probes.supabase_subscribe_2027 === 'reachable';
  const storageReady = kvReady || sbReady;

  /* ── Diagnosis ───────────────────────────────────────────────── */
  const issues = [];
  if (!kvVars && !sbVars) issues.push('No storage env vars set — add SUPABASE_URL + SUPABASE_SERVICE_KEY in Vercel dashboard');
  if (sbVars && probes.supabase_auth === 'auth_error') issues.push('Supabase credentials rejected — verify SUPABASE_SERVICE_KEY is the service-role key');
  if (sbVars && probes.supabase_subscribe_2027 === 'table_not_found') issues.push('subscribe_2027 table does not exist — run the CREATE TABLE SQL in Supabase dashboard');
  if (sbVars && probes.supabase_bookings === 'table_not_found') issues.push('bookings table not found — past-booking lookup will report History Unavailable');
  if (!poVars) issues.push('Pushover env vars missing');
  if (poVars && probes.pushover === 'invalid_credentials') issues.push('Pushover credentials invalid');
  if (kvVars && probes.kv !== 'ok') issues.push('KV env vars present but ping failed');

  return res.status(200).json({
    storage_ready: storageReady,
    notifications_ready: poVars && probes.pushover === 'valid',
    vars,
    probes,
    issues: issues.length ? issues : ['none — all systems operational'],
  });
}
