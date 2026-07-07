import * as cheerio from 'cheerio';
import { DISTRICTS } from '../config.js';

// ЕРМ Запад (ex-ЧЕЗ Разпределение) is Sofia's grid operator — electrohold.bg
// (sales) does not publish outages. The listing page renders one <li> per
// община that currently has an event; the event details (incl. an affected-area
// polygon) come from a POST/JSON call the map uses. We geo-filter each polygon
// against the district bboxes, so ЕРМ articles carry a pre-computed `districts`.
const LISTING_URL = 'https://info.ermzapad.bg/webint/vok/avplan.php?PLAN=FYI';
const DATA_URL = 'https://info.ermzapad.bg/webint/vok/avplan.php';
const HUMAN_URL = 'https://ermzapad.bg/bg/za-klienta/prekusvania/';

// Only poll a bounded number of общини per run — the server rejects bursts
// (its `tomuch` limit is ~100 requests). The listing only lists общини that
// currently have events, so this is normally a handful.
const MAX_OBSTINI = 15;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function inBbox(lat, lon, b) {
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

// Which of our districts does this event touch? Test the event centroid plus
// every polygon point against each district's bbox.
function matchDistricts(event) {
  const coords = [];
  const elat = parseFloat(event.lat), elon = parseFloat(event.lon);
  if (Number.isFinite(elat) && Number.isFinite(elon)) coords.push([elat, elon]);
  for (const p of Object.values(event.points || {})) {
    const plat = parseFloat(p.lat), plon = parseFloat(p.lon);
    if (Number.isFinite(plat) && Number.isFinite(plon)) coords.push([plat, plon]);
  }
  const hits = [];
  for (const d of DISTRICTS) {
    if (coords.some(([la, lo]) => inBbox(la, lo, d.bbox))) hits.push(d.id);
  }
  return hits;
}

// begin_event `06.07.2026 15:30` → ISO date `2026-07-06`
function parseDate(s) {
  const m = (s || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : new Date().toISOString().slice(0, 10);
}

async function drawObstina(code) {
  const res = await fetch(DATA_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: `action=draw&gm_obstina=${encodeURIComponent(code)}&lat=&lon=`,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return {};
  // Response is UTF-8 with a BOM; the server returns a `tomuch` string when
  // rate-limited instead of JSON — bail out cleanly in both cases.
  const text = (await res.text()).replace(/^﻿/, '').trim();
  if (!text.startsWith('{')) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

export default async function scrape() {
  console.log('[erm-zapad] Scraping', LISTING_URL);

  try {
    const res = await fetch(LISTING_URL, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'bg,en;q=0.5',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error(`[erm-zapad] HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Each active община renders as <li onclick="show_obstina('CODE','REGION')">.
    // The listing only lists общини with active events, so it is usually short.
    const obstini = [];
    const seenCodes = new Set();
    $('li[onclick^="show_obstina"]').each((_, el) => {
      const onclick = $(el).attr('onclick') || '';
      const m = onclick.match(/show_obstina\('([^']+)','([^']+)'\)/);
      if (!m) return;
      const code = m[1];
      if (seenCodes.has(code)) return;
      seenCodes.add(code);
      obstini.push(code);
    });

    if (obstini.length === 0) {
      console.log('[erm-zapad] No общини with active outages');
      return [];
    }

    const articles = [];
    for (const code of obstini.slice(0, MAX_OBSTINI)) {
      const events = await drawObstina(code);
      for (const event of Object.values(events)) {
        if (!event || typeof event !== 'object') continue;
        const districts = matchDistricts(event);
        if (districts.length === 0) continue;  // outage is elsewhere in the grid

        const planned = event.typedist === 'планирано';
        const place = event.cities || event.city_name || 'София';
        const begin = event.begin_event || '';
        const end = event.end_event || '';

        const content = [
          `Тип: ${planned ? 'планово прекъсване' : 'аварийно прекъсване'}`,
          `Населено място: ${place}`,
          begin && `Начало: ${begin}`,
          end && `Очаквано възстановяване: ${end}`,
        ].filter(Boolean).join('\n');

        articles.push({
          title: `${planned ? 'Планово прекъсване на тока' : 'Авария по тока'}: ${place}`.slice(0, 120),
          // Fragment keeps the link on the real outages page while giving each
          // event a unique URL so dedup does not collapse them into one.
          url: `${HUMAN_URL}#${encodeURIComponent(`${code}|${begin}|${place}`)}`,
          content: content.slice(0, 2000),
          category: 'repairs',
          date: parseDate(begin),
          source: 'erm-zapad',
          districts,
        });
      }
    }

    console.log(`[erm-zapad] Found ${articles.length} district-relevant outages`);
    return articles;
  } catch (err) {
    console.error(`[erm-zapad] Error: ${err.message}`);
    return [];
  }
}
