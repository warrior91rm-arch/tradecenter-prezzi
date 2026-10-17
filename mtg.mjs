// Prepara src/catalog/mtg-prices.json: i prezzi MAGIC di Card Kingdom e Mana Pool (dollari USA), due mercati in più
// accanto a Cardmarket e TCGplayer nel listino della scheda Prezzi (src/quote.ts). Fatta SUL PC, il telefono legge solo
// la tabella dentro l'app (import pigro: si carica la prima volta che si apre il listino di una carta Magic).
//
// Fonti (08/10/2026, ricerca-fonti.md §2.2 e §5 punto 5):
// - MTGJSON AllPricesToday (https://mtgjson.com, licenza MIT, senza chiave, rifatto ogni giorno): per ogni stampa
//   (uuid MTGJSON) il prezzo di VENDITA di Card Kingdom (negozio, copie NM disponibili) e il prezzo più basso in vendita
//   su Mana Pool (marketplace, qualsiasi condizione: è il price_cents della sua API), normale / foil / etched;
// - MTGJSON csv/cardIdentifiers: uuid -> scryfallId (l'id della stampa su Scryfall, quello che MTGJSON usa a sua volta
//   per agganciare Card Kingdom e Mana Pool);
// - Scryfall bulk "default_cards" (JSON Lines): scryfallId -> set + numero di collezione. Le carte Magic dell'app hanno la
//   chiave magic:<set Scryfall>:<numero>:<lingua> (scryfall.ts), quindi set + numero aggancia ESATTAMENTE la stampa e
//   vale per tutte le lingue (le stampe non inglesi hanno un altro id Scryfall ma lo stesso set e numero; i due negozi
//   vendono soprattutto copie inglesi, come TCGplayer). Nessun nome, nessuna somiglianza.
//
//   node tools/build-mtg-prices.mjs [--cache <cartella>]
//
// Scarica circa 100 MB (5 MB prezzi + 15 MB identificativi MTGJSON + 79 MB Scryfall), al massimo una volta al giorno
// per file (copia nella cartella di cache, fuori dal progetto). Da rifare prima di ogni APK: la data dei prezzi è
// quella della tabella e la scheda la mostra ("aggiornato N g fa"); oltre 45 giorni le due fonti restano un secondo
// parere fuori dalla media (quote.ts TCG_OLD_MS).
//
// Forma: s.<set Scryfall> = stampe separate da spazi, ognuna "numero:ckNormale:ckFoil:mpNormale:mpFoil" in CENTESIMI
// di dollaro (vuoto = nessun prezzo; i campi vuoti in coda si tolgono). Foil = foil, o etched se la stampa ha solo
// quella (come usdFoil di Scryfall). Licenza MIT di MTGJSON copiata per intero nel campo "lic", come chiede la licenza.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --out (12/10/2026): il lavoro notturno dell'archivio tradecenter-prezzi la scrive accanto a prezzi.json
const OUT = arg('out', path.join(ROOT, 'src/catalog/mtg-prices.json'));
const CACHE = arg('cache', path.join(os.tmpdir(), 'tradecenter-prezzi', 'mtg'));
fs.mkdirSync(CACHE, { recursive: true });
// Scryfall vuole un User-Agent col nome dell'app e un Accept (documentazione "Required Headers")
const HEADERS = { 'User-Agent': 'TradeCenter/1.1 (catalog build tool)', Accept: 'application/json;q=0.9,*/*;q=0.8' };
const FRESH = 20 * 3600e3;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const MTGJSON_LICENSE = `MIT License

Copyright © 2018-Present Zachary Halpern

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// File nella cache: la copia più giovane di 20 ore si riusa (lo stesso file non si riscarica nello stesso giorno)
async function download(url, file) {
  const f = path.join(CACHE, file);
  if (fs.existsSync(f) && fs.statSync(f).size > 1000 && Date.now() - fs.statSync(f).mtimeMs < FRESH) return f;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await pause(3000 * attempt);
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok || !r.body) {
        console.warn(`${url}: ${r.status}`);
        continue;
      }
      const tmp = `${f}.part`;
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
      fs.renameSync(tmp, f);
      console.log(`scaricato ${file}: ${(fs.statSync(f).size / 1048576).toFixed(1)} MB`);
      return f;
    } catch (e) {
      console.warn(`${url}: ${e}`);
    }
  }
  throw new Error(`${url}: nessuna risposta`);
}

const lines = (file) => readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });

// Riga CSV con le virgolette ("a,b" resta un campo solo)
function csvRow(s) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// --- 1. prezzi del giorno (MTGJSON) ------------------------------------------------------------------------------
const pricesFile = await download('https://mtgjson.com/api/v5/AllPricesToday.json.gz', 'AllPricesToday.json.gz');
const all = JSON.parse(zlib.gunzipSync(fs.readFileSync(pricesFile)).toString('utf8'));
const meta = all.meta ?? {};
// prezzo del giorno più recente di una mappa { "2026-10-07": 2.79 }
const latest = (m) => {
  if (!m || typeof m !== 'object') return { v: undefined, d: undefined };
  const d = Object.keys(m).sort().pop();
  const v = d ? Number(m[d]) : NaN;
  return Number.isFinite(v) && v > 0 ? { v, d } : { v: undefined, d };
};
const byUuid = new Map(); // uuid -> { ck: [n, f], mp: [n, f] } in dollari
const dates = { ck: new Set(), mp: new Set() };
for (const [uuid, p] of Object.entries(all.data ?? {})) {
  const paper = p?.paper;
  if (!paper) continue;
  const row = {};
  for (const [prov, k] of [['cardkingdom', 'ck'], ['manapool', 'mp']]) {
    const retail = paper[prov]?.retail;
    if (!retail || paper[prov]?.currency !== 'USD') continue;
    const n = latest(retail.normal);
    const f = latest(retail.foil);
    const e = latest(retail.etched);
    for (const x of [n, f, e]) if (x.d) dates[k].add(x.d);
    if (n.v != null || f.v != null || e.v != null) row[k] = [n.v, f.v ?? e.v];
  }
  if (row.ck || row.mp) byUuid.set(uuid, row);
}
console.log(`MTGJSON ${meta.version ?? '?'} del ${meta.date ?? '?'}: ${byUuid.size} stampe con Card Kingdom o Mana Pool`);

// --- 2. uuid -> scryfallId (MTGJSON) -----------------------------------------------------------------------------
const idsFile = await download('https://mtgjson.com/api/v5/csv/cardIdentifiers.csv.gz', 'cardIdentifiers.csv.gz');
const uuidToScry = new Map();
{
  let iU = -1;
  let iS = -1;
  for await (const line of lines(idsFile)) {
    if (iU < 0) {
      const h = csvRow(line);
      iU = h.indexOf('uuid');
      iS = h.indexOf('scryfallId');
      if (iU < 0 || iS < 0) throw new Error(`cardIdentifiers.csv: colonne uuid/scryfallId non trovate (${h.join(',').slice(0, 200)})`);
      continue;
    }
    if (!line) continue;
    const r = csvRow(line);
    if (byUuid.has(r[iU]) && /^[0-9a-f-]{36}$/i.test(r[iS] ?? '')) uuidToScry.set(r[iU], r[iS].toLowerCase());
  }
}
console.log(`uuid con id Scryfall: ${uuidToScry.size} su ${byUuid.size}`);

// --- 3. scryfallId -> set + numero (Scryfall bulk default_cards) -----------------------------------------------------
const bulk = await (await fetch('https://api.scryfall.com/bulk-data/default-cards', { headers: HEADERS })).json();
const bulkUrl = bulk.jsonl_download_uri ?? bulk.download_uri;
if (!bulkUrl) throw new Error('Scryfall bulk-data/default-cards: indirizzo del file non trovato');
const scryFile = await download(bulkUrl, 'default-cards.jsonl.gz');
const need = new Set(uuidToScry.values());
const scry = new Map(); // id -> { set, num, usd, usdFoil, name }
for await (let line of lines(scryFile)) {
  line = line.trim();
  if (!line || line === '[' || line === ']') continue;
  if (line.endsWith(',')) line = line.slice(0, -1);
  const id = line.match(/"id":"([0-9a-f-]{36})"/)?.[1];
  if (!id || !need.has(id)) continue;
  const c = JSON.parse(line);
  if (c.digital) continue;
  scry.set(id, { set: String(c.set).toLowerCase(), num: String(c.collector_number), usd: Number(c.prices?.usd) || undefined, usdFoil: Number(c.prices?.usd_foil ?? c.prices?.usd_etched) || undefined, name: c.name });
}
console.log(`id Scryfall trovati nel bulk: ${scry.size} su ${need.size}`);

// --- 4. tabella -------------------------------------------------------------------------------------------------
const cents = (v) => (v == null ? '' : String(Math.round(v * 100)));
const sets = new Map(); // set -> Map(num -> [ckN, ckF, mpN, mpF])
let dup = 0;
let conflict = 0;
let badNum = 0;
let suspicious = 0;
const suspects = [];
const samples = [];
const $ = (x) => (x == null ? '—' : x.toFixed(2));
for (const [uuid, row] of byUuid) {
  const sid = uuidToScry.get(uuid);
  const s = sid ? scry.get(sid) : undefined;
  if (!s) continue;
  // ":" e lo spazio separano i campi e le stampe: un numero che li contenesse romperebbe la tabella (oggi nessuno)
  if (/[:\s]/.test(s.num)) {
    badNum++;
    continue;
  }
  const v = [row.ck?.[0], row.ck?.[1], row.mp?.[0], row.mp?.[1]];
  let m = sets.get(s.set);
  if (!m) sets.set(s.set, (m = new Map()));
  const prev = m.get(s.num);
  if (prev) {
    // stessa stampa da più uuid (carte a più facce in MTGJSON): stessi prezzi; se no vale il primo prezzo trovato
    dup++;
    if (prev.some((x, i) => x != null && v[i] != null && Math.abs(x - v[i]) > 0.005)) conflict++;
    m.set(s.num, prev.map((x, i) => x ?? v[i]));
  } else m.set(s.num, v);
  // controllo d'aggancio: Card Kingdom o Mana Pool lontanissimi dal TCGplayer di Scryfall della stessa stampa
  const ref = s.usd ?? s.usdFoil;
  const mine = v[0] ?? v[2];
  const line = `${s.name} ${s.set.toUpperCase()} ${s.num}: CK ${$(v[0])} / foil ${$(v[1])} · Mana Pool ${$(v[2])} / foil ${$(v[3])} · TCGplayer (Scryfall) ${$(s.usd)} / ${$(s.usdFoil)}`;
  if (ref && mine && ref >= 1 && (mine / ref > 10 || ref / mine > 10)) {
    suspicious++;
    if (suspects.length < 12) suspects.push(line);
  }
  if (/^(sol ring|ragavan, nimble pilferer|the one ring|black lotus)$/i.test(s.name) && ['cmm', 'mh2', 'ltr', 'leb', 'lea', '2ed'].includes(s.set)) samples.push(line);
}
const s = {};
let entries = 0;
let ckN = 0;
let mpN = 0;
for (const set of [...sets.keys()].sort()) {
  const m = sets.get(set);
  const parts = [];
  for (const [num, v] of [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
    if (v[0] != null || v[1] != null) ckN++;
    if (v[2] != null || v[3] != null) mpN++;
    const f = v.map(cents);
    while (f.length && f[f.length - 1] === '') f.pop();
    if (!f.length) continue;
    parts.push(`${num}:${f.join(':')}`);
    entries++;
  }
  if (parts.length) s[set] = parts.join(' ');
}
const lastDate = (set) => [...set].sort().pop();
const table = {
  _: 'Prezzi Magic di Card Kingdom e Mana Pool in dollari USA, da MTGJSON AllPricesToday (https://mtgjson.com, licenza MIT nel campo lic), fatti da tools/build-mtg-prices.mjs sul PC. s.<set Scryfall> = stampe separate da spazi, ognuna "numero:ckNormale:ckFoil:mpNormale:mpFoil" in centesimi (vuoto = nessun prezzo). Card Kingdom = prezzo di vendita del negozio (NM, carte disponibili); Mana Pool = prezzo più basso in vendita (qualsiasi condizione). Foil = foil, o etched se la stampa ha solo quella.',
  built: new Date().toISOString().slice(0, 10),
  date: meta.date ?? lastDate(new Set([...dates.ck, ...dates.mp])),
  ck: lastDate(dates.ck),
  mp: lastDate(dates.mp),
  mtgjson: meta.version,
  src: 'MTGJSON (mtgjson.com) · Card Kingdom · Mana Pool',
  lic: MTGJSON_LICENSE,
  s,
};
const json = JSON.stringify(table);
// paracadute (12/10/2026): una tabella molto più corta di quella che c'è già (una fonte che ha risposto a metà) non la
// sostituisce; resta la vecchia e il lavoro notturno lo segnala
if (fs.existsSync(OUT) && json.length < fs.statSync(OUT).size * 0.8) {
  console.error(`tabella nuova troppo corta (${json.length} contro ${fs.statSync(OUT).size} byte): tengo quella che c'è`);
  process.exit(1);
}
fs.writeFileSync(OUT, json);
const gz = zlib.gzipSync(json, { level: 9 }).length;
console.log(`\n${path.relative(ROOT, OUT)}: ${(json.length / 1048576).toFixed(2)} MB (gzip ${(gz / 1048576).toFixed(2)} MB), ${Object.keys(s).length} set, ${entries} stampe (Card Kingdom ${ckN}, Mana Pool ${mpN})`);
console.log(`date: prezzi ${table.date}, Card Kingdom ${table.ck}, Mana Pool ${table.mp}`);
console.log(`stampe da più uuid: ${dup} (prezzi diversi: ${conflict}) · numeri con ":" o spazi saltati: ${badNum}`);
// da guardare a occhio: di solito sono stampe con pochi annunci (TCGplayer di Scryfall vecchio o di un'altra finitura)
console.log(`Card Kingdom / Mana Pool oltre 10 volte il TCGplayer di Scryfall della stessa stampa: ${suspicious}`);
for (const x of suspects) console.log(`  ? ${x}`);
console.log('esempi:');
for (const x of samples.sort()) console.log(`  ${x}`);
