---
name: kvartalami-aggregator
description: This skill should be used when the user asks about "kvartalami", "municipal news", "news aggregator", "Sofia neighborhoods", or mentions kvartalami.bg, neighborhood news, district-level aggregation, or local news pipeline.
version: 0.1.0
---

# Kvartalami Aggregator

## Overview

Sofia neighborhood news aggregation project. Scrapes municipal and utility sources, summarizes with LLM, publishes as a static site on Cloudflare Pages.

**Project location:** `~/kvartalami-bg/`

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scraping runtime | GitHub Actions (free tier) | 2,000 min/month, cron scheduling built-in |
| Static hosting | Cloudflare Pages | Auto-deploy on git push, free tier sufficient |
| Storage | JSON files in Git | No database for MVP; simple, version-controlled |
| LLM summarization | Gemini 2.0 Flash | $0.15/1M input tokens, ~$1/month at scale |
| HTML generation | Static build script | No framework, plain HTML + CSS |
| Scale ceiling | ~150K articles/month | Gemini rate limits + GitHub Actions minutes |

## Pipeline

```
scrape.js (Cheerio) → summarize.js (Gemini) → build.js (static HTML) → git push → Cloudflare Pages
```

### Stage Details

| Stage | Script | Input | Output |
|-------|--------|-------|--------|
| Scrape | `scrape.js` | Source URLs from config | `data/raw/{source}/{date}.json` |
| Summarize | `summarize.js` | Raw article JSON | `data/summaries/{date}.json` |
| Build | `build.js` | Summary JSON | `dist/index.html`, `dist/{district}/index.html` |
| Deploy | `git push` | `dist/` | Cloudflare Pages auto-deploy |

### npm Scripts

```bash
npm run scrape      # Fetch from all sources
npm run summarize   # LLM summarization pass
npm run build       # Generate static HTML
npm run update      # scrape + summarize + build (full pipeline)
```

## Data Sources

| Source | URL | Notes |
|--------|-----|-------|
| sofia.bg | sofia.bg/news | Main municipal portal. Standard HTML, Cheerio-friendly |
| sofiyskavoda.bg | sofiyskavoda.bg | Water utility alerts. Check for encoding issues (mixed CP1251/UTF-8) |
| toplo.bg | toplo.bg | Heating utility. Seasonal schedule changes |
| erpsever.bg | erpsever.bg | Electricity provider. **JS-rendered** — needs Playwright fallback |
| council.sofia.bg | council.sofia.bg | City council sessions. PDF agendas need extraction |

### Source-Specific Gotchas

| Issue | Detail |
|-------|--------|
| **Cyrillic encoding** | Some sources mix CP1251 and UTF-8. Detect with `chardet`, normalize to UTF-8 |
| **Facebook-only districts** | Some district municipalities (кметства) post only on Facebook. Out of scope for MVP |
| **PDF extraction** | council.sofia.bg publishes agendas as PDF. Use `pdf-parse` for text extraction |
| **JS rendering** | erpsever.bg requires JS execution. Use Playwright for this source only |
| **Rate limiting** | sofia.bg may rate-limit; add 1-2s delay between requests |

## Configuration

```json
{
  "district": "Лозенец",
  "sources": [
    { "name": "sofia.bg", "url": "...", "selector": "..." }
  ],
  "categories": ["repairs", "government", "events", "other"],
  "llm": {
    "model": "gemini-2.0-flash",
    "maxTokens": 256,
    "temperature": 0.3
  },
  "archive": {
    "retentionDays": 90
  }
}
```

## Categories

| Category | Bulgarian | Content Type |
|----------|-----------|-------------|
| repairs | Ремонти | Road work, water shutoffs, power outages |
| government | Управление | Council decisions, permits, regulations |
| events | Събития | Cultural events, community activities |
| other | Други | Uncategorized municipal news |
