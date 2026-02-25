import * as cheerio from 'cheerio';
import { DISTRICT } from '../config.js';

// The /water-stops page is an SPA that embeds a GIS portal iframe.
// The GIS portal at gispx.sofiyskavoda.bg renders outage data in
// server-side HTML tables that we can parse with cheerio.
const GIS_URL = 'https://gispx.sofiyskavoda.bg/WebApp.InfoCenter/?a=0&tab=0';
const SITE_URL = 'https://www.sofiyskavoda.bg/water-stops';

export default async function scrape() {
  console.log('[sofiyska-voda] Scraping GIS portal');

  try {
    const res = await fetch(GIS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'bg,en;q=0.5',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error(`[sofiyska-voda] HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const articles = [];
    const district = DISTRICT.name;

    // Structure: table.tableWaterStopInfo > tr.trRowDefault > td.tdBottomRowSeperator
    // Each td contains <b>Label:</b> value<br> pairs:
    //   Местоположение, Тип, Описание, Начало, Край
    $('table.tableWaterStopInfo tr.trRowDefault').each((_, el) => {
      const td = $(el).find('td.tdBottomRowSeperator');
      if (!td.length) return;

      const text = td.text().trim();
      if (!text || !text.includes('Местоположение')) return;

      // Only keep entries mentioning the district
      if (!text.includes(district) && !text.includes('Оборище')) return;

      const inner = td.html() || '';
      const location = inner.match(/<b>Местоположение:<\/b>\s*(.*?)(?:<br>|$)/i)?.[1]?.trim() || '';
      const type = inner.match(/<b>Тип:<\/b>\s*(.*?)(?:<br>|$)/i)?.[1]?.trim() || '';
      const description = inner.match(/<b>Описание:<\/b>\s*(.*?)(?:<br>|$)/i)?.[1]?.trim() || '';
      const startDate = inner.match(/<b>Начало:<\/b>\s*(.*?)(?:<br>|$)/i)?.[1]?.trim() || '';
      const endDate = inner.match(/<b>Край:<\/b>\s*(.*?)(?:<br>|$)/i)?.[1]?.trim() || '';

      const title = type
        ? `${type}: ${location}`.slice(0, 120)
        : location.slice(0, 120) || 'Спиране на водата';

      const content = [
        location && `Местоположение: ${location}`,
        type && `Тип: ${type}`,
        description && `Описание: ${description}`,
        startDate && `Начало: ${startDate}`,
        endDate && `Край: ${endDate}`,
      ].filter(Boolean).join('\n');

      articles.push({
        title,
        url: SITE_URL,
        content: content.slice(0, 2000),
        category: 'repairs',
        date: new Date().toISOString().slice(0, 10),
        source: 'sofiyska-voda',
      });
    });

    if (articles.length === 0) {
      console.log('[sofiyska-voda] No entries for district (may be no current outages)');
    } else {
      console.log(`[sofiyska-voda] Found ${articles.length} relevant entries`);
    }
    return articles;
  } catch (err) {
    console.error(`[sofiyska-voda] Error: ${err.message}`);
    return [];
  }
}
