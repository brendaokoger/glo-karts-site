/* ── Glo Karts Booking API ─────────────────────────────────────
   POST /api/book
   Receives booking payload from the wizard, fires a Pushover
   push notification, and (when Supabase is ready) persists the
   booking to the database.

   Environment variables (set in Vercel dashboard):
     PUSHOVER_APP_TOKEN  — Pushover application token
     PUSHOVER_USER_KEY   — Pushover user/group key
     SUPABASE_URL        — https://xxxx.supabase.co  (add later)
     SUPABASE_SERVICE_KEY — service_role key           (add later)

   A failed Pushover call does NOT block the booking response.
   A missing Supabase config is silently skipped until provided.
──────────────────────────────────────────────────────────────── */

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

  /* ── Waiver summary ────────────────────────────────────── */
  const totalRiders   = Number(riderCount) || (riders || []).length;
  const waiversDone   = (riders || []).filter(r => r.waiverStatus === 'COMPLETE').length;
  const waiversPending = totalRiders - waiversDone;

  /* ── Supabase persistence (stub — activate when ready) ──── */
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      /* Insert booking record */
      const bookingPayload = {
        id:             bookingId,
        status:         'PENDING_CONFIRMATION',
        tour,
        requested_date: date,
        requested_time: time,
        rider_count:    totalRiders,
        contact_first:  contact.first,
        contact_last:   contact.last,
        contact_phone:  contact.phone,
        contact_email:  contact.email,
        contact_is_rider: contact.isRiding,
        price_per_rider: 49.99,
        signature_name:  signature?.printedName || '',
        signature_ts:    signature?.timestamp   || new Date().toISOString(),
        waiver_version:  signature?.waiverVersion || '1.0',
        notes: '',
      };

      const bookingRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':         supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer':        'return=representation',
        },
        body: JSON.stringify(bookingPayload),
      });

      if (!bookingRes.ok) {
        const err = await bookingRes.text();
        console.error('[Glo Karts] Supabase bookings insert error:', err);
      }

      /* Insert rider records */
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

        const ridersRes = await fetch(`${supabaseUrl}/rest/v1/riders`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'apikey':         supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify(riderRows),
        });

        if (!ridersRes.ok) {
          const err = await ridersRes.text();
          console.error('[Glo Karts] Supabase riders insert error:', err);
        }
      }
    } catch (dbErr) {
      /* DB errors are logged but do not fail the booking */
      console.error('[Glo Karts] Supabase error:', dbErr);
    }
  } else {
    console.warn('[Glo Karts] Supabase not configured — booking not persisted to database. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel environment variables.');
  }

  /* ── Pushover notification ──────────────────────────────── */
  const poToken   = process.env.PUSHOVER_APP_TOKEN;
  const poUserKey = process.env.PUSHOVER_USER_KEY;

  /* ── Pushover notification ──────────────────────────────── */
  let poDiag = { attempted: false, ok: null, status: null, error: null };

  if (poToken && poUserKey) {
    const riderNames = (riders || [])
      .map((r, i) => {
        const name = (r.first && r.last) ? `${r.first} ${r.last}` : `Rider ${i + 1}`;
        return `  ${i + 1}. ${name}${r.isMinor ? ' (Minor)' : ''}`;
      })
      .join('\n');

    const message = [
      `NEW GLO KARTS BOOKING REQUEST`,
      ``,
      `Booking ID: ${bookingId}`,
      `Customer: ${contact.first} ${contact.last}`,
      `Phone: ${contact.phone}`,
      `Email: ${contact.email || 'not provided'}`,
      ``,
      `Tour: ${tour}`,
      `Date: ${date}`,
      `Time: ${time}`,
      `Riders: ${totalRiders}`,
      ``,
      `Waivers: ${waiversDone} of ${totalRiders} complete`,
      riderNames ? `\nRiders:\n${riderNames}` : '',
      ``,
      `Status: NEEDS PHONE CONFIRMATION`,
    ].filter(l => l !== undefined).join('\n');

    poDiag.attempted = true;

    try {
      const poRes = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token:    poToken,
          user:     poUserKey,
          title:    `New Booking: ${contact.first} ${contact.last}`,
          message:  message.slice(0, 1024),   /* Pushover hard limit */
          priority: 1,
          sound:    'siren',
        }),
      });

      const poData = await poRes.json();
      poDiag.ok     = poData.status === 1;
      poDiag.status = poData.status;
      if (!poDiag.ok) {
        poDiag.error = poData.errors || poRes.status;
        console.error('[Glo Karts] Pushover error:', JSON.stringify(poData));
      }
    } catch (pushErr) {
      poDiag.ok    = false;
      poDiag.error = pushErr.message;
      console.error('[Glo Karts] Pushover fetch error:', pushErr.message);
    }
  } else {
    poDiag.error = 'env vars missing: ' + [
      !poToken   && 'PUSHOVER_APP_TOKEN',
      !poUserKey && 'PUSHOVER_USER_KEY',
    ].filter(Boolean).join(', ');
    console.warn('[Glo Karts] Pushover not configured —', poDiag.error);
  }

  /* ── Success response ───────────────────────────────────── */
  return res.status(200).json({
    ok:        true,
    bookingId,
    status:    'PENDING_CONFIRMATION',
    message:   'Booking request received. A Glo Karts team member will contact you by phone.',
    _pushover: poDiag,   /* temporary diagnostic — remove after Pushover confirmed */
  });
}
