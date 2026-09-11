import type { APIRoute } from 'astro';
import facts from '../../data/facts.json';

// Server-rendered on Vercel; every other route in this project stays fully
// static/prerendered (see astro.config.mjs — output: 'static' + this one
// opt-out is exactly what @astrojs/vercel's mixed static+server mode is for).
export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TO_ADDRESS = (facts as { contact: { email: string } }).contact.email;
const FROM_ADDRESS = 'Protection Dogs GR Enquiries <enquiries@protectiondogs.gr>';

interface FieldError {
  field: string;
  message: string;
}

function jsonError(status: number, errors: FieldError[]): Response {
  return new Response(JSON.stringify({ errors }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, [{ field: 'form', message: 'Malformed submission.' }]);
  }

  const get = (key: string) => String(form.get(key) ?? '').trim();

  // Honeypot: a real visitor never fills this (it's visually hidden and
  // skipped in tab order); a bot's autofill usually does. Answer exactly
  // like a genuine success so the bot has no signal it was caught — never
  // reveal the trap, never send the mail.
  if (get('_gotcha')) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const name = get('name');
  const email = get('email');
  const phone = get('phone');
  const country = get('country');
  const interest = get('interest');
  const message = get('message');
  const locale = get('_locale') || 'en';
  const privacyConsent = get('privacy-consent') || get('privacyConsent');

  const errors: FieldError[] = [];
  if (!name) errors.push({ field: 'name', message: 'Full name is required.' });
  if (!email || !EMAIL_RE.test(email)) errors.push({ field: 'email', message: 'A valid email address is required.' });
  if (!message) errors.push({ field: 'message', message: 'A message is required.' });
  if (!privacyConsent) errors.push({ field: 'privacy-consent', message: 'Privacy policy consent is required.' });
  if (errors.length) return jsonError(400, errors);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[api/enquiry] RESEND_API_KEY is not set');
    return jsonError(500, [{ field: 'server', message: 'Email is not configured. Please try again shortly.' }]);
  }

  const rows: [string, string][] = [
    ['Name', name],
    ['Email', email],
    ['Phone', phone || '—'],
    ['Country', country || '—'],
    ['Interest', interest || '—'],
    ['Language', locale],
  ];

  const textBody = [
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Message:',
    message,
  ].join('\n');

  const htmlBody = `
    <table cellpadding="0" cellspacing="0" style="font-family:sans-serif;font-size:14px;color:#111">
      ${rows.map(([label, value]) => `<tr><td style="padding:2px 8px 2px 0;color:#666">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}
    </table>
    <p style="margin-top:16px;color:#666">Message:</p>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
  `;

  let resendResponse: Response;
  try {
    resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [TO_ADDRESS],
        reply_to: email,
        subject: `New enquiry — ${interest || 'General'} (${name})`,
        text: textBody,
        html: htmlBody,
      }),
    });
  } catch (err) {
    console.error('[api/enquiry] network error calling Resend', err);
    return jsonError(502, [{ field: 'server', message: 'Could not send the message right now. Please try again.' }]);
  }

  if (!resendResponse.ok) {
    const detail = await resendResponse.text().catch(() => '');
    console.error('[api/enquiry] Resend API error', resendResponse.status, detail);
    return jsonError(502, [{ field: 'server', message: 'Could not send the message right now. Please try again.' }]);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
