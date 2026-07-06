import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { PATHS, CATEGORIES, DISTRICT, SITE, SOURCES, LLM } from './config.js';

// --- Helpers ---

function readArticles() {
  if (!existsSync(PATHS.articles)) return [];
  const files = readdirSync(PATHS.articles).filter(f => f.endsWith('.json'));
  const articles = [];
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(PATHS.articles, file), 'utf8'));
      if (Array.isArray(data)) {
        articles.push(...data);
      } else {
        articles.push(data);
      }
    } catch {
      console.warn(`Skipping invalid JSON: ${file}`);
    }
  }
  return articles;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
}

function toDateKey(dateStr) {
  const d = new Date(dateStr);
  return d.toISOString().slice(0, 10);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function truncate(text, max = 200) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function groupByCategory(articles) {
  const groups = {};
  for (const key of Object.keys(CATEGORIES)) {
    groups[key] = [];
  }
  for (const a of articles) {
    const cat = a.category && groups[a.category] ? a.category : 'other';
    groups[cat].push(a);
  }
  return groups;
}

function groupByDate(articles) {
  const groups = {};
  for (const a of articles) {
    const key = toDateKey(a.date || a.fetchedAt || new Date().toISOString());
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  }
  return groups;
}

// --- HTML Templates ---

// Pull street/boulevard/complex names out of a notice so readers can filter
// by their own street („Моята улица"). Regex-level extraction — good enough
// for official outage notices, which name streets in a standard way.
function extractStreets(a) {
  const text = `${a.title || ''} ${a.content || ''} ${a.summary || ''}`;
  const found = new Set();
  const re = /(?:ул\.|бул\.|ж\.к\.|пл\.|кв\.)\s*[„"']?([А-Я][А-Яа-я0-9 .\-]{2,40}?)[„"']?(?=\s*(?:[,;:.!?)\n№]|срещу|между|до |от |и |или|$))/g;
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1].trim().replace(/\s+/g, ' '));
  return [...found].slice(0, 12);
}

function articleCard(a) {
  const cat = CATEGORIES[a.category] || CATEGORIES.other;
  const summary = a.summary || truncate(a.content);
  const source = a.sourceName || a.source || '';
  const date = a.date ? formatDate(a.date) : '';
  const url = a.url || '#';
  const streets = extractStreets(a);
  const streetsAttr = streets.length
    ? ` data-streets="${streets.map(escapeHtml).join('|')}"` : '';

  return `      <article class="card"${streetsAttr}>
        <h3>${escapeHtml(a.title)}</h3>
        <p>${escapeHtml(summary)}</p>
        <div class="card-meta">
          <span class="source">${escapeHtml(source)}</span>
          <span class="date">${escapeHtml(date)}</span>
        </div>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="read-more">Прочети повече &rarr;</a>
      </article>`;
}

// kazva-inline: standing feedback topics per category (kazva.bg entity 423);
// the label becomes a tap target asking readers to rate that civic service
const KAZVA_CATEGORY_TOPICS = {
  repairs: 'kvartalami-oborishte-voda',
  government: 'kvartalami-oborishte-obshtina',
};

function categorySection(key, articles) {
  if (articles.length === 0) return '';
  const cat = CATEGORIES[key];
  const kazvaTopic = KAZVA_CATEGORY_TOPICS[key];
  const label = kazvaTopic
    ? `<span data-kazva="${kazvaTopic}">${escapeHtml(cat.label)}</span>`
    : escapeHtml(cat.label);
  return `    <section class="category-section">
      <h2>${cat.icon} ${label}</h2>
${articles.map(articleCard).join('\n')}
    </section>`;
}

function archiveLinks(dates, fromArchive = false) {
  if (dates.length === 0) return '';
  const prefix = fromArchive ? '.' : './archive';
  return `    <nav class="archive-nav">
      <h2>Архив</h2>
      <div class="archive-pills">
${dates.map(d => `        <a href="${prefix}/${d}.html" class="pill">${formatDateShort(d)}</a>`).join('\n')}
      </div>
    </nav>`;
}

