import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { PATHS, LLM } from './config.js';

const API_KEY = process.env.GEMINI_API_KEY;
const DELAY_MS = 500;

// Scrape files are keyed by scrape date; a run just after midnight (or a
// previously failed run) leaves unsummarized articles in earlier files, so
// look back a few days instead of only at today.
function recentFiles(days = 3) {
  const files = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    files.push(join(PATHS.articles, `${yyyy}-${mm}-${dd}.json`));
  }
  return files;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function summarize(text) {
  const url = `${LLM.baseUrl}/models/${LLM.model}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: LLM.prompt + text }] }],
      generationConfig: { maxOutputTokens: LLM.maxTokens, temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

async function main() {
  if (!API_KEY) {
    console.log('No GEMINI_API_KEY set, skipping summarization');
    return;
  }

  let attempted = 0;
  let done = 0;

  for (const file of recentFiles()) {
    let raw;
    try {
      raw = await readFile(file, 'utf-8');
    } catch {
      continue;
    }

    const articles = JSON.parse(raw);
    const unsummarized = articles.filter(a => !a.summary);
    if (unsummarized.length === 0) continue;

    console.log(`Summarizing ${unsummarized.length} articles in ${file}...`);

    for (const article of unsummarized) {
      attempted++;
      try {
        const content = article.content || article.title || '';
        article.summary = await summarize(content);
        done++;
        console.log(`Summarized: ${article.title}`);
      } catch (err) {
        console.error(`Failed to summarize "${article.title}": ${err.message}`);
      }
      await sleep(DELAY_MS);
    }

    await writeFile(file, JSON.stringify(articles, null, 2), 'utf-8');
  }

  console.log(`Done: ${done}/${attempted}`);

  // Fail loud: silently shipping truncated raw text instead of summaries is
  // exactly how this rotted unnoticed when the model name went stale.
  if (attempted > 0 && done === 0) {
    console.error('All summarization attempts failed — failing the run so CI shows it.');
    process.exit(1);
  }
}

main();
