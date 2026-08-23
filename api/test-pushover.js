/* ── Glo Karts Pushover Test ────────────────────────────────
   Temporary diagnostic endpoint.
   DELETE this file once Pushover is confirmed working.

   POST /api/test-pushover
   Returns whether the env vars are present and whether the
   Pushover API call succeeded. Never exposes credential values.
──────────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  const token   = process.env.PUSHOVER_APP_TOKEN;
  const userKey = process.env.PUSHOVER_USER_KEY;

  /* Report which vars are missing without exposing values */
  const missing = [
    !token   && 'PUSHOVER_APP_TOKEN',
    !userKey && 'PUSHOVER_USER_KEY',
  ].filter(Boolean);

  if (missing.length > 0) {
    return res.status(200).json({
      ok:     false,
      error:  'Missing Vercel environment variable(s)',
      missing,
      action: 'Vercel Dashboard → Glo Karts project → Settings → Environment Variables → add to Production',
    });
  }

  /* Both vars present — fire the test notification */
  let poData, poStatus;
  try {
    const poRes = await fetch('https://api.pushover.net/1/messages.json', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user:     userKey,
        title:    'GLO KARTS TEST',
        message:  'Pushover connection successful.\nNew booking alerts are ready.',
        priority: 0,
        sound:    'pushover',
      }),
    });
    poStatus = poRes.status;
    poData   = await poRes.json();
  } catch (fetchErr) {
    return res.status(200).json({
      ok:    false,
      error: 'Network error reaching Pushover API',
      detail: fetchErr.message,
    });
  }

  const success = poStatus === 200 && poData.status === 1;

  return res.status(200).json({
    ok:               success,
    pushover_status:  poData.status,      /* 1 = success */
    pushover_request: poData.request,     /* Pushover request ID */
    http_status:      poStatus,
    errors:           poData.errors || null,
  });
}
