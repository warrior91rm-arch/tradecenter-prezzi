# tradecenter-prezzi

Prezzi giornalieri per l'app **Trade Center** (collezionismo di carte).

- `prezzi.json` — prezzi di mercato **TCGplayer**, in dollari, dei prodotti usati dall'app. Dati: TCGplayer, tramite
  [tcgcsv.com](https://tcgcsv.com). Rifatto ogni notte da GitHub Actions (`.github/workflows/prezzi.yml`).
- `mtg-prices.json` — prezzi **Magic** di Card Kingdom e Mana Pool (dollari), da [MTGJSON](https://mtgjson.com)
  (licenza MIT, testo nel campo `lic`), con set e numero da [Scryfall](https://scryfall.com). Script: `mtg.mjs`.
- `ids.json` — l'elenco dei prodotti (numeri TCGplayer per gruppo), aggiornato con ogni versione dell'app.
- `aggiorna.mjs` — lo script che scarica i prezzi (una richiesta alla volta, con una pausa, come chiede tcgcsv).

Nessun dato degli utenti, nessuna chiave: l'app scarica `prezzi.json` e lo usa al posto dei prezzi fermi dentro l'APK.

---

Daily prices for the **Trade Center** card-collecting app: TCGplayer market prices (USD) via tcgcsv.com, rebuilt every
night by GitHub Actions, plus Magic: The Gathering prices from Card Kingdom and Mana Pool via MTGJSON (MIT). No user data, no keys.
