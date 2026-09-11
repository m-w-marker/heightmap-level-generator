# Plan: Presets v2 – Farben, Terrain-Regler, Abstimmung

**Status:** in Arbeit
**Datum:** 2026-09-11

## Ziel
Jedes Preset sieht nach seinem Namen aus (headless geprüft). Dafür Farben unabhängig von `maxH`,
glatte vs. raue Hügel, natürlicherer Rand-Ring.

## Befund (headless, Seed 1337, 2026-09-11)
- Farbrampe relativ zu `maxH` (seit T1 automatisch) → Farben verschieben sich je Preset; alles blass,
  Berge grün, flacher Ring bei Pasture grau/weiß.
- Hügel-fbm fest 5 Okt. / Gain 0,5 → ~1-m-Riffel überall („zerknittert“ statt rollend).
- Ring-Höhe schwankt nur 60–100 % → gleichmäßige Wand („Badewanne“).
- `roadSlopeVar` bis 80° → senkrechte Streifenwände an Einschnitten.
- Canyon 39 % Wasser (Kanten senken unter Wasserspiegel), Pasture flach, Mountains = Krater.

## Entscheidungen
- **Farbe nach Metern über Wasser + Neigung:** Rampe Sand → Gras → dunkles Grün → Fels → Schnee in m
  über `waterLevel`; Fels-Überblendung nach Hangneigung (≈ 35–50°), Neigung einmal pro Readback aus
  der Heightmap. Kräftigeres Grün.
- **`hillRoughness`** (Gain der Hügel-Oktaven 0,25–0,65, Default 0,5 = bisher). Amplituden-Normierung
  skaliert mit σ-Verhältnis `sqrt(Σ g^2i)` (CPU), Stats-Test prüft p95 bei mehreren Gains.
- **Ring-Höhe** `0.55 + 0.6·fbm` statt `0.6 + 0.4·fbm` → ~30–80 % (p5–p95), bleibt ≥ 0.
- **Böschung max. 60°** (`SLOPE_MAX`).
- Presets per headless Screenshot-Schleife (puppeteer-core im Scratchpad, nicht im Projekt).

## Meilensteine
1. **P1 Farben** (`main.js`) → Prüfung: check grün; headless: Berge felsig, Täler grün, Farben gleich bei anderem `maxH`.
2. **P2 Terrain-Regler** (`heightmap.wgsl`, `uniforms.js`, `main.js`, `tests/noise.mjs`, `tests/terrain.stats.mjs`)
   → Prüfung: check grün (p95 ±10 % bei Gain 0,3/0,5/0,65; kein Clamp oben).
3. **P3 Presets abstimmen** (`main.js`) → Prüfung: check grün; headless jedes Preset: Wasseranteil
   plausibel (Canyon < 10 %, Lakes 15–35 %), Bild passt zum Namen.

## Abgeschlossen
- [x] P1 Farben — geprüft am 2026-09-11 (+ Fund: Vertex-Farben sRGB → linear, war Hauptgrund für „blass“)
- [x] P2 Terrain-Regler — geprüft am 2026-09-11
- [ ] P3 Presets abstimmen — geprüft am YYYY-MM-DD

<!-- fertig: git mv Plan/PresetsV2.md Plan/erledigt/ -->
