/* ── Glo Karts Booking API ─────────────────────────────────────
   POST /api/book
   Receives booking payload from the wizard, fires a Pushover
   push notification, and (when Supabase is ready) persists the
   booking to the database.

   Environment variables (set in Vercel dashboard):
     PUSHOVER_APP_TOKEN  — Pushover application token
     PUSHOVER_USER_KEY   — Pushover user/group key
     SUPABASE_URL        — https://xxxx.supabase.co  (add later)
     SUPABASE_SERVICE_KEY — service_role key          (add later)

   A failed Pushover call does NOT block the booking response.
   A missing Supabase config is silently skipped until provided.
──────────────────────────────────────────────────────────────── */

import https from 'https';

/* Tiny https POST helper — no dependency on global fetch */
function httpsPost(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path:     u.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export default async function handler(req, res) {
  /* Only accept POST */
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }

  const {
    bookingId,
    tour,
    date,
    time,
    riderCount,
    contact,
    riders,
    signature,
  } = body || {};

  /* ── Basic validation ──────────────────────────────────── */
  if (!bookingId || !tour || !date || !time || !contact?.phone) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  /* ── Past-date guard (America/Chicago) ─────────────────── */
  const todayChicago = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  if (date < todayChicago) {
    return res.status(400).json({ ok: false, error: 'Cannot book a date that has already passed.' });
  }

  /* ── Waiver summary ────────────────────────────────────── */
  const totalRiders = Number(riderCount) || (riders || []).length;
  const waiversDone = (riders || []).filter(r => r.waiverStatus === 'COMPLETE').length;

  /* ── Supabase persistence (activate when ready) ─────────── */
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const bookingPayload = {
        id:               bookingId,
        status:           'PENDING_CONFIRMATION',
        tour,
        requested_date:   date,
        requested_time:   time,
        rider_count:      totalRiders,
        contact_first:    contact.first,
        contact_last:     contact.last,
        contact_phone:    contact.phone,
        contact_email:    contact.email,
        contact_is_rider: contact.isRiding,
        price_per_rider:  49.99,
        signature_name:   signature?.printedName || '',
        signature_ts:     signature?.timestamp   || new Date().toISOString(),
        waiver_version:   signature?.waiverVersion || '1.0',
        notes: '',
      };

      await httpsPost(`${supabaseUrl}/rest/v1/bookings`, bookingPayload)
        .catch(e => console.error('[Glo Karts] Supabase error:', e.message));

      if (riders && riders.length > 0) {
        const riderRows = riders.map((r, i) => ({
          booking_id:    bookingId,
          position:      i + 1,
          first_name:    r.first  || '',
          last_name:     r.last   || '',
          email:         r.email  || null,
          is_minor:      r.isMinor || false,
          guardian_name: r.guardianName || null,
          guardian_rel:  r.guardianRel  || null,
          waiver_status: r.waiverStatus || 'PENDING',
          add_later:     r.addLater     || false,
        }));
        await httpsPost(`${supabaseUrl}/rest/v1/riders`, riderRows)
          .catch(e => console.error('[Glo Karts] Supabase riders error:', e.message));
      }
    } catch (dbErr) {
      console.error('[Glo Karts] Supabase error:', dbErr.message);
    }
  } else {
    console.warn('[Glo Karts] Supabase not configured — booking not persisted.');
  }

  /* ── Pushover notification ──────────────────────────────── */
  const poToken   = process.env.PUSHOVER_APP_TOKEN;
  const poUserKey = process.env.PUSHOVER_USER_KEY;

  if (poToken && poUserKey) {
    const riderLines = (riders || [])
      .map((r, i) => {
        const name = (r.first && r.last) ? `${r.first} ${r.last}` : `Rider ${i + 1}`;
        return `${i + 1}. ${name}${r.isMinor ? ' (Minor)' : ''}`;
      })
      .join('\n');

    const message = [
      `Booking ID: ${bookingId}`,
      `Customer: ${contact.first} ${contact.last}`,
      `Phone: ${contact.phone}`,
      `Email: ${contact.email || 'not provided'}`,
      ``,
      `Tour: ${tour}`,
      `Date: ${date}`,
      `Time: ${time}`,
      `Riders: ${totalRiders}`,
      `Waivers: ${waiversDone}/${totalRiders} complete`,
      riderLines ? `\n${riderLines}` : '',
      ``,
      `NEEDS PHONE CONFIRMATION`,
    ].join('\n').slice(0, 1024);

    try {
      const result = await httpsPost('https://api.pushover.net/1/messages.json', {
        token:    poToken,
        user:     poUserKey,
        title:    `New Booking: ${contact.first} ${contact.last}`,
        message,
        priority: 1,
        sound:    'siren',
      });
      if (result.data && result.data.status !== 1) {
        console.error('[Glo Karts] Pushover rejected:', JSON.stringify(result.data));
      }
    } catch (pushErr) {
      console.error('[Glo Karts] Pushover error:', pushErr.message);
    }
  } else {
    console.error('[Glo Karts] Pushover env vars missing — PUSHOVER_APP_TOKEN and/or PUSHOVER_USER_KEY not set.');
  }

  /* ── Response ───────────────────────────────────────────── */
  return res.status(200).json({
    ok:      true,
    bookingId,
    status:  'PENDING_CONFIRMATION',
    message: 'Booking request received. A Glo Karts team member will contact you by phone.',
  });
}
