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
  archive: join(ROOT, 'site', 'archive'),
};

export const DISTRICT = {
  name: 'Оборище',
  slug: 'oborishte',
  nameEn: 'Oborishte',
};

export const CATEGORIES = {
  repairs: { label: 'Ремонти', icon: '🔧' },
  government: { label: 'Местна власт', icon: '🏛️' },
  events: { label: 'Събития', icon: '📅' },
  other: { label: 'Други', icon: '📌' },
};

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
  },
];

export const LLM = {
  provider: 'gemini',
  model: 'gemini-2.0-flash',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  maxTokens: 200,
  prompt: 'Обобщи следната новина в 2-3 кратки изречения на български. Бъди фактологичен и конкретен:\n\n',
};

export const SITE = {
  title: 'КВАРТАЛАМИ.bg',
  subtitle: 'Хипер-локални новини за район Оборище',
  archiveDays: 90,
};
