import * as cheerio from 'cheerio';

const SOURCE_URL = 'https://rayon-oborishte.bg';

export default async function scrape() {
  console.log('[rayon-oborishte] Scraping', SOURCE_URL);

  try {
    const res = await fetch(SOURCE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; kvartalami-bg/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'bg,en;q=0.5',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error(`[rayon-oborishte] HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const articles = [];

    // Primary selector: .widget-post-title a (news widget on homepage)
    // Fallback: .entry-title a (standard WordPress post titles)
    const selectors = ['.widget-post-title a', '.entry-title a'];

    for (const sel of selectors) {
      $(sel).each((_, el) => {
        const $a = $(el);
        const title = $a.text().trim();
        const href = $a.attr('href');
        if (!title || !href) return;

        const fullUrl = href.startsWith('http') ? href : `${SOURCE_URL}${href}`;

        // Look for date in .entry-meta sibling/parent
        const parent = $a.closest('article, div, li');
        const metaText = parent.find('.entry-meta').text().trim();
        const dm = metaText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : new Date().toISOString().slice(0, 10);

        // Get excerpt if available
        const excerpt = parent.find('.entry-content, .entry-summary, p').first().text().trim();

        articles.push({
          title: title.slice(0, 200),
          url: fullUrl,
          content: excerpt || title,
          category: 'government',
          date,
          source: 'rayon-oborishte',
        });
      });

      if (articles.length > 0) break;
    }

    const result = articles.slice(0, 20);
    console.log(`[rayon-oborishte] Found ${result.length} items`);
    return result;
  } catch (err) {
    console.error(`[rayon-oborishte] Error: ${err.message}`);
    return [];
  }
}
