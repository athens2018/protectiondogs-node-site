// A short operational email to the site owner, reusing the same Resend
// account and "from" domain already used for enquiry-form notifications
// (src/pages/api/enquiry.ts) — same contact address from facts.json,
// rather than adding a separate email config var.
import facts from '../data/facts.json';

const TO_ADDRESS = (facts as { contact: { email: string } }).contact.email;
const FROM_ADDRESS = 'Protection Dogs GR Site <enquiries@protectiondogs.gr>';

/**
 * Best-effort email to the owner — never throws. A failed notification must
 * never break whatever it's reporting on; callers run this inside a
 * background (waitUntil) task and don't need to check the result.
 */
export async function notifyOwner(subject: string, textBody: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[notify] RESEND_API_KEY is not set; skipping owner notification:', subject);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [TO_ADDRESS], subject, text: textBody }),
    });
    if (!res.ok) {
      console.error('[notify] Resend API error', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('[notify] network error calling Resend:', err instanceof Error ? err.message : String(err));
  }
}

/** Waits roughly as long as a typical rebuild takes, so a "your site is live" email lands after the deploy actually finishes rather than the moment it's triggered. Not a real completion check (see src/pages/admin/api/dogs/save.ts's comment on backgroundTranslateAndSave for why) — just a reasonable, honest delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
