# Plan: Auflösung wächst mit der Map-Größe

**Status:** fertig
**Datum:** 2026-09-12

## Ziel
Ein Pixel bleibt bei jeder Map-Größe gleich groß (0,39 m wie bei 400 m / 1024 px), statt bei 1000 m auf ~1 m grob zu werden.
Alle Raster (Heightmap, Mesh, Erosion, Straßen/Hydrologie) wachsen mit; bei 400 m bleibt alles bitgleich.

## Entscheidungen
- **Feste Kopplung, kein Qualitäts-Regler** (User 2026-09-12: ~1 s bei 1 km ist ok).
- **Raster je Map-Größe** aus einer Funktion `grids(mapSize)`: `res` = mapSize / 0,390625 m auf Vielfache von 128 gerundet
  (512 … 2560), Mesh `tn` = res/2, Erosion = res/2, Prepass/Hydrologie `pre` = res/8 → bei 400 m exakt 1024/512/512/128.
  Vielfache von 128 → alle Dispatches glatt durch 16. Größen aus geladenen JSON außerhalb 200–1000 m werden auf das
  Raster-Minimum/-Maximum geklemmt (Pixel wird dann größer/kleiner, rechnet aber).
- **Straßen- und Flussraster wachsen voll mit** (gemessen bei 1000 m / 320²: roadgen 149 ms, hydro 15 ms) → Zellen bleiben
  3,1 m, zellbasierte Konstanten (`PATH_SMOOTH`, `MIN_RIVER_CELLS`) behalten ihre Bedeutung.
- **GPU-Puffer einmal für das Maximum** (res 2560, Erosion 1280²): heights/roadMask/water 3 × 26 MB, Erosion ~85 MB →
  ~165 MB. Kein Neuanlegen bei Größenwechsel (Bind-Groups bleiben). Grenzen: `maxStorageBufferBindingSize` 128 MB ≥ 26 MB.
- **WGSL:** `EROSION_RES`/`LAKE_RES` und erosion `N` werden Uniform-Felder statt Konstanten.
- **Vorschau-Canvas, Farbtextur, Mesh** werden bei Größenwechsel neu angelegt.
- **Export:** „native“ = aktuelle Auflösung (Pixelzentren) statt fest 1024; 513/1025/2049 bleiben (Unreal).
- glTF bleibt das angezeigte Mesh (bei 1000 m 1280² Ecken, ~60 MB) — `// vereinfacht:` wie bisher.

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. A1 Raster-Funktion + Uniform-Felder (erosionRes, lakeRes, erosion n), Puffer auf Maximum, Layout-Test → Prüfung:
   `check`, 400 m alle Presets bitgleich (heights, roadMask, Vorschau-Hash)
2. A2 main.js mit variablen Rastern (Vorschau, Textur, Mesh, Walk, Export native, Seed-Vorschau) → Prüfung: 400 m bitgleich,
   200/700/1000 m laufen ohne WebGPU-Fehler
3. A3 headless 400 vs. 1000 m: m/px, Fahrbahn- und Flussbreite, Regenerationszeit (≤ ~1,5 s), Seed-Vergleich-Zeit,
   Nahaufnahme gleich scharf → Prüfung: Tabelle
4. A4 Doku (`projekt.md`, `wgsl.md`, README) → Prüfung: `check`

## Abgeschlossen
- [x] A1 Raster + Uniforms (`grids()`, Params `erosionRes`/`lakeRes` → roads weiter ab Byte 128, erosion `e.n`, Puffer auf
  Maximum; Layout-Test: grids(400) = 1024/512/512/128, 200–1000 m glatt durch 16 bei 0,390625 m/px) — geprüft am 2026-09-12
- [x] A2 main.js variabel (zusammen mit A1, erst beides lauffähig; Vorschau/Textur neu bei Größenwechsel, Export „native“,
  Tests bei 800 m mit mitwachsendem Raster; Wasser-Mesh direkt in Puffer + Normale oben: 630 → 40 ms bei 1000 m;
  400 m: heights + roadMask + Vorschau-Hash bitgleich; 200/700/1000 m ohne WebGPU-Fehler) — geprüft am 2026-09-12
- [x] A3 headless 400 vs. 1000 — geprüft am 2026-09-12

| Map | px | Heightmap | Mesh-Ecken | Regeneration | Fahrbahn m | Fluss m (Messung / Soll) |
|---|---|---|---|---|---|---|
| 400 m | 0,390625 m | 1024² | 512² | ~0,2 s | 5,18 | 4,39 / 4,32 |
| 1000 m | 0,390625 m | 2560² | 1280² | 0,8–1,1 s | 5,08 | 3,32 / 3,24 |

Nahaufnahme aus 20 m gleich scharf; Seed-Vergleich 1000 m 12 Kacheln 3,3 s; Walk läuft; Export native 2560² PNG = RAW,
Metadaten cellSize 0,390625 m. Mesh-Aufbau (computeVertexNormals, 1,6 Mio. Ecken) ~0,45 s ist der größte Rest.
- [x] A4 Doku (`projekt.md`, `wgsl.md`, `kamera.md`, `hydro.md`, `export.md`, README) — geprüft am 2026-09-12

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
