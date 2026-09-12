# Plan: Map-Größe variabel (R17)

**Status:** in Arbeit
**Datum:** 2026-09-12

## Ziel
Die Kantenlänge der Map ist ein Regler (statt fest 400 m). Alle Meter-Parameter (Wellenlängen, Höhen, Straßenbreite,
Ringbreite, Ortsabstand, Flussbreite) behalten ihre Bedeutung: eine größere Map zeigt mehr Gelände mit gleich großen Formen.

## Entscheidungen
- **Neuer Save-Schlüssel `mapSize`** (m, Default 400, Regler 200–1000 in World/„Map“) → alte Saves/Links = 400 = bitgleich,
  `SAVE_VERSION` bleibt 2. Die Konstante `MAP` in main.js wird `params.mapSize`; Shader, roadgen, hydro, Erosion bekommen
  `mapSize` schon als Parameter.
- **Auflösungen bleiben fest** (RES 1024, PRE 128, EROSION_RES 512, TN 512) → Pixel/Zelle wächst mit der Map
  (1000 m: ~1 m/px, Routing 7,8 m/Zelle). Variable Auflösung wäre ein eigener Punkt (Speicher, Laufzeit).
  `// vereinfacht:` in Metern definierte Zellzahlen (roadgen `PATH_SMOOTH`, hydro `MIN_RIVER_CELLS`) skalieren mit.
- **Noise in Weltkoordinaten ab (0, 0)** wie bisher → gleicher Seed, größere Map = dieselbe Landschaft, weiter gefasst
  (Ring, Straßen, Flüsse neu).
- **Abstand-/Prozentwerte:** Abdeckungen in % der Map bleiben %; Einzugsgebiet `riverCatchment` bleibt % der Map-Fläche.
  `RELIEF_M` (Relief-Tönung) wird fester Meterwert (9,375 m wie bei 400 m) statt 24 px.
- **Kamera/Nebel/Walk** skalieren mit der Map (Startposition, `maxDistance`, `far`, Nebel, Walk-Grenze).
- Headless-Skripte nutzen `params.mapSize` statt 400.

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. M1 `mapSize` als Parameter durch main.js (Compute, Mesh, Walk, Export, Statistik, Kamera), Regler → Prüfung: `check`,
   400 m alle Presets bitgleich (heights, roadMask, Vorschau-Hash)
2. M2 Tests bei 2 Größen: roadgen- und hydro-Test mit 400 und 800 m (Argument), sanity ruft beide → Prüfung: `sanity` grün
3. M3 headless 400 vs. 800 m (Defaults, Mountains, River valley): Hügel-p95 in m, Abdeckung Berge %, Straßenbreite in m,
   Ringbreite in m, Flussbreite gleich ±10 %; Screenshots → Prüfung: Tabelle im Abschluss

## Abgeschlossen
- [x] M1 mapSize durchgereicht (`MAP` → `params.mapSize` in Compute, Hydro, Routing, Mesh, Walk-Grenze, Export, Statistik;
  `RELIEF_M` fest 9,375 m; `fitView` für Kamera/Nebel/Zoom; Regler World/Map 200–1000 m; 400 m: 7 Presets heights +
  roadMask bitgleich, Vorschau-Hash Defaults/Lakes/River valley gleich HEAD) — geprüft am 2026-09-12
- [ ] M2 Tests bei 2 Größen — geprüft am
- [ ] M3 headless 400 vs. 800 — geprüft am

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
