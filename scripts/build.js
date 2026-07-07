import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { PATHS, CATEGORIES, DISTRICTS, LEGACY_DISTRICT, SITE, SOURCES, LLM } from './config.js';

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

// Articles predating the multi-district refactor have no `district` field and
// all belonged to Оборище.
function articleDistrict(a) {
  return a.district || LEGACY_DISTRICT;
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

// Last-30-days window, newest first — the index + SEO surfaces use this.
function recentArticles(articles) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  return articles
    .filter(a => toDateKey(a.date || a.fetchedAt || '') >= cutoffKey)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

// --- Per-district path/URL helpers ---

function districtSiteDir(d) {
  return d.outputDir ? join(PATHS.site, d.outputDir) : PATHS.site;
}

function districtArchiveDir(d) {
  return join(districtSiteDir(d), 'archive');
}

function districtBaseUrl(d) {
  return d.outputDir ? `${SITE.url}/${d.outputDir}` : SITE.url;
}

function districtFeedPath(d) {
  return d.outputDir ? `${d.outputDir}/feed.xml` : 'feed.xml';
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
// the label becomes a tap target asking readers to rate that civic service.
// Only districts whose kazva topics exist carry the tags (see config.DISTRICTS).
function categorySection(key, articles, district) {
  if (articles.length === 0) return '';
  const cat = CATEGORIES[key];
  const kazvaTopic = district.kazva?.categoryTopics?.[key];
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

// Cross-link the districts in the header. Links are relative to the page's
// depth below the site root so they work as file:// and on the CDN.
function districtNav(district, base) {
  const links = DISTRICTS.map(d => {
    const href = `${base}/${d.outputDir ? d.outputDir + '/' : ''}index.html`;
    return d.id === district.id
      ? `<span class="district-nav-current">${escapeHtml(d.name)}</span>`
      : `<a href="${href}">${escapeHtml(d.name)}</a>`;
  });
  return `    <nav class="district-nav">${links.join(' · ')}</nav>`;
}

function htmlPage({ district, title, bodyContent, isArchive = false, canonicalPath = '/', pageDescription, articleCount, airLine }) {
  const now = new Date().toLocaleString('bg-BG', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Depth below the site root → relative path to shared assets (style.css etc.)
  // Оборище index: 0 · Оборище archive / Лозенец index: 1 · Лозенец archive: 2
  const depth = (district.outputDir ? 1 : 0) + (isArchive ? 1 : 0);
  const base = depth === 0 ? '.' : Array(depth).fill('..').join('/');
  // Archive pages sit exactly one level below their district's index.
  const homeLink = isArchive ? `\n      <a href="../index.html" class="back-link">&larr; Към днешните новини</a>` : '';

  const fullTitle = `${title} — ${SITE.title}`;
  const description = pageDescription || SITE.description;
  const canonicalUrl = `${SITE.url}${canonicalPath}`;
  const ogImageUrl = `${SITE.url}/og.png`;
  const feedUrl = `${SITE.url}/${districtFeedPath(district)}`;

  // kazva-inline: the district phrase is a tap target only where its topic exists.
  const subtitleTarget = district.kazva?.districtTopic
    ? `<span data-kazva="${district.kazva.districtTopic}">район ${escapeHtml(district.name)}</span>`
    : `район ${escapeHtml(district.name)}`;

  const airHtml = airLine ? `\n    <p class="air">${escapeHtml(airLine)}</p>` : '';

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
      areaServed: { '@type': 'AdministrativeArea', name: `Район ${district.name}, София` },
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
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE.title)} RSS" href="${feedUrl}">
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
</head>
<body>
  <header>
    <h1>${escapeHtml(SITE.title)}</h1>
    <p class="subtitle">Хипер-локални новини за ${subtitleTarget}</p>
${districtNav(district, base)}
    <p class="updated">Обновено: ${escapeHtml(now)}</p>${airHtml}${homeLink}
  </header>
  <main>
${bodyContent}
  </main>
  <footer>
    <p>Данните са от публични източници. ${escapeHtml(SITE.title)} &copy; ${new Date().getFullYear()}</p>
  </footer>
  <!-- kazva-inline: тапни маркирана фраза, за да дадеш мнение (dogfood pilot).
       Лозенец: TODO create kvartalami-lozenets* topics via kazva-topic-manager,
       then set kazva.* in config so the header/category phrases get data-kazva tags. -->
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

// --- Build (per district) ---

function buildDistrictIndex(district, articles, archiveDates) {
  // Show articles from the last 30 days (neighborhood news is slower-paced than city news)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  let displayArticles = articles.filter(a => {
    const dk = toDateKey(a.date || a.fetchedAt || '');
    return dk >= cutoffKey;
  });

  // If nothing in 30 days, show whatever is most recent
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
      .map(key => categorySection(key, grouped[key], district))
      .filter(Boolean)
      .join('\n');
    bodyContent = sections;
  }

  // Кварталният пулс — reader-feedback aggregates (only where kazva topics exist)
  if (district.kazva) bodyContent = pulseBox() + bodyContent;

  // Add last 7 days of archive links
  const recentDates = archiveDates.slice(0, 7);
  bodyContent += '\n' + archiveLinks(recentDates);

  const indexDescription = displayArticles.length
    ? `${displayArticles.length} актуални новини за район ${district.name} — ${displayArticles.slice(0, 3).map(a => truncate(a.title || '', 60)).filter(Boolean).join(' · ')}`.slice(0, 300)
    : SITE.description;
  const html = htmlPage({
    district,
    title: `Новини за днес — район ${district.name}`,
    bodyContent,
    canonicalPath: district.outputDir ? `/${district.outputDir}/` : '/',
    pageDescription: indexDescription,
    articleCount: displayArticles.length,
    airLine: readAirLine(district.id),
  });
  const dir = districtSiteDir(district);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  console.log(`Built ${district.id} index.html (${displayArticles.length} articles)`);
}

