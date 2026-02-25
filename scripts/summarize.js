import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { PATHS, LLM } from './config.js';

const API_KEY = process.env.GEMINI_API_KEY;
const DELAY_MS = 500;

function todayFile() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return join(PATHS.articles, `${yyyy}-${mm}-${dd}.json`);
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

  const file = todayFile();

  let raw;
  try {
    raw = await readFile(file, 'utf-8');
  } catch {
    console.log('No articles to summarize');
    return;
  }

  const articles = JSON.parse(raw);
  const unsummarized = articles.filter(a => !a.summary);

  if (unsummarized.length === 0) {
    console.log('All articles already summarized');
    return;
  }

  console.log(`Summarizing ${unsummarized.length} articles...`);

  let done = 0;
  for (const article of unsummarized) {
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
  console.log(`Done: ${done}/${unsummarized.length}`);
}

main();
