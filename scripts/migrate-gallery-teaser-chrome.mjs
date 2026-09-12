// One-off script: adds a `galleryTeaser` chrome block to every locale
// file for the new on-site banner advertising the private gallery (see
// src/components/sections/GalleryTeaser.astro). Hand-translated (no local
// Anthropic credential was available), same quality bar as every other
// hand-translated chrome addition this session (testimonials' form/cta).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const CHROME = {
  en: { eyebrow: 'Behind the Scenes', heading: 'Follow the Real Training', text: 'Request access to our private gallery — real, day-to-day training footage, not a highlight reel.', cta: 'Request access' },
  el: { eyebrow: 'Στα Παρασκήνια', heading: 'Παρακολουθήστε την Πραγματική Εκπαίδευση', text: 'Ζητήστε πρόσβαση στην ιδιωτική μας συλλογή — αληθινό, καθημερινό υλικό εκπαίδευσης, όχι επιλεγμένες στιγμές.', cta: 'Ζητήστε πρόσβαση' },
  de: { eyebrow: 'Hinter den Kulissen', heading: 'Verfolgen Sie das echte Training', text: 'Fordern Sie Zugang zu unserer privaten Galerie an — echtes, alltägliches Trainingsmaterial, keine Hochglanzauswahl.', cta: 'Zugang anfragen' },
  fr: { eyebrow: 'Dans les coulisses', heading: "Suivez le véritable entraînement", text: "Demandez l'accès à notre galerie privée — des images réelles et quotidiennes de l'entraînement, pas une sélection soignée.", cta: "Demander l'accès" },
  ar: { eyebrow: 'خلف الكواليس', heading: 'تابع التدريب الحقيقي', text: 'اطلب الوصول إلى معرضنا الخاص — لقطات تدريب حقيقية يومية، وليست لقطات مختارة بعناية.', cta: 'طلب الوصول' },
  es: { eyebrow: 'Entre bastidores', heading: 'Sigue el entrenamiento real', text: 'Solicita acceso a nuestra galería privada — imágenes reales y cotidianas del entrenamiento, no una selección de lo mejor.', cta: 'Solicitar acceso' },
  zh: { eyebrow: '幕后花絮', heading: '关注真实的训练过程', text: '申请访问我们的私人图库 — 真实的日常训练画面,而非精心挑选的精彩片段。', cta: '申请访问' },
  ru: { eyebrow: 'За кулисами', heading: 'Следите за настоящей тренировкой', text: 'Запросите доступ к нашей закрытой галерее — реальные, повседневные кадры тренировок, а не отобранные моменты.', cta: 'Запросить доступ' },
  tr: { eyebrow: 'Perde Arkası', heading: 'Gerçek Eğitimi Takip Edin', text: 'Özel galerimize erişim talep edin — seçilmiş anlar değil, gerçek, günlük eğitim görüntüleri.', cta: 'Erişim talep et' },
  it: { eyebrow: 'Dietro le quinte', heading: "Segui l'addestramento reale", text: "Richiedi l'accesso alla nostra galleria privata — filmati reali e quotidiani dell'addestramento, non una selezione di momenti migliori.", cta: 'Richiedi accesso' },
  pt: { eyebrow: 'Nos bastidores', heading: 'Acompanhe o treino real', text: 'Solicite acesso à nossa galeria privada — imagens reais e do dia a dia do treino, não uma seleção dos melhores momentos.', cta: 'Solicitar acesso' },
  nl: { eyebrow: 'Achter de schermen', heading: 'Volg de echte training', text: 'Vraag toegang aan tot onze privégalerij — echte, dagelijkse trainingsbeelden, geen uitgekozen hoogtepunten.', cta: 'Toegang aanvragen' },
  ja: { eyebrow: '舞台裏', heading: '本当のトレーニングを追う', text: '非公開ギャラリーへのアクセスをリクエストしてください — 厳選されたハイライトではなく、リアルで日々のトレーニング映像です。', cta: 'アクセスをリクエスト' },
};

for (const [locale, chrome] of Object.entries(CHROME)) {
  const filePath = path.join(root, 'src/i18n/locales', `${locale}.json`);
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  data.galleryTeaser = chrome;
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`Updated ${locale}.json`);
}