function htmlPage({ title, bodyContent, isArchive = false, canonicalPath = '/', pageDescription, articleCount }) {
  const now = new Date().toLocaleString('bg-BG', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Use relative paths so pages work both as file:// and on CDN
  const base = isArchive ? '..' : '.';
  const homeLink = isArchive ? `\n      <a href="${base}/index.html" class="back-link">&larr; Към днешните новини</a>` : '';

  const fullTitle = `${title} — ${SITE.title}`;
  const description = pageDescription || SITE.description;
  const canonicalUrl = `${SITE.url}${canonicalPath}`;
  const ogImageUrl = `${SITE.url}/og.png`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': isArchive ? 'CollectionPage' : 'WebSite',
    name: fullTitle,
    url: canonicalUrl,
    description,
    inLanguage: SITE.language,
    isPartOf: { '@type': 'WebSite', name: SITE.title, url: SITE.url },
    publisher: {
      '@type': 'NewsMediaOrganization',
      name: SITE.title,
      url: SITE.url,
      areaServed: { '@type': 'AdministrativeArea', name: 'Район Оборище, София' },
    },
    ...(articleCount ? { numberOfItems: articleCount } : {}),
  };

  return `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="${SITE.locale}">
  <meta property="og:site_name" content="${escapeHtml(SITE.title)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${ogImageUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(fullTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${ogImageUrl}">
  <link rel="icon" href="${base}/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${base}/style.css">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE.title)} RSS" href="${SITE.url}/feed.xml">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <script>
    var _paq = window._paq = window._paq || [];
    _paq.push(["setTrackerUrl", "https://analytics.kazva.bg/matomo.php"]);
    _paq.push(["setSiteId", "22"]);
    _paq.push(["disableCookies"]);
    _paq.push(["enableHeartBeatTimer", 15]);
    _paq.push(["enableLinkTracking"]);
    _paq.push(["setDocumentTitle", document.domain + "/" + document.title]);
    _paq.push(["trackPageView"]);
    (function () { var s = document.createElement("script"); s.async = true; s.src = "https://analytics.kazva.bg/matomo.js"; document.head.appendChild(s); })();
  </script>
  <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml">\n</head>
<body>
  <header>
    <h1>${escapeHtml(SITE.title)}</h1>
    <p class="subtitle">Хипер-локални новини за <span data-kazva="kvartalami-oborishte">район Оборище</span></p>
    <p class="updated">Обновено: ${escapeHtml(now)}</p>${homeLink}
  </header>
  <main>
${bodyContent}
  </main>
  <footer>
    <p>Данните са от публични източници. ${escapeHtml(SITE.title)} &copy; ${new Date().getFullYear()}</p>
  </footer>
  <!-- kazva-inline: тапни маркирана фраза, за да дадеш мнение (dogfood pilot) -->
  <script async src="/kazva/v1.js" data-publisher="kvartalami" crossorigin="anonymous"></script>
  <script>
  // „Моята улица" — filter repair notices to the reader's street (localStorage only)
  (function () {
    try {
      var cards = Array.prototype.slice.call(document.querySelectorAll('.card[data-streets]'));
      if (!cards.length) return;
      var all = new Set();
      cards.forEach(function (c) { c.getAttribute('data-streets').split('|').forEach(function (s) { all.add(s); }); });
      var box = document.createElement('div');
      box.className = 'street-filter';
      box.innerHTML = '<label>Моята улица: <input list="kv-streets" placeholder="напр. Оборище" autocomplete="off"></label>'
        + '<datalist id="kv-streets">' + Array.from(all).sort().map(function (s) { return '<option value="' + s.replace(/"/g, '&quot;') + '">'; }).join('') + '</datalist>'
        + '<button type="button" class="street-clear" hidden>✕</button>';
      var main = document.querySelector('main');
      main.insertBefore(box, main.firstChild);
      var input = box.querySelector('input'), clear = box.querySelector('button');
      function apply(v) {
        v = (v || '').trim().toLowerCase();
        clear.hidden = !v;
        cards.forEach(function (c) {
          var hit = !v || c.getAttribute('data-streets').toLowerCase().indexOf(v) !== -1;
          c.classList.toggle('street-dim', !hit);
        });
      }
      input.addEventListener('input', function () { try { localStorage.setItem('kv:street', input.value); } catch (e) {} apply(input.value); });
      clear.addEventListener('click', function () { input.value = ''; try { localStorage.removeItem('kv:street'); } catch (e) {} apply(''); });
      var saved = null; try { saved = localStorage.getItem('kv:street'); } catch (e) {}
      if (saved) { input.value = saved; apply(saved); }
    } catch (e) { /* never break the page */ }
  })();
  </script>
</body>
</html>`;
}

// --- Build ---

