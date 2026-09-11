# Plan: Roads – Terrain-aware Straßen

**Status:** fertig (abgelöst durch Plan/TerrainStrassennetz.md)
**Datum:** 2026-09-11

## Ziel
Straßen, die durchgehen (Edge-to-Edge), Grate umfahren (Täler folgen) und ihrem Verlauf ein
terrain-followendes Niveau geben – statt Spaghetti-Random-Walks und senkrechten Wänden durch
Berggrate. Dazu passende neue Road-Settings.

## Befund (Screenshot 2026-09-11)
- Random Walk (Kurs ±0.6 rad/Schritt, kein Zielpunkt) → Schleifen, Selbstschneidung, Sackgassen.
- Flattening auf fixem `roadLevel` (26 m) → senkrechte Wände über Graten, Deiche unterhalb des
  Niveaus, unter Wasserlevel 15 m füllen sich Gräben (blaue Tümpel an den Straßenrändern).

## Entscheidungen
- **Terrain für die CPU aus einem GPU-Prepass, kein JS-Noise-Spiegel.** Der WGSL-Noise (sin-Hash,
  f32) lässt sich in JS (f64-Sin) nicht bit-exakt spiegeln → Level-Mismatch an den Straßen.
  Stattdessen: derselbe Shader mit `res=128`, `roadCount=0` → 64 KB-Readback des Roh-Terrains;
  `res` ist schon ein Uniform, der Shader ist resolutionsunabhängig.
  (Alternative verworfen: Noise nach JS portieren.)
- **Routing = Dijkstra auf dem 128²-Grid** (Zelle ≈ 3.1 m). Kantenkosten:
  `length + slopePenalty·|Δh| + waterAvoid·length` (letzter nur unter `waterLevel`).
  Deterministisch (geseedete Start/Ziel-Punkte, feste Nachbar-Reihenfolge) → gleicher Seed →
  gleiche Straßen. (Alternativen verworfen: Gradienten-Walk = unkontrollierbar; A* = mehr Code für
  keinen Benefit bei 16k Knoten.)
- **Road-Level folgt dem Terrain:** pro Polyline-Punkt bilinear Geländehöhe (128²-Grid) →
  gleitender Mittelwert (Fenster `levelSmoothing`) + `roadOffset`. Im Shader linear interpoliert
  zwischen den Segment-Endpunkten. Level steckt in `roads[].z` → `vec4(x, y, level, 0)`.
  (Geändert in S3: eigenes `roadLevels: array<f32, 256>` ist im uniform-Adressraum ungültig,
  Stride < 16 B → `.clinerules/wgsl.md`; `.z` war frei, Bufferlänge bleibt.)
- **Konventionswechsel (bewusst):** „Straßen: Flattening auf `roadLevel`“ → „Flattening an das
  terrain-followende Niveau (`roadOffset` über geglätteter Geländehöhe)“. „Gewinnt über allem“
  bleibt. Parameter `roadLevel` wird zu `roadOffset` (gleicher Float-Index 20 → kein Layout-Shift
  in `Params`).
- **Glättung des Grid-Pfads:** Dijkstra-Pfade sind Treppensteg → 2× Chaikin, dann das vorhandene
  `resample()` auf 32 Punkte.
- **Road-Settings (GUI „Straßen“):** behalten: `roadCount`, `roadWidth`, `roadSlope`. Neu:
  `roadOffset` (0–10 m, Default 2), `levelSmoothing` (1–15 Punkte, Default 5),
  `slopePenalty` (0–5, Default 1.5), `waterAvoid` (0–5, Default 2). Weg: `roadLevel`.

## Datenfluss (neu)
Seed + Params → Prepass-Dispatch (128², `roadCount=0`) → Readback 64 KB (Roh-Terrain, 0–1) →
`roadgen.js`: Dijkstra Edge→Edge × N, Chaikin, resample 32 Punkte, Level-Punkte (8×32) →
Uniform-Buffer (Params + `roads` 8×32 vec4(x, y, level, 0)) → Final-Dispatch (1024²) →
Readback → 2D-Preview + 3D-Mesh (wie bisher).

## Meilensteine (eine Stufe pro Durchgang)
1. **S1 Prepass 128²** (`main.js`): `generate()` zweistufig; Readback-Helfer für Staging-Buffer;
   Prepass liefert `terrain128`. Straßen vorerst noch alt, App läuft wie heute.
   → Prüfung: Konsole-Log des Prepasses (Min/Max plausibel, ≈ Final-Pass), `npm run check` grün,
     Regeneration < 500 ms.
2. **S2 `roadgen.js`: Dijkstra + Level** (neue API `generateRoads(seed, mapSize, count, terrain,
   opts)` → `{ points, levels }`).
   → Prüfung: `roadgen.sanity.mjs` erweitert – flaches Synth-Terrain: Edge-to-Edge (Endpunkte an
     Kante ±2 m), in Grenzen, deterministisch, Länge > 200 m (Alt-Check bleibt); Hügelsynthetik:
     Mittel-Höhe entlang Pfad < Mittel-Höhe der geraden Verbindung (Umgehung wirksam);
     Level = Terrain + Offset (±0.1 m). `npm run sanity` + `npm run build` grün.
3. **S3 WGSL + Uniforms: following Level** (`heightmap.wgsl`, `uniforms.js`, `main.js`,
   `tests/uniforms.layout.mjs` im selben Zug): `roadOffset`-Rename, `distPointSeg` → `vec2(d, t)`,
   `roadF`/`roadL`-Tracking, Level in `roads[].z` (Bufferlänge unverändert
   `ROADS_OFFSET + 4·8·32`), Konsole-Zeile: Readback-Road-Level vs. CPU-Expected (±0.5 m).
   → Prüfung: `npm run check` grün; Browser: keine senkrechten Wände/Deiche mehr (visuell),
     Konsole-Zeile im Toleranzband.
4. **S4 GUI + Doku**: Straßen-Ordner neu besetzen (Entscheidung „Road-Settings“); `.clinerules`:
   Projekt-Konventionen-Zeile (Flattening), Datenfluss-Zeile (`wgsl.md` schon in S3 erledigt);
   Plan → `Plan/erledigt/`.
   → Prüfung: `npm run check` grün; alle neuen Slider triggern Regeneration.

## Scope-Ausschlüsse (bewusst nicht)
- Kein Straßennetz als Graph (Kreuzungen/Ringe) – unabhängige Polylines wie heute.
- Kein GPU-Routing, keine separate Straßen-Geometrie/Texture (nur `roadMask`-Farbe).
- `MAX_ROADS=8` / `ROAD_POINTS=32` bleiben (feste WGSL-Arrays).

## Risiken
- Enge Grate (cliffWidth ~15 m ≈ 5 Zellen) werden ggf. doch geschnitten – akzeptabel, Straßen
  müssen irgendwo durch; `slopePenalty` dämpft es.
- +1 Dispatch + 64 KB-Readback pro Regeneration: Rechenzeitbudget < 500 ms bleibt mit großem
  Abstand halten.

## Abgeschlossen
- [x] S1 Prepass 128² — geprüft am 2026-09-11
- [x] S2 roadgen.js: Dijkstra + Level — geprüft am 2026-09-11
- [x] S3 WGSL + Uniforms: following Level — geprüft am 2026-09-11 (check grün; Browser: Innen ohne Wände,
  Kerben am Rand-Ring + parallele Straßen → Plan/TerrainStrassennetz.md)
- [ ] S4 GUI + Doku — entfällt, aufgegangen in Plan/TerrainStrassennetz.md

<!-- fertig: git mv Plan/Roads.md Plan/erledigt/ -->