function buildDistrictArchive(district, articles) {
  const grouped = groupByDate(articles);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SITE.archiveDays);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  // Only dates within archiveDays range, sorted newest first
  const dates = Object.keys(grouped)
    .filter(d => d >= cutoffKey)
    .sort((a, b) => b.localeCompare(a));

  const archiveDir = districtArchiveDir(district);
  mkdirSync(archiveDir, { recursive: true });

  let pagesBuilt = 0;
  for (const dateKey of dates) {
    const dayArticles = grouped[dateKey].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const byCategory = groupByCategory(dayArticles);
    const sections = Object.keys(CATEGORIES)
      .map(key => categorySection(key, byCategory[key], district))
      .filter(Boolean)
      .join('\n');

    const bodyContent = sections || `    <section class="empty-state">
      <p>Няма новини за тази дата.</p>
    </section>`;

    const archiveDescription = `Новини за район ${district.name} от ${formatDate(dateKey)} — ${dayArticles.length} съобщения от официални източници.`;
    const html = htmlPage({
      district,
      title: `Архив: ${formatDate(dateKey)}`,
      bodyContent,
      isArchive: true,
      canonicalPath: `${district.outputDir ? '/' + district.outputDir : ''}/archive/${dateKey}.html`,
      pageDescription: archiveDescription,
      articleCount: dayArticles.length,
    });
    writeFileSync(join(archiveDir, `${dateKey}.html`), html, 'utf8');
    pagesBuilt++;
  }

  console.log(`Built ${pagesBuilt} archive pages for ${district.id}`);
  return dates;
}

// --- robots.txt, sitemap.xml, llms.txt (site-wide) ---

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

function buildSitemap(perDistrict) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [];
  for (const { district, archiveDates } of perDistrict) {
    const home = district.outputDir ? `${SITE.url}/${district.outputDir}/` : `${SITE.url}/`;
    urls.push({ loc: home, lastmod: today, changefreq: 'hourly', priority: district.outputDir ? '0.9' : '1.0' });
    for (const d of archiveDates) {
      urls.push({
        loc: `${districtBaseUrl(district)}/archive/${d}.html`,
        lastmod: d,
        changefreq: 'never',
        priority: '0.6',
      });
    }
  }
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

