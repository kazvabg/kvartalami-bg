import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

export const PATHS = {
  root: ROOT,
  data: join(ROOT, 'data'),
  articles: join(ROOT, 'data', 'articles'),
  seen: join(ROOT, 'data', 'seen.json'),
  site: join(ROOT, 'site'),
};

// Legacy single-district articles/seen/health predate the multi-district
// refactor and all belonged to Оборище; used to migrate old keys + articles.
export const LEGACY_DISTRICT = 'oborishte';

export const CATEGORIES = {
  repairs: { label: 'Ремонти', icon: '🔧' },
  government: { label: 'Местна власт', icon: '🏛️' },
  transport: { label: 'Транспорт', icon: '🚌' },
  events: { label: 'Събития', icon: '📅' },
  other: { label: 'Други', icon: '📌' },
};

// Master registry of every scraper. A source applies to a district when the
// district lists its id in `sources` below. `districtSpecific` sources publish
// only district-relevant content, so scrape.js skips the keyword filter for them.
export const SOURCES = [
  {
    id: 'sofiyska-voda',
    name: 'Софийска вода',
    url: 'https://www.sofiyskavoda.bg/water-stops',
    category: 'repairs',
    scraper: 'sofiyska-voda.js',
  },
  {
    id: 'toplofikacia',
    name: 'Топлофикация София',
    url: 'https://toplo.bg/accidents-and-maintenance',
    category: 'repairs',
    scraper: 'toplofikacia.js',
  },
  {
    id: 'erm-zapad',
    name: 'ЕРМ Запад',
    url: 'https://ermzapad.bg/bg/za-klienta/prekusvania/',
    category: 'repairs',
    scraper: 'erm-zapad.js',
  },
  {
    id: 'sofia-traffic',
    name: 'Столична община — движение',
    url: 'https://www.sofia.bg/bg/repairs-and-traffic-changes',
    category: 'transport',
    scraper: 'sofia-traffic.js',
  },
  {
    id: 'sofia-municipality',
    name: 'Столична община',
    url: 'https://www.sofia.bg/news',
    category: 'government',
    scraper: 'sofia-municipality.js',
  },
  {
    id: 'sofia-council',
    name: 'Столичен общински съвет',
    url: 'https://council.sofia.bg/',
    category: 'government',
    scraper: 'sofia-council.js',
  },
  {
    id: 'rayon-oborishte',
    name: 'Район Оборище',
    url: 'https://rayon-oborishte.bg',
    category: 'government',
    scraper: 'rayon-oborishte.js',
    districtSpecific: true,
  },
  {
    id: 'rayon-lozenets',
    name: 'Район Лозенец',
    url: 'https://lozenets.sofia.bg',
    category: 'government',
    scraper: 'lozenets.js',
    districtSpecific: true,
  },
];

// The citywide utility/municipality sources every Sofia district shares.
const CITYWIDE_SOURCES = [
  'sofiyska-voda', 'toplofikacia', 'erm-zapad',
  'sofia-traffic', 'sofia-municipality', 'sofia-council',
];

export const DISTRICTS = [
  {
    id: 'oborishte',
    name: 'Оборище',
    slug: 'oborishte',
    nameEn: 'Oborishte',
    outputDir: '',                       // Оборище keeps the site root — its URLs must not change
    coords: { lat: 42.702, lon: 23.336 },
    // bbox for geo-filtering power outages (from kvartalami-new-sources.md)
    bbox: { latMin: 42.695, latMax: 42.712, lonMin: 23.330, lonMax: 23.352 },
    // Neighborhood + boundary-street names citywide notices use to name Оборище
    keywords: [
      'Оборище', 'район Оборище', 'р-н Оборище', 'кв. Оборище', 'ул. Оборище',
      'бул. Дондуков', 'бул. Васил Левски', 'ул. Шипка', 'ул. Раковски',
      'ул. Цар Освободител', 'Докторска градина', 'Борисова градина', 'Орлов мост',
    ],
    sources: [...CITYWIDE_SOURCES, 'rayon-oborishte'],
    // Public Telegram channel notify.mjs posts to (bot must be channel admin).
    telegram: '@kvartalami_oborishte',
    kazva: {
      districtTopic: 'kvartalami-oborishte',
      categoryTopics: {
        repairs: 'kvartalami-oborishte-voda',
        government: 'kvartalami-oborishte-obshtina',
      },
    },
  },
  {
    id: 'lozenets',
    name: 'Лозенец',
    slug: 'lozenets',
    nameEn: 'Lozenets',
    outputDir: 'lozenets',               // builds to site/lozenets/
    coords: { lat: 42.667, lon: 23.322 },  // chosen district centroid (Хладилника area) — no coord in spec
    bbox: { latMin: 42.620, latMax: 42.685, lonMin: 23.300, lonMax: 23.345 },
    // Neighborhoods + boundary/interior streets from kvartalami-lozenets-sources.md.
    // 'Витоша' deliberately dropped: it matches район Витоша + the mountain (spec caution).
    keywords: [
      'Лозенец', 'Хладилника', 'Кръстова вада', 'Зоопарк',
      'Арсеналски', 'Евлоги Георгиев', 'Драган Цанков', 'Пейо Яворов', 'Симеоновско шосе',
      'Черни връх', 'Козяк', 'Флора Кънева', 'Кожухарска', 'Крум Попов',
      'Богатица', 'Златовръх', 'Сребърна',
    ],
    sources: [...CITYWIDE_SOURCES, 'rayon-lozenets'],
    telegram: '@kvartalami_lozenets',
    kazva: {
      districtTopic: 'kvartalami-lozenets',
      categoryTopics: {
        repairs: 'kvartalami-lozenets-voda',
        government: 'kvartalami-lozenets-obshtina',
      },
    },
  },
];

export const LLM = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',  // 2.0-flash was retired; every call 404'd silently for weeks
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  maxTokens: 200,
  prompt: 'Обобщи следната новина в 2-3 кратки изречения на български. Бъди фактологичен и конкретен:\n\n',
};

export const SITE = {
  title: 'КВАРТАЛАМИ.bg',
  subtitle: 'Хипер-локални новини за София',
  description: 'Ежедневен преглед на хипер-локалните новини за софийските квартали Оборище и Лозенец — ремонти, водни, топлинни и електро аварии, промени в движението, решения на местната власт и събития. Автоматично събиране от официални източници.',
  url: 'https://kvartalami.com',
  locale: 'bg_BG',
  language: 'bg-BG',
  archiveDays: 90,
};
