import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { PATHS, CATEGORIES, DISTRICT, SITE } from './config.js';

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

function articleCard(a) {
  const cat = CATEGORIES[a.category] || CATEGORIES.other;
  const summary = a.summary || truncate(a.content);
  const source = a.sourceName || a.source || '';
  const date = a.date ? formatDate(a.date) : '';
  const url = a.url || '#';

  return `      <article class="card">
        <h3>${escapeHtml(a.title)}</h3>
        <p>${escapeHtml(summary)}</p>
        <div class="card-meta">
          <span class="source">${escapeHtml(source)}</span>
          <span class="date">${escapeHtml(date)}</span>
        </div>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="read-more">Прочети повече &rarr;</a>
      </article>`;
}

function categorySection(key, articles) {
  if (articles.length === 0) return '';
  const cat = CATEGORIES[key];
  return `    <section class="category-section">
      <h2>${cat.icon} ${escapeHtml(cat.label)}</h2>
${articles.map(articleCard).join('\n')}
    </section>`;
}

function archiveLinks(dates) {
  if (dates.length === 0) return '';
  return `    <nav class="archive-nav">
      <h2>Архив</h2>
      <div class="archive-pills">
${dates.map(d => `        <a href="/archive/${d}.html" class="pill">${formatDateShort(d)}</a>`).join('\n')}
      </div>
    </nav>`;
}

function htmlPage({ title, bodyContent, isArchive = false }) {
  const now = new Date().toLocaleString('bg-BG', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const homeLink = isArchive ? `\n      <a href="/" class="back-link">&larr; Към днешните новини</a>` : '';

  return `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${escapeHtml(SITE.title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1>${escapeHtml(SITE.title)}</h1>
    <p class="subtitle">${escapeHtml(SITE.subtitle)}</p>
    <p class="updated">Обновено: ${escapeHtml(now)}</p>${homeLink}
  </header>
  <main>
${bodyContent}
  </main>
  <footer>
    <p>Данните са от публични източници. ${escapeHtml(SITE.title)} &copy; ${new Date().getFullYear()}</p>
  </footer>
</body>
</html>`;
}

// --- Build ---

function buildIndex(articles, archiveDates) {
  const today = todayKey();
  let displayArticles = articles.filter(a => toDateKey(a.date || a.fetchedAt || '') === today);

  // If no articles today, show the most recent day's articles
  if (displayArticles.length === 0 && archiveDates.length > 0) {
    const latestDate = archiveDates[0];
    displayArticles = articles.filter(a => toDateKey(a.date || a.fetchedAt || '') === latestDate);
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

  // Add last 7 days of archive links
  const recentDates = archiveDates.slice(0, 7);
  bodyContent += '\n' + archiveLinks(recentDates);

  const html = htmlPage({ title: 'Новини за днес', bodyContent });
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

    const html = htmlPage({
      title: `Архив: ${formatDate(dateKey)}`,
      bodyContent,
      isArchive: true,
    });
    writeFileSync(join(PATHS.archive, `${dateKey}.html`), html, 'utf8');
    pagesBuilt++;
  }

  console.log(`Built ${pagesBuilt} archive pages`);
  return dates;
}

// --- Main ---

const articles = readArticles();
console.log(`Loaded ${articles.length} articles`);

const archiveDates = buildArchivePages(articles);
buildIndex(articles, archiveDates);
