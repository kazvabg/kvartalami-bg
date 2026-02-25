import * as cheerio from 'cheerio';

const SOURCE_URL = 'https://council.sofia.bg/';

export default async function scrape() {
  console.log('[sofia-council] Scraping', SOURCE_URL);

  try {
    // council.sofia.bg returns 403 unless User-Agent looks like a real browser
    const res = await fetch(SOURCE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'bg,en;q=0.5',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error(`[sofia-council] HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const articles = [];
    const seen = new Set();

    // Liferay CMS: news links use asset_publisher pattern
    // Each link contains a <p> with title and a date div with DD.MM.YYYY
    $('a[href*="asset_publisher"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';

      // Only links that have a <p> child (the title) — skip image-only links
      const p = $a.find('p');
      if (!p.length) return;

      const title = p.text().trim();
      if (!title || title.length < 10) return;

      const fullUrl = href.startsWith('http')
        ? href
        : `https://council.sofia.bg${href}`;

      // Deduplicate — each article appears as image link + text link
      if (seen.has(title)) return;
      seen.add(title);

      // Date is in a sibling div inside the same <a>, format: DD.MM.YYYY
      const dateText = $a.children().not('p').text().trim();
      let date = new Date().toISOString().slice(0, 10);
      const dm = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (dm) date = `${dm[3]}-${dm[2]}-${dm[1]}`;

      articles.push({
        title: title.slice(0, 200),
        url: fullUrl,
        content: title,
        category: 'government',
        date,
        source: 'sofia-council',
      });
    });

    console.log(`[sofia-council] Found ${articles.length} items`);
    return articles.slice(0, 15);
  } catch (err) {
    console.error(`[sofia-council] Error: ${err.message}`);
    return [];
  }
}