function buildLlmsTxt(perDistrict) {
  const sources = SOURCES.map(s => `- ${s.name} (${s.url})`).join('\n');
  const cats = Object.entries(CATEGORIES).map(([k, v]) => `- ${v.label} (${k})`).join('\n');
  const districtNames = DISTRICTS.map(d => d.name).join(' и ');

  const districtBlocks = perDistrict.map(({ district, recentArticles: recent, archiveDates }) => {
    const home = district.outputDir ? `${SITE.url}/${district.outputDir}/` : `${SITE.url}/`;
    const titles = recent.slice(0, 10).map(a => `- ${truncate(a.title || '', 120)}`).join('\n');
    const archive = archiveDates.slice(0, 10).map(d => `- ${districtBaseUrl(district)}/archive/${d}.html`).join('\n');
    return `### Район ${district.name}

- Home: ${home}
- Recent headlines (${recent.length} items in the last 30 days):
${titles || '(no recent news at the moment)'}
- Recent archive:
${archive || '(none)'}`;
  }).join('\n\n');

  const content = `# ${SITE.title}

> ${SITE.description}

## What this site is

${SITE.title} aggregates official local-government and utility announcements relevant to the Sofia districts **${districtNames}** in Bulgaria. Updated three times daily (06:00, 12:00, 18:00 Sofia time) by an automated pipeline that scrapes named sources, summarizes each article via LLM in Bulgarian, and republishes the result.

The audience is residents of these districts. Content covers planned and unplanned utility outages (water, district heating, power), traffic and public-transport changes, municipal decisions, council meetings, neighborhood events, and miscellaneous official notices.

## Language

All content is in Bulgarian (bg-BG). Source names retain their original Bulgarian spelling.

## Categories

${cats}

## Sources

${sources}

## Districts

${districtBlocks}

## Sitemap

${SITE.url}/sitemap.xml

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
    pulse = JSON.parse(readFileSync(join(PATHS.data, 'kazva-pulse.json'), 'utf8'));
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

// --- Air quality (cached; see scripts/air-quality.mjs) ---
// One-line status per district; hidden if missing or stale > 2h.
function readAirLine(districtId) {
  try {
    const air = JSON.parse(readFileSync(join(PATHS.data, `air-${districtId}.json`), 'utf8'));
    if (!air.updatedAt || !air.line) return null;
    if (Date.now() - new Date(air.updatedAt).getTime() > 2 * 3600 * 1000) return null;
    return air.line;
  } catch { return null; }
}

// --- RSS feed (per district) ---

function buildDistrictRss(district, recent) {
  const items = recent.slice(0, 40).map(a => `    <item>
      <title>${escapeHtml(a.title || '')}</title>
      <link>${escapeHtml(a.url || districtBaseUrl(district))}</link>
      <guid isPermaLink="false">${escapeHtml(a.id || a.url || '')}</guid>
      <pubDate>${new Date(a.date || a.fetchedAt || Date.now()).toUTCString()}</pubDate>
      <category>${escapeHtml((CATEGORIES[a.category] || CATEGORIES.other).label)}</category>
      <description>${escapeHtml(a.summary || truncate(a.content))}</description>
    </item>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(SITE.title)} — ${escapeHtml(district.name)}</title>
    <link>${districtBaseUrl(district)}</link>
    <description>Хипер-локални новини за район ${escapeHtml(district.name)}</description>
    <language>bg</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
  const dir = districtSiteDir(district);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'feed.xml'), xml, 'utf8');
  console.log(`Built ${district.id} feed.xml (${Math.min(recent.length, 40)} items)`);
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

const perDistrict = [];
for (const district of DISTRICTS) {
  const dArticles = articles.filter(a => articleDistrict(a) === district.id);
  const archiveDates = buildDistrictArchive(district, dArticles);
  buildDistrictIndex(district, dArticles, archiveDates);
  const recent = recentArticles(dArticles);
  buildDistrictRss(district, recent);
  perDistrict.push({ district, recentArticles: recent, archiveDates });
}

// SEO + AI-discovery surfaces (site-wide)
buildRobots();
buildSitemap(perDistrict);
buildLlmsTxt(perDistrict);
publishHealth();