function buildIndex(articles, archiveDates) {
  // Show articles from the last 30 days (neighborhood news is slower-paced than city news)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  let displayArticles = articles.filter(a => {
    const dk = toDateKey(a.date || a.fetchedAt || '');
    return dk >= cutoffKey;
  });

  // If nothing in 7 days, show whatever is most recent
  if (displayArticles.length === 0) {
    displayArticles = articles.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 20);
  }

  displayArticles.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  let bodyContent;
  if (displayArticles.length === 0) {
    bodyContent = `    <section class="empty-state">
      <p>Няма новини. Проверете отново по-късно.</p>
    </section>`;
  } else {
    const grouped = groupByCategory(displayArticles);
    const sections = Object.keys(CATEGORIES)
      .map(key => categorySection(key, grouped[key]))
      .filter(Boolean)
      .join('\n');
    bodyContent = sections;
  }

  // Кварталният пулс — reader-feedback aggregates from the kazva-inline topics
  bodyContent = pulseBox() + bodyContent;

  // Add last 7 days of archive links
  const recentDates = archiveDates.slice(0, 7);
  bodyContent += '\n' + archiveLinks(recentDates);

  const indexDescription = displayArticles.length
    ? `${displayArticles.length} актуални новини за район Оборище — ${displayArticles.slice(0, 3).map(a => truncate(a.title || '', 60)).filter(Boolean).join(' · ')}`.slice(0, 300)
    : SITE.description;
  const html = htmlPage({
    title: 'Новини за днес',
    bodyContent,
    canonicalPath: '/',
    pageDescription: indexDescription,
    articleCount: displayArticles.length,
  });
  mkdirSync(PATHS.site, { recursive: true });
  writeFileSync(join(PATHS.site, 'index.html'), html, 'utf8');
  console.log(`Built index.html (${displayArticles.length} articles)`);
}

function buildArchivePages(articles) {
  const grouped = groupByDate(articles);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SITE.archiveDays);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  // Only dates within archiveDays range, sorted newest first
  const dates = Object.keys(grouped)
    .filter(d => d >= cutoffKey)
    .sort((a, b) => b.localeCompare(a));

  mkdirSync(PATHS.archive, { recursive: true });

  let pagesBuilt = 0;
  for (const dateKey of dates) {
    const dayArticles = grouped[dateKey].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const byCategory = groupByCategory(dayArticles);
    const sections = Object.keys(CATEGORIES)
      .map(key => categorySection(key, byCategory[key]))
      .filter(Boolean)
      .join('\n');

    const bodyContent = sections || `    <section class="empty-state">
      <p>Няма новини за тази дата.</p>
    </section>`;

    const archiveDescription = `Новини за район Оборище от ${formatDate(dateKey)} — ${dayArticles.length} съобщения от Софийска вода, Топлофикация, Столична община и Район Оборище.`;
    const html = htmlPage({
      title: `Архив: ${formatDate(dateKey)}`,
      bodyContent,
      isArchive: true,
      canonicalPath: `/archive/${dateKey}.html`,
      pageDescription: archiveDescription,
      articleCount: dayArticles.length,
    });
    writeFileSync(join(PATHS.archive, `${dateKey}.html`), html, 'utf8');
    pagesBuilt++;
  }

  console.log(`Built ${pagesBuilt} archive pages`);
  return dates;
}

// --- robots.txt, sitemap.xml, llms.txt, llms-full.txt ---

function buildRobots() {
  const lines = [
    '# kvartalami.com — public local-news aggregator',
    '# All AI bots are welcome to read & cite our content.',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ChatGPT-User',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    `Sitemap: ${SITE.url}/sitemap.xml`,
    '',
  ];
  writeFileSync(join(PATHS.site, 'robots.txt'), lines.join('\n'), 'utf8');
  console.log('Built robots.txt');
}

function buildSitemap(archiveDates) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE.url}/`, lastmod: today, changefreq: 'hourly', priority: '1.0' },
    ...archiveDates.map(d => ({
      loc: `${SITE.url}/archive/${d}.html`,
      lastmod: d,
      changefreq: 'never',
      priority: '0.6',
    })),
  ];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(u =>
      `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    ),
    '</urlset>',
    '',
  ].join('\n');
  writeFileSync(join(PATHS.site, 'sitemap.xml'), xml, 'utf8');
  console.log(`Built sitemap.xml (${urls.length} urls)`);
}

