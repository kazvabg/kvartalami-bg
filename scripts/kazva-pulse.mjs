#!/usr/bin/env node
/**
 * Refresh data/kazva-pulse.json — aggregate reader-feedback scores from the
 * kazva-inline topics embedded on the site (kazva.bg entity 423).
 *
 * Runs ONLY when METABASE_API_KEY is set (local/manual runs — the key stays
 * out of CI on purpose); the build renders whatever the cached JSON holds,
 * so CI never needs credentials. Votes stay hidden until a topic has >= 5.
 */
import { writeFileSync } from 'fs';

const KEY = process.env.METABASE_API_KEY;
if (!KEY) {
  console.log('[pulse] METABASE_API_KEY not set — keeping cached data/kazva-pulse.json');
  process.exit(0);
}

const SQL = `
SELECT t.slug, COUNT(r.id) AS votes,
       ROUND(AVG(r.rating_value) / 10.0, 1) AS avg_score
FROM topics t
JOIN x_entities_topics xet ON xet.topic_id = t.id
LEFT JOIN ratings r ON r.topic_id = t.numeric_id
WHERE xet.entity_id = 423 AND t.slug LIKE 'kvartalami-%'
GROUP BY t.slug`;

const res = await fetch('https://metabase.kazva.bg/api/dataset', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
  body: JSON.stringify({ database: 2, type: 'native', native: { query: SQL } })
});
const data = await res.json();
const rows = data.data?.rows ?? [];

const LABELS = {
  'kvartalami-oborishte': 'Животът в Оборище',
  'kvartalami-oborishte-voda': 'ВиК услуги',
  'kvartalami-oborishte-obshtina': 'Районна администрация',
};

const pulse = {
  updatedAt: new Date().toISOString(),
  topics: rows
    .filter(([slug]) => LABELS[slug])
    .map(([slug, votes, avg]) => ({
      slug, label: LABELS[slug],
      votes: Number(votes),
      avg: votes >= 5 ? Number(avg) : null,
    })),
};

writeFileSync('data/kazva-pulse.json', JSON.stringify(pulse, null, 2));
console.log('[pulse]', JSON.stringify(pulse.topics));
