#!/usr/bin/env node
/**
 * Refresh data/air-{district}.json — a one-line air-quality status per district
 * from sensor.community (keyless luftdaten network, ~5-min freshness).
 *
 * Runs in CI before every build (keyless API — unlike kazva-pulse.mjs, which
 * needs credentials and stays local). The build renders whatever cached JSON
 * exists and hides the line if the file is missing or older than 2h, so a
 * sensor.community outage degrades gracefully. Manual run: `npm run air`.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PATHS, DISTRICTS } from './config.js';

// Bands (worse pollutant wins). PM2.5: ≤15 добър · 15–35 умерен · >35 лош.
//                              PM10:  ≤40 добър · 40–75 умерен · >75 лош.
const ORDER = ['добър', 'умерен', 'лош'];
const band = (v, good, mid) => (v <= good ? 'добър' : v <= mid ? 'умерен' : 'лош');

function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function fetchDistrict(d) {
  const { lat, lon } = d.coords;
  const url = `https://data.sensor.community/airrohr/v1/filter/area=${lat},${lon},2`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'kvartalami-bg/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Skip indoor sensors and broken readings (outside 0–1000 µg/m³).
  const pm25 = [], pm10 = [];
  for (const r of data) {
    if (String(r.location?.indoor) === '1') continue;
    for (const v of r.sensordatavalues || []) {
      const val = parseFloat(v.value);
      if (!Number.isFinite(val) || val < 0 || val > 1000) continue;
      if (v.value_type === 'P2') pm25.push(val);
      if (v.value_type === 'P1') pm10.push(val);
    }
  }

  const m25 = median(pm25), m10 = median(pm10);
  if (m25 === null && m10 === null) return null;

  const r25 = m25 === null ? null : Math.round(m25 * 10) / 10;
  const r10 = m10 === null ? null : Math.round(m10 * 10) / 10;
  const bands = [
    r25 !== null && band(r25, 15, 35),
    r10 !== null && band(r10, 40, 75),
  ].filter(Boolean);
  const status = bands.sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0];

  const parts = [
    r25 !== null && `PM2.5 ${r25} µg/m³`,
    r10 !== null && `PM10 ${r10} µg/m³`,
  ].filter(Boolean).join(', ');

  return {
    updatedAt: new Date().toISOString(),
    status,
    pm25: r25,
    pm10: r10,
    sensors: { pm25: pm25.length, pm10: pm10.length },
    line: `Въздух: ${status} — ${parts}`,
  };
}

for (const d of DISTRICTS) {
  try {
    const air = await fetchDistrict(d);
    if (!air) {
      console.log(`[air] ${d.id}: no usable sensor readings — leaving cache as-is`);
      continue;
    }
    writeFileSync(join(PATHS.data, `air-${d.id}.json`), JSON.stringify(air, null, 2));
    console.log(`[air] ${d.id}: ${air.line} (${air.sensors.pm25}×PM2.5, ${air.sensors.pm10}×PM10)`);
  } catch (err) {
    console.error(`[air] ${d.id}: ${err.message}`);
  }
}
