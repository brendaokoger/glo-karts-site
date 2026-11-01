/* ── /api/check-config — safe production diagnostic ──────────
   GET only. Returns which env vars are present/absent and
   tests the Supabase connection. Never reveals credential values.
───────────────────────────────────────────────────────────── */
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
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  const cfg = {
    kv: {
      KV_REST_API_URL:   !!process.env.KV_REST_API_URL,
      KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    },
    supabase: {
      SUPABASE_URL:         !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    },
    pushover: {
      PUSHOVER_APP_TOKEN: !!process.env.PUSHOVER_APP_TOKEN,
      PUSHOVER_USER_KEY:  !!process.env.PUSHOVER_USER_KEY,
    },
  };

  const kvOk = cfg.kv.KV_REST_API_URL && cfg.kv.KV_REST_API_TOKEN;
  const sbOk = cfg.supabase.SUPABASE_URL && cfg.supabase.SUPABASE_SERVICE_KEY;
  const poOk = cfg.pushover.PUSHOVER_APP_TOKEN && cfg.pushover.PUSHOVER_USER_KEY;

  const probes = {};

  /* Probe Supabase — check if subscribe_2027 table is reachable */
  if (sbOk) {
    try {
      const url  = process.env.SUPABASE_URL.replace(/\/$/, '');
      const hdrs = {
        apikey:        process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      };
      const r = await httpsRequest('GET',
        `${url}/rest/v1/subscribe_2027?select=email&limit=0`, null, hdrs);
      probes.supabase_subscribe_2027 = r.status === 200
        ? 'reachable'
        : `error_${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`;
    } catch (e) {
      probes.supabase_subscribe_2027 = `exception: ${e.message}`;
    }
  }

  /* Probe Vercel KV ping */
  if (kvOk) {
    try {
      const base = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
      const hdrs = { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
      const r = await httpsRequest('GET', `${base}/ping`, null, hdrs);
      probes.kv_ping = r.status === 200 ? 'ok' : `error_${r.status}`;
    } catch (e) {
      probes.kv_ping = `exception: ${e.message}`;
    }
  }

  return res.status(200).json({
    storage_ready: kvOk || sbOk,
    notifications_ready: poOk,
    config: cfg,
    probes,
    diagnosis: !kvOk && !sbOk
      ? 'NO STORAGE CONFIGURED — set KV vars or SUPABASE vars in Vercel dashboard'
      : kvOk && !sbOk
        ? 'KV only (Supabase fallback not available)'
        : !kvOk && sbOk
          ? 'Supabase only — ensure subscribe_2027 table exists'
          : 'Both KV and Supabase available',
  });
}
