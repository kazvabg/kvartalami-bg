import * as cheerio from 'cheerio';

// Район Лозенец runs WordPress (Total theme + WPBakery) and — unlike
// rayon-oborishte.bg — exposes a clean WP REST API that carries real dates
// (the homepage widget does not). We fetch posts newest-first and strip the
// WPBakery [vc_*] shortcodes the excerpt/content are wrapped in.
const API_URL = 'https://lozenets.sofia.bg/wp-json/wp/v2/posts?per_page=20&_fields=id,date,link,title,excerpt';

// Auto-categorize based on Bulgarian keywords (same rules as rayon-oborishte).
const CATEGORY_RULES = [
  { category: 'repairs', keywords: ['ремонт', 'авария', 'спиране', 'водоснабдяване', 'топлоснабдяване', 'асфалт', 'преасфалтиране', 'инфраструктура', 'благоустройство', 'сметосъбиране', 'отпадъци', 'контейнер', 'паркиране'] },
  { category: 'transport', keywords: ['движение', 'транспорт', 'спирка', 'автобус', 'трамвай', 'тролей', 'маршрут', 'ограничение на движението'] },
  { category: 'events', keywords: ['събитие', 'курс', 'изложба', 'концерт', 'фестивал', 'юбилей', 'честване', 'превенция', 'спорт', 'турнир', 'музей', 'библиотека', 'театър'] },
];

function detectCategory(title, content) {
  const text = `${title} ${content}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(kw => text.includes(kw.toLowerCase()))) return rule.category;
  }
  return 'government';
}

// Strip WPBakery shortcodes, then decode entities + drop tags via cheerio.
function clean(html) {
  const noShortcodes = (html || '').replace(/\[\/?vc[^\]]*\]/g, '');
  return cheerio.load(`<div>${noShortcodes}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

export default async function scrape() {
  console.log('[rayon-lozenets] Scraping', API_URL);

  try {
    const res = await fetch(API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; kvartalami-bg/1.0)',
        'Accept': 'application/json',
        'Accept-Language': 'bg,en;q=0.5',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error(`[rayon-lozenets] HTTP ${res.status}`);
      return [];
    }

    const posts = await res.json();
    if (!Array.isArray(posts)) {
      console.error('[rayon-lozenets] Unexpected response shape');
      return [];
    }

    const articles = [];
    for (const post of posts) {
      const title = clean(post.title?.rendered);
      const href = post.link;
      if (!title || !href) continue;

      // Заповед PDFs etc. have an empty excerpt after stripping — fall back to
      // the title, exactly like rayon-oborishte.js does.
      const content = clean(post.excerpt?.rendered) || title;
      const date = (post.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

      articles.push({
        title: title.slice(0, 200),
        url: href,
        content: content.slice(0, 2000),
        category: detectCategory(title, content),
        date,
        source: 'rayon-lozenets',
      });
    }

    console.log(`[rayon-lozenets] Found ${articles.length} items`);
    return articles.slice(0, 20);
  } catch (err) {
    console.error(`[rayon-lozenets] Error: ${err.message}`);
    return [];
  }
}