function buildLlmsTxt(displayArticles, archiveDates) {
  const sources = SOURCES.map(s => `- ${s.name} (${s.url})`).join('\n');
  const cats = Object.entries(CATEGORIES).map(([k, v]) => `- ${v.label} (${k})`).join('\n');
  const recentArchive = archiveDates.slice(0, 14).map(d => `- ${SITE.url}/archive/${d}.html`).join('\n');
  const todayTitles = displayArticles.slice(0, 10).map(a => `- ${truncate(a.title || '', 120)}`).join('\n');

  const content = `# ${SITE.title}

> ${SITE.description}

## What this site is

${SITE.title} aggregates official local-government and utility announcements relevant to **${DISTRICT.name}** district in Sofia, Bulgaria. Updated three times daily (06:00, 12:00, 18:00 Sofia time) by an automated pipeline that scrapes named sources, summarizes each article via LLM in Bulgarian, and republishes the result.

The audience is residents of ${DISTRICT.name}. Content covers planned and unplanned utility outages (water, district heating), municipal decisions, council meetings, neighborhood events, and miscellaneous official notices.

## Language

All content is in Bulgarian (bg-BG). Source names retain their original Bulgarian spelling.

## Categories

${cats}

## Sources

${sources}

## Pages

- Home: ${SITE.url}/ — today's news, last 30 days
- Sitemap: ${SITE.url}/sitemap.xml
- Recent archive:
${recentArchive}

## Today's news headlines (${todayTitles ? displayArticles.length : 0} items)

${todayTitles || '(no recent news at the moment)'}

## Attribution

Each article links back to its original source. ${SITE.title} adds a Bulgarian-language summary generated by ${LLM.provider}/${LLM.model} and does not modify or reproduce the source text beyond fair-use excerpts.

## Operator

CNTS LTD (cnts.bg) — operator of multiple Bulgarian public-information sites including kazva.bg and cnts.bg.

## Bot policy

All AI crawlers (GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended) are explicitly allowed. See ${SITE.url}/robots.txt.
`;
  writeFileSync(join(PATHS.site, 'llms.txt'), content, 'utf8');
  console.log('Built llms.txt');
}

// --- Кварталният пулс (cached kazva aggregates; see scripts/kazva-pulse.mjs) ---

function pulseBox() {
  let pulse;
  try {
    pulse = JSON.parse(readFileSync(PATHS.articles.replace(/articles$/, 'kazva-pulse.json'), 'utf8'));
  } catch { return ''; }
  if (!pulse.topics || pulse.topics.length === 0) return '';

  const rows = pulse.topics.map(t => `      <div class="pulse-row">
        <span>${escapeHtml(t.label)}</span>
        <span class="pulse-score">${t.avg !== null ? t.avg + '/10' : `още няма достатъчно гласове (${t.votes})`}</span>
      </div>`).join('\n');

  return `    <section class="pulse">
      <h2>📊 Кварталният пулс</h2>
${rows}
      <p style="margin:8px 0 0;color:#888;font-size:0.8rem">Оценки от читатели чрез маркираните фрази на сайта.</p>
    </section>
`;
}

// --- RSS feed (the site had no subscription surface at all) ---

function buildRss(recent) {
  const items = recent.slice(0, 40).map(a => `    <item>
      <title>${escapeHtml(a.title || '')}</title>
      <link>${escapeHtml(a.url || SITE.url)}</link>
      <guid isPermaLink="false">${escapeHtml(a.id || a.url || '')}</guid>
      <pubDate>${new Date(a.date || a.fetchedAt || Date.now()).toUTCString()}</pubDate>
      <category>${escapeHtml((CATEGORIES[a.category] || CATEGORIES.other).label)}</category>
      <description>${escapeHtml(a.summary || truncate(a.content))}</description>
    </item>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(SITE.title)}</title>
    <link>${SITE.url}</link>
    <description>${escapeHtml(SITE.description)}</description>
    <language>bg</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
  writeFileSync(join(PATHS.site, 'feed.xml'), xml, 'utf8');
  console.log(`Built feed.xml (${Math.min(recent.length, 40)} items)`);
}

// --- Per-source pipeline health, published for monitoring ---

function publishHealth() {
  const src = PATHS.articles.replace(/articles$/, 'health.json');
  if (existsSync(src)) {
    writeFileSync(join(PATHS.site, 'health.json'), readFileSync(src, 'utf8'));
    console.log('Published health.json');
  }
}

// --- Main ---

const articles = readArticles();
console.log(`Loaded ${articles.length} articles`);

const archiveDates = buildArchivePages(articles);
buildIndex(articles, archiveDates);

// SEO + AI-discovery surfaces
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 30);
const cutoffKey = cutoff.toISOString().slice(0, 10);
const recentArticles = articles
  .filter(a => toDateKey(a.date || a.fetchedAt || '') >= cutoffKey)
  .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

buildRobots();
buildSitemap(archiveDates);
buildLlmsTxt(recentArticles, archiveDates);
buildRss(recentArticles);
publishHealth();
