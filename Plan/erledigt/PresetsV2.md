# Plan: Presets v2 â€“ Farben, Terrain-Regler, Abstimmung

**Status:** fertig
**Datum:** 2026-09-11

## Ziel
Jedes Preset sieht nach seinem Namen aus (headless geprÃ¼ft). DafÃ¼r Farben unabhÃ¤ngig von `maxH`,
glatte vs. raue HÃ¼gel, natÃ¼rlicherer Rand-Ring.

## Befund (headless, Seed 1337, 2026-09-11)
- Farbrampe relativ zu `maxH` (seit T1 automatisch) â†’ Farben verschieben sich je Preset; alles blass,
  Berge grÃ¼n, flacher Ring bei Pasture grau/weiÃŸ.
- HÃ¼gel-fbm fest 5 Okt. / Gain 0,5 â†’ ~1-m-Riffel Ã¼berall (â€žzerknittertâ€œ statt rollend).
- Ring-HÃ¶he schwankt nur 60â€“100 % â†’ gleichmÃ¤ÃŸige Wand (â€žBadewanneâ€œ).
- `roadSlopeVar` bis 80Â° â†’ senkrechte StreifenwÃ¤nde an Einschnitten.
- Canyon 39 % Wasser (Kanten senken unter Wasserspiegel), Pasture flach, Mountains = Krater.

## Entscheidungen
- **Farbe nach Metern Ã¼ber Wasser + Neigung:** Rampe Sand â†’ Gras â†’ dunkles GrÃ¼n â†’ Fels â†’ Schnee in m
  Ã¼ber `waterLevel`; Fels-Ãœberblendung nach Hangneigung (â‰ˆ 35â€“50Â°), Neigung einmal pro Readback aus
  der Heightmap. KrÃ¤ftigeres GrÃ¼n.
- **`hillRoughness`** (Gain der HÃ¼gel-Oktaven 0,25â€“0,65, Default 0,5 = bisher). Amplituden-Normierung
  skaliert mit Ïƒ-VerhÃ¤ltnis `sqrt(Î£ g^2i)` (CPU), Stats-Test prÃ¼ft p95 bei mehreren Gains.
- **Ring-HÃ¶he** `0.55 + 0.6Â·fbm` statt `0.6 + 0.4Â·fbm` â†’ ~30â€“80 % (p5â€“p95), bleibt â‰¥ 0.
- **BÃ¶schung max. 60Â°** (`SLOPE_MAX`).
- Presets per headless Screenshot-Schleife (puppeteer-core im Scratchpad, nicht im Projekt).

## Meilensteine
1. **P1 Farben** (`main.js`) â†’ PrÃ¼fung: check grÃ¼n; headless: Berge felsig, TÃ¤ler grÃ¼n, Farben gleich bei anderem `maxH`.
2. **P2 Terrain-Regler** (`heightmap.wgsl`, `uniforms.js`, `main.js`, `tests/noise.mjs`, `tests/terrain.stats.mjs`)
   â†’ PrÃ¼fung: check grÃ¼n (p95 Â±10 % bei Gain 0,3/0,5/0,65; kein Clamp oben).
3. **P3 Presets abstimmen** (`main.js`) â†’ PrÃ¼fung: check grÃ¼n; headless jedes Preset: Wasseranteil
   plausibel (Canyon < 10 %, Lakes 15â€“35 %), Bild passt zum Namen.

## Abgeschlossen
- [x] P1 Farben â€” geprÃ¼ft am 2026-09-11 (+ Fund: Vertex-Farben sRGB â†’ linear, war Hauptgrund fÃ¼r â€žblassâ€œ)
- [x] P2 Terrain-Regler â€” geprÃ¼ft am 2026-09-11
- [x] P3 Presets abstimmen â€” geprÃ¼ft am 2026-09-11 (headless alle 6; + Relief-TÃ¶nung Kuppe/Mulde,
  Sonne â‰ˆ 30Â°, Ring-Ecken rund statt min()-Diagonalknick)

<!-- fertig: git mv Plan/PresetsV2.md Plan/erledigt/ -->
