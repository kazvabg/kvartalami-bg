#!/usr/bin/env node
/**
 * Messenger distribution — post newly scraped articles to per-district
 * Telegram channels (spec: ~/Reports/kazva-inline/kvartalami-messenger-bot-SPEC.md).
 *
 * Reads data/outbox.json (written by scrape.js), posts up to 6 items per
 * district per run (repairs first), removes entries once posted everywhere,
 * drops entries older than 7 days. FAIL-OPEN by design: any channel/API error
 * logs, leaves the entry queued for the next run, and exits 0 — distribution
 * must never block publishing. No TELEGRAM_BOT_TOKEN ⇒ no-op, exit 0.
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { PATHS, DISTRICTS, CATEGORIES, SITE } from './config.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OUTBOX_PATH = join(PATHS.data, 'outbox.json');
const HEALTH_PATH = join(PATHS.data, 'health.json');
const MAX_PER_DISTRICT = 6;
const MAX_AGE_DAYS = 7;

function loadJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

// Load recent articles (outbox never holds anything older than 7 days).
function loadRecentArticles() {
  const byKey = {};
  let files = [];
  try { files = readdirSync(PATHS.articles).filter(f => f.endsWith('.json')).sort().slice(-9); } catch {}
  for (const f of files) {
    for (const a of loadJson(join(PATHS.articles, f), [])) {
      byKey[`${a.id}@${a.district || 'oborishte'}`] = a;
    }
  }
  return byKey;
}

// Same street extraction as build.js's „Моята улица" (kept in sync by hand —
// build.js runs its main at import time, so it can't be imported from here).
function extractStreets(a) {
  const text = `${a.title || ''} ${a.content || ''} ${a.summary || ''}`;
  const found = new Set();
  const re = /(?:ул\.|бул\.|ж\.к\.|пл\.|кв\.)\s*[„"']?([А-Я][А-Яа-я0-9 .\-]{2,40}?)[„"']?(?=\s*(?:[,;:.!?)\n№]|срещу|между|до |от |и |или|$))/g;
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1].trim().replace(/\s+/g, ' '));
  return [...found].slice(0, 5);
}

function truncate(text, max = 300) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

function formatPost(a, district) {
  const cat = CATEGORIES[a.category] || CATEGORIES.other;
  const path = district.outputDir ? `/${district.outputDir}/` : '/';
  const link = `${SITE.url}${path}?utm_source=telegram#a-${a.id}`;
  const streets = extractStreets(a);
  const lines = [
    `${cat.icon} ${a.title}`,
    truncate(a.summary || a.content),
  ];
  if (streets.length) lines.push(`Улици: ${streets.join(', ')}`);
  lines.push(`👉 ${link}`);
  return lines.filter(Boolean).join('\n');
}

async function sendTelegram(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`Telegram ${res.status}: ${body.description || 'unknown'}`);
}

async function main() {
  if (!TOKEN) {
    console.log('[notify] TELEGRAM_BOT_TOKEN not set — channel disabled, nothing to do');
    return;
  }

  let outbox = loadJson(OUTBOX_PATH, []);
  if (outbox.length === 0) {
    console.log('[notify] Outbox empty');
    return;
  }

  // Expire stale entries — week-old news is not a notification.
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const fresh = outbox.filter(e => new Date(e.addedAt || 0).getTime() >= cutoff);
  if (fresh.length < outbox.length) {
    console.log(`[notify] Dropped ${outbox.length - fresh.length} stale outbox entries (> ${MAX_AGE_DAYS}d)`);
  }
  outbox = fresh;

  const articles = loadRecentArticles();
  const districtById = Object.fromEntries(DISTRICTS.map(d => [d.id, d]));
  const health = loadJson(HEALTH_PATH, {});
  let postedCount = 0;

  for (const district of DISTRICTS) {
    if (!district.telegram) continue;

    const queue = outbox
      .filter(e => e.district === district.id && !e.posted?.telegram && articles[`${e.id}@${e.district}`])
      .sort((x, y) => {
        const xr = articles[`${x.id}@${x.district}`].category === 'repairs' ? 0 : 1;
        const yr = articles[`${y.id}@${y.district}`].category === 'repairs' ? 0 : 1;
        return xr - yr || new Date(x.addedAt) - new Date(y.addedAt);
      })
      .slice(0, MAX_PER_DISTRICT);

    for (const entry of queue) {
      const article = articles[`${entry.id}@${entry.district}`];
      try {
        await sendTelegram(district.telegram, formatPost(article, district));
        entry.posted = { ...entry.posted, telegram: true };
        postedCount++;
        const h = health[`telegram@${district.id}`] = health[`telegram@${district.id}`] || {};
        h.lastPostedAt = new Date().toISOString();
      } catch (err) {
        // Fail-open: leave queued for the next run (channel missing, bad token,
        // rate limit — all retryable or surfaced via stale lastPostedAt).
        console.error(`[notify] ${district.telegram}: ${err.message} — entry stays queued`);
        break; // same channel will fail for the rest of this run's queue too
      }
    }
  }

  // Keep entries not yet posted to every configured channel for their district;
  // unresolvable articles (rotated out of the last days' files) get dropped.
  const remaining = outbox.filter(e => {
    if (!articles[`${e.id}@${e.district}`]) return false;
    const d = districtById[e.district];
    if (!d || !d.telegram) return false; // no channel configured — nothing to wait for
    return !e.posted?.telegram;
  });

  writeFileSync(OUTBOX_PATH, JSON.stringify(remaining, null, 2));
  writeFileSync(HEALTH_PATH, JSON.stringify(health, null, 2));
  console.log(`[notify] Posted ${postedCount}, ${remaining.length} left in outbox`);
}

main().catch(err => {
  // Belt over the braces: notify must never fail the pipeline.
  console.error('[notify] Error (non-fatal):', err.message);
});
