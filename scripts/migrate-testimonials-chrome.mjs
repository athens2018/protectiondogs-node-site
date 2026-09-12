// One-off script: replaces the old testimonial.to consent/embed UI strings
// in every locale file with the new self-hosted testimonials section's
// chrome (share button + submission form labels). Translations below were
// authored directly (not run through the Claude API — no key was
// available in this environment at the time), aiming for the same
// natural, native-sounding quality bar as every other translated string on
// this site. Preserves each locale's existing eyebrow/h2.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const CHROME = {
  en: {
    cta: 'Share your experience',
    form: {
      title: 'Share your experience',
      intro: "Tell other families about your experience with Protection Dogs GR. Your submission will be reviewed before it appears on the site.",
      name: 'Your name',
      location: 'Location (optional)',
      rating: 'Rating',
      quote: 'Your testimonial',
      submit: 'Submit',
      success: 'Thank you — your testimonial has been submitted and will appear once reviewed.',
      error: 'Something went wrong submitting your testimonial. Please try again.',
    },
  },
  el: {
    cta: 'Μοιραστείτε την εμπειρία σας',
    form: {
      title: 'Μοιραστείτε την εμπειρία σας',
      intro: 'Πείτε σε άλλες οικογένειες για την εμπειρία σας με την Protection Dogs GR. Η υποβολή σας θα ελεγχθεί πριν εμφανιστεί στον ιστότοπο.',
      name: 'Το όνομά σας',
      location: 'Τοποθεσία (προαιρετικό)',
      rating: 'Βαθμολογία',
      quote: 'Η μαρτυρία σας',
      submit: 'Υποβολή',
      success: 'Ευχαριστούμε — η μαρτυρία σας υποβλήθηκε και θα εμφανιστεί μόλις ελεγχθεί.',
      error: 'Κάτι πήγε στραβά κατά την υποβολή. Παρακαλούμε δοκιμάστε ξανά.',
    },
  },
  de: {
    cta: 'Teilen Sie Ihre Erfahrung',
    form: {
      title: 'Teilen Sie Ihre Erfahrung',
      intro: 'Erzählen Sie anderen Familien von Ihrer Erfahrung mit Protection Dogs GR. Ihr Beitrag wird geprüft, bevor er auf der Website erscheint.',
      name: 'Ihr Name',
      location: 'Standort (optional)',
      rating: 'Bewertung',
      quote: 'Ihre Erfahrung',
      submit: 'Absenden',
      success: 'Vielen Dank — Ihre Bewertung wurde eingereicht und erscheint nach Prüfung.',
      error: 'Beim Absenden ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.',
    },
  },
  fr: {
    cta: 'Partagez votre expérience',
    form: {
      title: 'Partagez votre expérience',
      intro: "Racontez à d'autres familles votre expérience avec Protection Dogs GR. Votre témoignage sera examiné avant d'apparaître sur le site.",
      name: 'Votre nom',
      location: 'Lieu (facultatif)',
      rating: 'Note',
      quote: 'Votre témoignage',
      submit: 'Envoyer',
      success: 'Merci — votre témoignage a été envoyé et apparaîtra après validation.',
      error: 'Une erreur est survenue lors de l\'envoi. Veuillez réessayer.',
    },
  },
  ar: {
    cta: 'شارك تجربتك',
    form: {
      title: 'شارك تجربتك',
      intro: 'أخبر العائلات الأخرى عن تجربتك مع Protection Dogs GR. ستتم مراجعة تعليقك قبل ظهوره على الموقع.',
      name: 'اسمك',
      location: 'الموقع (اختياري)',
      rating: 'التقييم',
      quote: 'شهادتك',
      submit: 'إرسال',
      success: 'شكرًا لك — تم إرسال شهادتك وستظهر بعد المراجعة.',
      error: 'حدث خطأ أثناء الإرسال. يرجى المحاولة مرة أخرى.',
    },
  },
  es: {
    cta: 'Comparte tu experiencia',
    form: {
      title: 'Comparte tu experiencia',
      intro: 'Cuéntales a otras familias tu experiencia con Protection Dogs GR. Tu testimonio será revisado antes de aparecer en el sitio.',
      name: 'Tu nombre',
      location: 'Ubicación (opcional)',
      rating: 'Valoración',
      quote: 'Tu testimonio',
      submit: 'Enviar',
      success: 'Gracias — tu testimonio ha sido enviado y aparecerá una vez revisado.',
      error: 'Algo salió mal al enviar tu testimonio. Inténtalo de nuevo.',
    },
  },
  zh: {
    cta: '分享您的体验',
    form: {
      title: '分享您的体验',
      intro: '向其他家庭讲述您与 Protection Dogs GR 的体验。您的留言将在审核后显示在网站上。',
      name: '您的姓名',
      location: '所在地(可选)',
      rating: '评分',
      quote: '您的评价',
      submit: '提交',
      success: '谢谢 — 您的评价已提交,审核通过后将显示。',
      error: '提交时出错,请重试。',
    },
  },
  ru: {
    cta: 'Поделитесь своим опытом',
    form: {
      title: 'Поделитесь своим опытом',
      intro: 'Расскажите другим семьям о своём опыте с Protection Dogs GR. Ваш отзыв будет проверен перед публикацией на сайте.',
      name: 'Ваше имя',
      location: 'Местоположение (необязательно)',
      rating: 'Оценка',
      quote: 'Ваш отзыв',
      submit: 'Отправить',
      success: 'Спасибо — ваш отзыв отправлен и появится после проверки.',
      error: 'При отправке произошла ошибка. Пожалуйста, попробуйте снова.',
    },
  },
  tr: {
    cta: 'Deneyiminizi paylaşın',
    form: {
      title: 'Deneyiminizi paylaşın',
      intro: 'Protection Dogs GR ile deneyiminizi diğer ailelerle paylaşın. Gönderiniz siteye eklenmeden önce incelenecektir.',
      name: 'Adınız',
      location: 'Konum (isteğe bağlı)',
      rating: 'Değerlendirme',
      quote: 'Yorumunuz',
      submit: 'Gönder',
      success: 'Teşekkürler — yorumunuz gönderildi ve incelendikten sonra yayınlanacak.',
      error: 'Gönderirken bir sorun oluştu. Lütfen tekrar deneyin.',
    },
  },
  it: {
    cta: 'Condividi la tua esperienza',
    form: {
      title: 'Condividi la tua esperienza',
      intro: 'Racconta ad altre famiglie la tua esperienza con Protection Dogs GR. La tua recensione sarà controllata prima di apparire sul sito.',
      name: 'Il tuo nome',
      location: 'Località (facoltativo)',
      rating: 'Valutazione',
      quote: 'La tua recensione',
      submit: 'Invia',
      success: 'Grazie — la tua recensione è stata inviata e apparirà dopo la verifica.',
      error: 'Si è verificato un errore durante l\'invio. Riprova.',
    },
  },
  pt: {
    cta: 'Partilhe a sua experiência',
    form: {
      title: 'Partilhe a sua experiência',
      intro: 'Conte a outras famílias a sua experiência com a Protection Dogs GR. O seu comentário será revisto antes de aparecer no site.',
      name: 'O seu nome',
      location: 'Localização (opcional)',
      rating: 'Classificação',
      quote: 'O seu testemunho',
      submit: 'Enviar',
      success: 'Obrigado — o seu testemunho foi enviado e aparecerá após revisão.',
      error: 'Ocorreu um erro ao enviar. Por favor, tente novamente.',
    },
  },
  nl: {
    cta: 'Deel uw ervaring',
    form: {
      title: 'Deel uw ervaring',
      intro: 'Vertel andere gezinnen over uw ervaring met Protection Dogs GR. Uw inzending wordt beoordeeld voordat deze op de site verschijnt.',
      name: 'Uw naam',
      location: 'Locatie (optioneel)',
      rating: 'Beoordeling',
      quote: 'Uw ervaring',
      submit: 'Versturen',
      success: 'Bedankt — uw ervaring is verzonden en verschijnt na beoordeling.',
      error: 'Er ging iets mis bij het versturen. Probeer het opnieuw.',
    },
  },
  ja: {
    cta: '体験談を共有する',
    form: {
      title: '体験談を共有する',
      intro: 'Protection Dogs GRでの体験を他のご家族にお伝えください。投稿は確認後にサイトに掲載されます。',
      name: 'お名前',
      location: '所在地(任意)',
      rating: '評価',
      quote: '体験談',
      submit: '送信',
      success: 'ありがとうございます — 体験談が送信されました。確認後に掲載されます。',
      error: '送信中にエラーが発生しました。もう一度お試しください。',
    },
  },
};

for (const [locale, chrome] of Object.entries(CHROME)) {
  const filePath = path.join(root, 'src/i18n/locales', `${locale}.json`);
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  data.testimonials = {
    eyebrow: data.testimonials.eyebrow,
    h2: data.testimonials.h2,
    cta: chrome.cta,
    form: chrome.form,
  };
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`Updated ${locale}.json`);
}
