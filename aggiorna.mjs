// Prezzi del giorno per l'app Trade Center (gira ogni notte su GitHub Actions, .github/workflows/prezzi.yml).
// Legge ids.json (i prodotti TCGplayer che l'app usa, per gruppo tcgcsv), scarica da tcgcsv.com i prezzi di oggi SOLO di
// quei gruppi (User-Agent riconoscibile, una richiesta alla volta con una pausa, come chiede tcgcsv) e scrive prezzi.json.
// Dati: TCGplayer, tramite tcgcsv.com.
//
// prezzi.json = { at: "AAAA-MM-GG", tcg: "<data dei dati tcgcsv>", n: <prodotti>, p: { "<productId>": riga } }
// riga = [principale, foil, minimo, reverse, primaEd, piùEconomico, minimoDelPiùEconomico, medio] in dollari, 0 = nessun
// dato, zeri in coda tolti:
//   principale = market del sottotipo base (Normal, poi Holofoil, Unlimited, Unlimited Holofoil, il solo sottotipo, il
//                primo che non è 1st Edition né Reverse); minimo e medio sono di quel sottotipo
//   foil       = market del primo sottotipo foil/holo diverso dal principale (non reverse, non 1st Edition)
//   reverse    = market del Reverse Holofoil;  primaEd = market della 1st Edition (normale prima, poi holo)
//   piùEconomico / minimoDelPiùEconomico = il market più basso fra tutti i sottotipi che ne hanno uno, e il suo minimo
//                (0 quando sono uguali a principale e minimo: allora valgono quelli); medio solo senza un market principale
import { readFileSync, writeFileSync } from 'node:fs';

const UA = { 'User-Agent': 'TradeCenter-prezzi/1.0 (github.com/warrior91rm-arch/tradecenter-prezzi)' };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0);

async function prendi(url) {
  for (let i = 0; i < 4; i++) {
    await dorme(i ? 2000 * i : 150);
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      /* si riprova */
    }
  }
  return null;
}

function riga(subs) {
  const conM = subs.filter((s) => r2(s.marketPrice));
  const nome = (s) => String(s.subTypeName ?? '');
  const trova = (re, lista = subs) => lista.find((s) => re.test(nome(s)));
  const base =
    trova(/^Normal$/i) ?? trova(/^Holofoil$/i) ?? trova(/^Unlimited$/i) ?? trova(/^Unlimited Holofoil$/i) ?? (subs.length === 1 ? subs[0] : undefined) ?? subs.find((s) => !/1st|reverse/i.test(nome(s))) ?? subs[0];
  const foil = subs.find((s) => s !== base && /foil|holo/i.test(nome(s)) && !/reverse|1st/i.test(nome(s)) && r2(s.marketPrice));
  const rev = trova(/reverse/i, conM);
  const prima = trova(/^1st Edition( Normal)?$/i, conM) ?? trova(/^1st/i, conM);
  const eco = [...conM].sort((a, b) => a.marketPrice - b.marketPrice)[0];
  const out = [r2(base?.marketPrice), r2(foil?.marketPrice), r2(base?.lowPrice), r2(rev?.marketPrice), r2(prima?.marketPrice), r2(eco?.marketPrice), r2(eco?.lowPrice), r2(base?.midPrice)];
  // per un file più leggero: il più economico solo se diverso dal principale, il medio solo senza un market principale
  if (out[5] === out[0] && out[6] === out[2]) out[5] = out[6] = 0;
  if (out[0]) out[7] = 0;
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

const ids = JSON.parse(readFileSync(new URL('./ids.json', import.meta.url), 'utf8'));
const tcgData = await fetch('https://tcgcsv.com/last-updated.txt', { headers: UA })
  .then((r) => (r.ok ? r.text() : ''))
  .catch(() => '');
const p = {};
let gruppi = 0;
let falliti = 0;
for (const [g, lista] of Object.entries(ids.gruppi)) {
  const voglio = new Set(lista);
  const prezzi = (await prendi(`https://tcgcsv.com/tcgplayer/${g}/prices`))?.results;
  gruppi++;
  if (!prezzi) {
    falliti++;
    continue;
  }
  const per = new Map();
  for (const x of prezzi) if (voglio.has(x.productId)) (per.get(x.productId) ?? per.set(x.productId, []).get(x.productId)).push(x);
  for (const [id, subs] of per) {
    const r = riga(subs);
    if (r.length) p[id] = r;
  }
  if (gruppi % 200 === 0) console.log(`${gruppi} gruppi, ${Object.keys(p).length} prezzi`);
}
// troppi gruppi senza risposta (tcgcsv giù): non si scrive niente, resta il file di ieri
if (falliti > gruppi * 0.2) {
  console.error(`tcgcsv non risponde: ${falliti} gruppi su ${gruppi} senza prezzi. Resta il file di prima.`);
  process.exit(1);
}
const out = { _: 'Prezzi di mercato TCGplayer (via tcgcsv.com) dei prodotti usati dall\'app Trade Center. Vedi aggiorna.mjs per il formato.', at: new Date().toISOString().slice(0, 10), tcg: tcgData.trim(), n: Object.keys(p).length, p };
writeFileSync(new URL('./prezzi.json', import.meta.url), JSON.stringify(out));
console.log(`FINE: ${out.n} prezzi da ${gruppi} gruppi (${falliti} senza risposta), dati tcgcsv ${out.tcg}`);
