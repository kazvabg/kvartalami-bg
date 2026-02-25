import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { PATHS, SOURCES, DISTRICT } from './config.js';

// Sources that are inherently district-specific (all their content is relevant)
// Only rayon-oborishte is fully district-specific. Utility sources cover all Sofia.
const DISTRICT_SOURCES = new Set(['rayon-oborishte']);

// Keywords that indicate district relevance for citywide sources
const DISTRICT_KEYWORDS = [
  DISTRICT.name,           // Оборище
  'район Оборище',
  'р-н Оборище',
  'кв. Оборище',
  'ул. Оборище',
  'бул. Дондуков',
  'бул. Васил Левски',
  'ул. Шипка',
  'ул. Раковски',
  'ул. Цар Освободител',
  'Докторска градина',
  'Борисова градина',
];

function isDistrictRelevant(article) {
  // District-specific sources are always relevant
  if (DISTRICT_SOURCES.has(article.source)) return true;

  // Check title and content for district keywords
  const text = `${article.title} ${article.content}`.toLowerCase();
  return DISTRICT_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

// Dynamic import of all scrapers
async function loadScrapers() {
  const scrapers = {};
  for (const source of SOURCES) {
    try {
      const mod = await import(`./scrapers/${source.scraper}`);
      scrapers[source.id] = mod.default;
    } catch (err) {
      console.error(`[scrape] Failed to load scraper ${source.scraper}:`, err.message);
    }
  }
  return scrapers;
}

function articleId(url) {
  return createHash('md5').update(url).digest('hex').slice(0, 12);
}

function loadSeen() {
  try {
    return JSON.parse(readFileSync(PATHS.seen, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSeen(seen) {
  writeFileSync(PATHS.seen, JSON.stringify(seen, null, 2));
}

function todayFile() {
  const date = new Date().toISOString().slice(0, 10);
  return `${PATHS.articles}/${date}.json`;
}

function loadDayArticles(filepath) {
  try {
    return JSON.parse(readFileSync(filepath, 'utf-8'));
  } catch {
    return [];
  }
}

async function main() {
  console.log('[scrape] Starting scrape run...');

  // Ensure directories exist
  mkdirSync(PATHS.articles, { recursive: true });

  const scrapers = await loadScrapers();
  const seen = loadSeen();

  // Run all scrapers in parallel
  const results = await Promise.allSettled(
    Object.entries(scrapers).map(async ([id, fn]) => {
      try {
        const articles = await fn();
        return { id, articles };
      } catch (err) {
        console.error(`[scrape] Scraper ${id} crashed:`, err.message);
        return { id, articles: [] };
      }
    })
  );

  // Build source name lookup from config
  const sourceNames = {};
  for (const s of SOURCES) sourceNames[s.id] = s.name;

  // Collect all new articles
  let newCount = 0;
  const newArticles = [];

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[scrape] Promise rejected:', result.reason);
      continue;
    }

    const { id, articles } = result.value;

    for (const article of articles) {
      const aid = articleId(article.url);
      if (seen[aid]) continue;

      // Filter: only keep district-relevant articles
      if (!isDistrictRelevant(article)) continue;

      seen[aid] = true;
      newArticles.push({
        ...article,
        id: aid,
        sourceName: sourceNames[article.source] || article.source,
        fetchedAt: new Date().toISOString(),
      });
      newCount++;
    }
  }

  // Save new articles to today's file
  if (newArticles.length > 0) {
    const filepath = todayFile();
    const existing = loadDayArticles(filepath);
    existing.push(...newArticles);
    writeFileSync(filepath, JSON.stringify(existing, null, 2));
    console.log(`[scrape] Saved ${newArticles.length} new articles to ${filepath}`);
  } else {
    console.log('[scrape] No new articles found');
  }

  // Update seen index
  saveSeen(seen);

  console.log(`[scrape] Done. ${newCount} new articles, ${Object.keys(seen).length} total seen.`);
}

main().catch((err) => {
  console.error('[scrape] Fatal error:', err);
  process.exit(1);
});
