# Build-Plan: WebGPU Heightmap Generator

**Status:** offen
**Datum:** 2026-07-10

## Ziel
Prozeduraler Heightmap-Generator auf WebGPU-Compute: 1024×1024 f32-Heightmap für eine
400×400-m-Map. Features: Straßen, Abrisskanten, Hügel, Berge, Hügel-Rand um die Map-Kante.
Live-tunerbar (GUI), Seed-basiert regenerierbar (< 500 ms), Heightmap als 2D-Preview + 3D-Mesh.

## Parameter (Defaults)
| Feature | Parameter | Default |
|---|---|---|
| Basis | Grundniveau | 30 m |
| Hügel | Amplitude / Wellenlänge | 8 m / 120 m |
| Berge | Amplitude / Wellenlänge / Cluster | 60 m / 180 m / 220 m |
| Abrisskanten | Drop / Wellenlänge / Kantenbreite / Vorkommen | 20 m / 90 m / 15 m / 160 m |
| Straßen | Anzahl / Breite / Böschung / Niveau | 4 / 10 m / 5 m / 26 m |
| Rand-Ring | Höhe / Übergangszone / Rauheit | 40 m / 45 m / 90 m |
| Global | maxH (Normalisierung) / Wasser-Spiegel | 120 m / 15 m |

## Datenfluss
Seed + Parameter (GUI) → CPU `roadgen.js`: Straßen-Polyline (mulberry32-Seed, Random Walk,
äquidistant auf 32 Punkte resampled, max. 8 Straßen)
→ Uniform-Buffer (Params + Road-Punkte 8×32×vec2)
→ WGSL-Compute (1024×1024, Workgroup 16×16) → Storage-Buffer `heights` (0–1) + `roadMask` (0–1)
→ Readback (Staging MAP_READ, 8 MB)
→ 2D-Preview (DOM-Canvas 1024², Farbcodierung: Wasser/Sand/Gras/Fels/Schnee/Straße)
→ 3D: `BufferGeometry` 512×512, bilinear gesampelt, `computeVertexNormals()`, vertexColors

## WGSL-Design (Layer-Reihenfolge pro Pixel, in Metern)
1. **Basis/Hügel**: `baseLevel + fbm(w·hillScale) · hillAmp/2`
2. **Berge**: `smoothstep(0.35, 0.65, fbm(w·maskScale)) · ridge(w·mountainScale) · mountainAmp`
3. **Abrisskanten**: Plateau-Technik: `fbm(w·cliffScale)` durch schmales `smoothstep`-Band →
   flache Plateaus mit steilen Bruchkanten, per eigener Maske gemischt
   - vereinfacht: Meter → Noise-Band über Gradient ≈ 0.5 × Scale
4. **Rand-Ring**: `(1 − smoothstep(0, rimZone, edgeDist))` × noise-modulierte Anhöhe Richtung Kante
5. **Straßen**: Min-Distanz Punkt→Segment über alle Polyline-Punkte;
   `roadF = 1 − smoothstep(halbBrt, halbBrt + böschung, d)`; `h = mix(h, roadLevel, roadF)` — gewinnt über allem
6. Normalisierung `clamp(h / maxH, 0, 1)`; `roadMask = roadF`

Noise in WGSL selbst: Hash (sin), 2D-Value-Noise (cubic), fBm (5 Oktaven), Ridge — kein externes Asset.

## Meilensteine (Scope-Regel: Prüfung der Stufe, dann nächste)
1. **M1 Setup**: `app/` Vite + three.js, leere Szene mit WebGPURenderer, OrbitControls, Licht →
   Prüfung: `npm run build` fehlerfrei; Renderer läuft im Browser ohne Konsole-Fehler
2. **M2 Terrain**: Compute-Shader (Basis/Hügel/Berge/Abrisskanten/Rand-Ring), Readback, 2D-Preview →
   Prüfung: Konsole-Stats (Min/Max/Ø/Wasser %) plausibel; Preview zeigt alle Layer; `npm run build` fehlerfrei
3. **M3 Straßen**: `roadgen.js` (Seed-Polyline), Road-Uniform, Flattening + roadMask →
   Prüfung: Node-Sanity von roadgen (32 Punkte/Straße, in Map-Grenzen); Road-Level im Readback konstant (±0.5 m); Straßen sichtbar in Preview
4. **M4 3D-Terrain**: `BufferGeometry` 512² + Normals + vertexColors →
   Prüfung: Mesh folgt Heightmap, korrekt gelichtet, OrbitControls flüssig
5. **M5 GUI + Export**: lil-gui (alle Parameter + Seed, debounced Regenerieren), PNG-Export (Graustufen) →
   Prüfung: Slider-Regenerierung < 500 ms; PNG entspricht Preview
6. **M6 Doku**: CLAUDE.md final (three-Version), Plan → `erledigt/` →
   Prüfung: neue Session findet alles allein über `.clinerules/`

## Scope-Ausschlüsse (bewusst nicht)
- Keine Gewässer-Geometrie (nur Wasser-Farbe in Preview/3D)
- Keine Texturen/Gras — nur Farbcodierung nach Höhe
- Kein TAAU (MSAA reicht für die Preview-Qualität)
