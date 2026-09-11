import { initConsent } from './consent';
import { initEvents } from './events';
import { initNav } from './nav';
import { initLang } from './lang';
import { initBanner } from './banner';
import { initScroll } from './scroll';
import { initFaq } from './faq';
import { initPhases } from './phases';
import { initStory } from './story';
import { initForm } from './form';
import { initTestimonials } from './testimonials';
import { initEffects } from './effects';
import { initReveal } from './reveal';
import { initInstagram } from './instagram';
import { initServiceWorker } from './sw';

function init(): void {
  initConsent();
  initEvents();
  initNav();
  initLang();
  initBanner();
  initScroll();
  initFaq();
  initPhases();
  initStory();
  initForm();
  initTestimonials();
  initEffects();
  initReveal();
  initInstagram();

  const year = document.getElementById('copyright-year');
  if (year) year.textContent = String(new Date().getFullYear());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

initServiceWorker();
