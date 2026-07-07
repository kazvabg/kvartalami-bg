import * as cheerio from 'cheerio';

// Столична община publishes road repairs, events and ЦГМ route/stop
// reorganizations at /repairs-and-traffic-changes, exposed as a clean RSS feed.
// The RSS <description> is empty, so the body comes from each detail page's
// <meta name="description">. Citywide by nature — scrape.js keyword-filters per
// district. Returns 'transport' category items.
const RSS_URL = 'https://www.sofia.bg/bg/repairs-and-traffic-changes/-/asset_publisher/utdu/rss';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function headers() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'bg,en;q=0.5',
  };
}

// Detail pages carry a clean abstract in <meta name="description">. Best-effort:
// fall back to the title if the fetch fails or the tag is missing.
async function fetchBody(url) {
  try {
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return '';
    const $ = cheerio.load(await res.text());
    return ($('meta[name="description"]').attr('content') || '').trim();
  } catch {
    return '';
  }
}

export default async function scrape() {
  console.log('[sofia-traffic] Scraping', RSS_URL);

  try {
    const res = await fetch(RSS_URL, { headers: headers(), signal: AbortSignal.timeout(15_000) });

    if (!res.ok) {
      console.error(`[sofia-traffic] HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    const items = [];
    $('item').each((_, el) => {
      const $it = $(el);
      const title = $it.find('title').first().text().trim();
      const link = $it.find('link').first().text().trim();
      const pubDate = $it.find('pubDate').first().text().trim();
      if (!title || !link) return;
      items.push({ title, link, pubDate });
    });

    // Detail pages fetch in small batches: polite to sofia.bg, but bounded
    // wall-clock (20 sequential worst-case timeouts would brush the CI limit).
    const articles = [];
    const queue = items.slice(0, 20);
    for (let i = 0; i < queue.length; i += 5) {
      const batch = queue.slice(i, i + 5);
      const bodies = await Promise.all(batch.map(it => fetchBody(it.link)));
      batch.forEach((it, j) => {
        const parsed = Date.parse(it.pubDate);
        const date = Number.isFinite(parsed)
          ? new Date(parsed).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);

        articles.push({
          title: it.title.slice(0, 200),
          url: it.link,
          content: (bodies[j] ? `${it.title}. ${bodies[j]}` : it.title).slice(0, 2000),
          category: 'transport',
          date,
          source: 'sofia-traffic',
        });
      });
    }

    console.log(`[sofia-traffic] Found ${articles.length} items`);
    return articles;
  } catch (err) {
    console.error(`[sofia-traffic] Error: ${err.message}`);
    return [];
  }
}
