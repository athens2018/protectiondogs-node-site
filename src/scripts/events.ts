import { track } from './consent';

// The documented, consent-gated conversion-event set and nothing else:
// cta_bobo_reservation, cta_future_dog, cta_view_dogs, cta_discuss_placement,
// enquiry_submit_success, enquiry_submit_failed, whatsapp_click, phone_click,
// language_change, bobo_story_open. Parameters are the page language, the
// fixed Interest option, the section a CTA sits in and a failure reason —
// never a name, e-mail, phone number or message text.
export function initEvents(): void {
  const lang = document.documentElement.lang || '';

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      const a = target && target.closest ? target.closest('a') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const section = a.closest('section');
      const where = section && section.id ? section.id : a.closest('.hero') ? 'hero' : '';

      if (a.hasAttribute('data-interest')) {
        const interest = a.getAttribute('data-interest') || '';
        track(/^Bobo/.test(interest) ? 'cta_bobo_reservation' : 'cta_future_dog', {
          interest,
          page_lang: lang,
          location: where,
        });
      } else if (a.closest('.hero') && href === '#dogs') {
        track('cta_view_dogs', { page_lang: lang, location: 'hero' });
      } else if (a.closest('.hero') && href === '#contact') {
        track('cta_discuss_placement', { page_lang: lang, location: 'hero' });
      } else if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(href)) {
        track('whatsapp_click', { page_lang: lang, location: where });
      } else if (/^tel:/i.test(href)) {
        track('phone_click', { page_lang: lang, location: where });
      } else if (
        a.classList.contains('lang-option') ||
        a.classList.contains('footer-lang') ||
        a.id === 'langSuggestSwitch'
      ) {
        track('language_change', {
          from_lang: lang,
          to_lang: a.getAttribute('hreflang') || a.getAttribute('data-lang-code') || '',
        });
      }
    },
    true,
  );

  const form = document.getElementById('contact-form');
  if (!form) return;
  form.addEventListener('pdg-enquiry-success', () => {
    const interest = form.querySelector<HTMLSelectElement>('#interest');
    track('enquiry_submit_success', { page_lang: lang, interest: interest ? interest.value : '' });
  });
  form.addEventListener('pdg-enquiry-failed', (e) => {
    const detail = (e as CustomEvent<{ reason?: string }>).detail;
    track('enquiry_submit_failed', { page_lang: lang, reason: (detail && detail.reason) || 'unknown' });
  });

  // Enquiry CTA context: pre-select the matching Interest option so the form
  // already knows why the visitor is here.
  document.querySelectorAll<HTMLElement>('[data-stop-propagation]').forEach((el) => {
    el.addEventListener('click', (e) => e.stopPropagation());
  });
  document.querySelectorAll<HTMLAnchorElement>('a[href="#contact"][data-interest]').forEach((link) => {
    link.addEventListener('click', () => {
      const field = document.getElementById('interest') as HTMLSelectElement | null;
      if (field) field.value = link.getAttribute('data-interest') || '';
    });
  });
}
