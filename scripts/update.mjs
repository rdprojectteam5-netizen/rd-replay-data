// RD Replay data job: downloads 1-minute candles and stores one CSV per market per UTC day.
// Usage: node scripts/update.mjs [days]   (default 2 = yesterday + today; use 730 for a 2-year backfill)
import fs from 'node:fs';
import path from 'node:path';

const DAYS = Math.max(1, Number(process.argv[2] || 2));
const KEY = process.env.MASSIVE_API_KEY || '';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MARKETS = [
  { id: 'EURUSD', src: 'massive', ticker: 'C:EURUSD' },
  { id: 'GBPUSD', src: 'massive', ticker: 'C:GBPUSD' },
  { id: 'USDJPY', src: 'massive', ticker: 'C:USDJPY' },
  { id: 'XAUUSD', src: 'massive', ticker: 'C:XAUUSD' },
  { id: 'BTCUSD', src: 'binance', ticker: 'BTCUSDT' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

async function getJSON(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'rd-replay-data' } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(15000 * (i + 1)); continue; }
    throw new Error(`HTTP ${res.status} for ${url.replace(/apiKey=[^&]+/, 'apiKey=***')}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('Too many retries');
}

// Massive free plan: 5 calls a minute, so wait 13 s between calls.
let lastMassive = 0;
async function massive(ticker, fromMs, toMs) {
  const out = [];
  let url = `https://api.massive.com/v2/aggs/ticker/${ticker}/range/1/minute/${fromMs}/${toMs}?adjusted=true&sort=asc&limit=50000`;
  while (url) {
    const wait = lastMassive + 13000 - Date.now(); if (wait > 0) await sleep(wait);
    lastMassive = Date.now();
    const j = await getJSON(url + (url.includes('apiKey=') ? '' : `&apiKey=${KEY}`));
    for (const b of j.results || []) out.push([Math.floor(b.t / 1000), b.o, b.h, b.l, b.c, b.v || 0]);
    url = j.next_url || null;
  }
  return out;
}

async function binance(symbol, fromMs, toMs) {
  const out = [];
  let start = fromMs;
  while (start < toMs) {
    const j = await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${start}&endTime=${toMs}&limit=1000`);
    if (!j.length) break;
    for (const k of j) out.push([Math.floor(k[0] / 1000), +k[1], +k[2], +k[3], +k[4], Math.round(+k[5] * 1000) / 1000]);
    start = j[j.length - 1][0] + 60000;
    await sleep(150);
  }
  return out;
}

function readDay(file) {
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) { if (!line) continue; const p = line.split(','); m.set(+p[0], p); }
  return m;
}

async function run() {
  const now = Date.now();
  const fromMs = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - (DAYS - 1) * 86400000;
  const indexFile = path.join(ROOT, 'data', 'index.json');
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { markets: {} };
  let failed = 0;
  for (const mk of MARKETS) {
    if (mk.src === 'massive' && !KEY) { console.log(`skip ${mk.id}: no MASSIVE_API_KEY secret`); continue; }
    // Download in 30-day chunks so a long backfill keeps memory small.
    for (let a = fromMs; a < now; a += 30 * 86400000) {
      const b = Math.min(now, a + 30 * 86400000 - 1);
      let bars;
      try { bars = mk.src === 'massive' ? await massive(mk.ticker, a, b) : await binance(mk.ticker, a, b); }
      catch (e) { console.error(`${mk.id} ${day(a / 1000)}: ${e.message}`); failed++; continue; }
      const byDay = new Map();
      for (const r of bars) { const d = day(r[0]); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); }
      for (const [d, rows] of byDay) {
        const file = path.join(ROOT, 'data', mk.id, d.slice(0, 4), `${d}.csv`);
        const m = readDay(file);
        for (const r of rows) m.set(r[0], r.map(String));
        const keys = [...m.keys()].sort((x, y) => x - y);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 't,o,h,l,c,v\n' + keys.map((k) => m.get(k).join(',')).join('\n') + '\n');
        const info = index.markets[mk.id] || (index.markets[mk.id] = { first: d, last: d, source: mk.src });
        if (d < info.first) info.first = d; if (d > info.last) info.last = d;
        info.lastT = Math.max(info.lastT || 0, keys[keys.length - 1]);
      }
      console.log(`${mk.id} ${day(a / 1000)}..${day(b / 1000)}: ${bars.length} candles`);
    }
  }
  index.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + '\n');
  if (failed) process.exitCode = 1;
}
run();
