import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { PATHS, SOURCES, DISTRICTS, LEGACY_DISTRICT } from './config.js';

const SOURCE_BY_ID = Object.fromEntries(SOURCES.map(s => [s.id, s]));

// Is an article relevant to a district?
// - district-specific sources (район sites) publish only their own content
// - geo-sources (e.g. ЕРМ Запад) pre-compute an `article.districts` list
// - everything else is a citywide source → match the district's keyword list
function isRelevant(article, district) {
  const src = SOURCE_BY_ID[article.source];
  if (src && src.districtSpecific) return true;
  if (Array.isArray(article.districts)) return article.districts.includes(district.id);

  const text = `${article.title} ${article.content}`.toLowerCase();
  return district.keywords.some(kw => text.includes(kw.toLowerCase()));
}

// Load every scraper referenced by any district, once.
async function loadScrapers() {
  const ids = new Set(DISTRICTS.flatMap(d => d.sources));
  const scrapers = {};
  for (const id of ids) {
    const source = SOURCE_BY_ID[id];
    if (!source) {
      console.error(`[scrape] Unknown source id ${id} referenced by a district`);
      continue;
    }
    try {
      const mod = await import(`./scrapers/${source.scraper}`);
      scrapers[id] = mod.default;
    } catch (err) {
      console.error(`[scrape] Failed to load scraper ${source.scraper}:`, err.message);
    }
  }
  return scrapers;
}

const HEALTH_PATH = PATHS.articles.replace(/articles$/, 'health.json');

// Legacy seen/health keys were bare (single-district era). Namespace them to
// the legacy district so multi-district keys (`x@district`) never collide.
function migrateKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k.includes('@') ? k : `${k}@${LEGACY_DISTRICT}`] = v;
  return out;
}

function loadHealth() {
  try { return migrateKeys(JSON.parse(readFileSync(HEALTH_PATH, 'utf-8'))); } catch { return {}; }
}

function saveHealth(health) {
  writeFileSync(HEALTH_PATH, JSON.stringify(health, null, 2));
}

function articleId(url) {
  return createHash('md5').update(url).digest('hex').slice(0, 12);
}

function loadSeen() {
  try {
    return migrateKeys(JSON.parse(readFileSync(PATHS.seen, 'utf-8')));
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

  // Run each unique scraper once (citywide sources feed multiple districts).
  const rawBySource = {};
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
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[scrape] Promise rejected:', result.reason);
      continue;
    }
    rawBySource[result.value.id] = result.value.articles;
  }

  const sourceNames = {};
  for (const s of SOURCES) sourceNames[s.id] = s.name;

  // Per-source-per-district health: makes silent rot visible (a scraper can
  // "succeed" while a district's keyword filter drops everything, or a site
  // changes its markup and yields 0 items — both looked like a quiet news day).
  const health = loadHealth();
  const runAt = new Date().toISOString();

  let newCount = 0;
  const newArticles = [];

  for (const district of DISTRICTS) {
    for (const sourceId of district.sources) {
      const articles = rawBySource[sourceId] || [];
      const hKey = `${sourceId}@${district.id}`;
      const h = health[hKey] = health[hKey] || {};
      h.lastRunAt = runAt;
      h.lastFetched = articles.length;
      if (articles.length > 0) h.lastNonEmptyAt = runAt;

      for (const article of articles) {
        if (!isRelevant(article, district)) continue;

        const key = `${articleId(article.url)}@${district.id}`;
        if (seen[key]) continue;

        seen[key] = true;
        h.lastSavedAt = runAt;
        newArticles.push({
          ...article,
          id: articleId(article.url),
          district: district.id,
          sourceName: sourceNames[article.source] || article.source,
          fetchedAt: new Date().toISOString(),
        });
        newCount++;
      }
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
  saveHealth(health);

  // WARN (not fail) when a source has fetched nothing for 14+ days — markup
  // drift and "genuinely quiet source" need a human eye to tell apart.
  const STALE_DAYS = 14;
  for (const [id, h] of Object.entries(health)) {
    const last = h.lastNonEmptyAt || 0;
    const staleDays = (Date.now() - new Date(last).getTime()) / 86400000;
    if (!h.lastNonEmptyAt || staleDays > STALE_DAYS)
      console.warn(`[scrape] WARN: source ${id} has fetched 0 items for ${h.lastNonEmptyAt ? Math.floor(staleDays) + ' days' : 'as long as tracked'} — check its scraper/selectors`);
  }

  console.log(`[scrape] Done. ${newCount} new articles, ${Object.keys(seen).length} total seen.`);
}

main().catch((err) => {
  console.error('[scrape] Fatal error:', err);
  process.exit(1);
});
