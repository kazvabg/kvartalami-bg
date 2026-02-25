import * as cheerio from 'cheerio';

const SOURCE_URL = 'https://www.sofia.bg/news';

export default async function scrape() {
  console.log('[sofia-municipality] Scraping', SOURCE_URL);

  try {
    // sofia.bg returns 403 unless User-Agent looks like a real browser
    const res = await fetch(SOURCE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'bg,en;q=0.5',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error(`[sofia-municipality] HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const articles = [];
    const seen = new Set();

    // Liferay CMS: news links follow the pattern /w/NNNNNNN
    // Each link contains a <p> with the title and a date div
    $('a[href*="/w/"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      if (!href.match(/\/w\/\d+/)) return;

      // The link with the <p> element contains both date and title
      const p = $a.find('p');
      if (!p.length) return;

      const title = p.text().trim();
      if (!title || title.length < 10) return;

      const fullUrl = href.startsWith('http') ? href : `https://www.sofia.bg${href}`;

      // Deduplicate — each article appears in multiple <a> tags (image + text)
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);

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
        source: 'sofia-municipality',
      });
    });

    const result = articles.slice(0, 20);
    console.log(`[sofia-municipality] Found ${result.length} announcements`);
    return result;
  } catch (err) {
    console.error(`[sofia-municipality] Error: ${err.message}`);
    return [];
  }
}
