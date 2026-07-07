// The /water-stops page embeds a GIS portal that used to render outage tables
// server-side. The portal is now a Dojo/ArcGIS SPA shell (verified 2026-07-07:
// the old table.tableWaterStopInfo markup no longer exists — this scraper had
// fetched 0 items ever per health.json). The data lives in an ArcGIS REST
// service the app queries; we hit it directly. A Referer from the app origin
// is required — without it the server answers 403.
const APP_URL = 'https://gispx.sofiyskavoda.bg/WebApp.InfoCenter/';
const SITE_URL = 'https://www.sofiyskavoda.bg/water-stops';
const SERVICE_URL = 'https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer';

// Layer + definition expression pairs come from the app's js/config.js:
// layer 2 = „Текущи спирания" (In Progress), layer 3 = „Планирани спирания" (Confirmed).
const LAYERS = [
  { layer: 2, where: "ACTIVESTATUS = 'In Progress'" },
  { layer: 3, where: "ACTIVESTATUS = 'Confirmed'" },
];

// Epoch millis → dd.mm.yyyy in Sofia local time (matches the app's display).
function fmtDate(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia' });
}

// Epoch millis → ISO yyyy-mm-dd for the article date field.
function isoDate(ms) {
  if (!Number.isFinite(ms)) return new Date().toISOString().slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

async function queryLayer({ layer, where }) {
  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });
  const res = await fetch(`${SERVICE_URL}/${layer}/query?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': APP_URL,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error(`[sofiyska-voda] Layer ${layer} HTTP ${res.status}`);
    return [];
  }
  const data = await res.json();
  if (data.error) {
    console.error(`[sofiyska-voda] Layer ${layer} error: ${data.error.message || data.error.code}`);
    return [];
  }
  return data.features || [];
}

export default async function scrape() {
  console.log('[sofiyska-voda] Querying ArcGIS layers', LAYERS.map(l => l.layer).join('+'));

  try {
    const articles = [];
    for (const layerDef of LAYERS) {
      const features = await queryLayer(layerDef);
      console.log(`[sofiyska-voda] Layer ${layerDef.layer}: ${features.length} raw entries`);

      for (const f of features) {
        const a = f.attributes || {};
        const location = (a.LOCATION || '').trim();
        const type = (a.ALERTTYPE || '').trim();
        const description = (a.DESCRIPTION || '').trim();
        const alertId = (a.ALERTID || '').trim();
        if (!location && !description) continue;

        const start = `${fmtDate(a.START_)}${a.START_H ? `, ${a.START_H}:${a.START_M || '00'} ч.` : ''}`;
        const end = `${fmtDate(a.ALERTEND)}${a.END_H ? `, ${a.END_H}:${a.END_M || '00'} ч.` : ''}`;

        const title = type
          ? `${type}: ${location}`.slice(0, 120)
          : location.slice(0, 120) || 'Спиране на водата';

        const content = [
          location && `Местоположение: ${location}`,
          type && `Тип: ${type}`,
          description && `Описание: ${description}`,
          start.trim() && `Начало: ${start}`,
          end.trim() && `Край: ${end}`,
        ].filter(Boolean).join('\n');

        // Returns every Sofia outage — scrape.js filters per district by keyword.
        // The ALERTID fragment gives each outage a unique, stable URL for dedup.
        articles.push({
          title,
          url: `${SITE_URL}#${encodeURIComponent(alertId || location || title)}`,
          content: content.slice(0, 2000),
          category: 'repairs',
          date: isoDate(a.START_),
          source: 'sofiyska-voda',
        });
      }
    }

    if (articles.length === 0) {
      console.log('[sofiyska-voda] No current or planned outages');
    } else {
      console.log(`[sofiyska-voda] Found ${articles.length} entries`);
    }
    return articles;
  } catch (err) {
    console.error(`[sofiyska-voda] Error: ${err.message}`);
    return [];
  }
}
