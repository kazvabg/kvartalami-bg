import * as cheerio from 'cheerio';

const SOURCE_URL = 'https://toplo.bg/accidents-and-maintenance';

export default async function scrape() {
  console.log('[toplofikacia] Scraping', SOURCE_URL);

  try {
    const res = await fetch(SOURCE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'bg,en;q=0.5',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error(`[toplofikacia] HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const articles = [];

    // Primary: extract structured JSON data embedded in <script> tags.
    // Each accident has: AccidentId, Name, Addresses, Region, FromDate, UntilDate, Type
    const scriptText = $('script').toArray()
      .map(s => $(s).html())
      .find(t => t && t.includes('AccidentId'));

    if (scriptText) {
      const names = [...scriptText.matchAll(/"Name":\s*"([^"]+)"/g)].map(m => m[1]);
      const addresses = [...scriptText.matchAll(/"Addresses":\s*"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\"/g, '"'));
      const regions = [...scriptText.matchAll(/"Region":\s*"([^"]+)"/g)].map(m => m[1]);
      const fromDates = [...scriptText.matchAll(/"FromDate":\s*"([^"]+)"/g)].map(m => m[1]);
      const untilDates = [...scriptText.matchAll(/"UntilDate":\s*"([^"]+)"/g)].map(m => m[1]);

      for (let i = 0; i < names.length; i++) {
        const name = names[i] || '';
        const addr = addresses[i] || '';
        const region = regions[i] || '';
        const from = fromDates[i] || '';
        const until = untilDates[i] || '';

        const fromDate = from ? new Date(from) : null;
        const untilDate = until ? new Date(until) : null;
        const dateStr = fromDate ? fromDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

        const content = [
          `Район: ${name}`,
          addr && `Адреси: ${addr}`,
          fromDate && `Начало: ${fromDate.toLocaleString('bg-BG')}`,
          untilDate && `Очаквано възстановяване: ${untilDate.toLocaleString('bg-BG')}`,
        ].filter(Boolean).join('\n');

        articles.push({
          title: `Авария: ${name}`.slice(0, 120),
          url: SOURCE_URL,
          content: content.slice(0, 2000),
          category: 'repairs',
          date: dateStr,
          source: 'toplofikacia',
        });
      }
    }

    // Fallback: parse from DOM if script extraction yielded nothing
    if (articles.length === 0) {
      $('li.accident-container').each((_, el) => {
        const title = $(el).find('h2').text().trim();
        const dateText = $(el).find('.accident-date').text().trim();
        if (!title) return;

        articles.push({
          title: `Авария: ${title}`.slice(0, 120),
          url: SOURCE_URL,
          content: `${title}. ${dateText}`,
          category: 'repairs',
          date: new Date().toISOString().slice(0, 10),
          source: 'toplofikacia',
        });
      });
    }

    console.log(`[toplofikacia] Found ${articles.length} entries`);
    return articles;
  } catch (err) {
    console.error(`[toplofikacia] Error: ${err.message}`);
    return [];
  }
}
