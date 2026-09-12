---
paths:
  - "app/src/heightmap.wgsl"
  - "app/src/uniforms.js"
  - "app/src/main.js"
  - "app/src/erosion.wgsl"
  - "app/src/erosion.js"
  - "app/tests/**"
---
# Thema: WGSL-Compute & Uniform-Layout

## No-Gos
- NICHT Arrays mit Element-Stride < 16 B im uniform-Adressraum (`array<vec2<f32>>`, `array<f32>` sind ungültig) → Punkte als `vec4(x, y, level, 0)`, gelesen per `.xy` / `.z`.
- NICHT `struct Params` ändern, ohne `encodeUniforms()` im selben Zug 1:1 anzupassen. Die Feldreihenfolge ist der Float-Index.
- NICHT Puffer- oder Array-Längen als Zahl hinschreiben, sondern aus `MAX_ROADS`/`ROAD_POINTS` berechnen. TypedArrays verwerfen Schreibzugriffe hinter dem Ende still.
- NICHT WGSL im Browser testen ohne naga-Lauf vorher.
- NICHT das Straßen-Level vom Segment mit dem größten Gewicht nehmen, sondern vom nächstgelegenen. Innerhalb der Fahrbahn ist das Gewicht für alle nahen Segmente 1 → das erste gewinnt → Level-Treppen.
- NICHT Straßen-Böschung oder Lichtungs-Rand als feste Breite (`mix` über `smoothstep`), sondern als Neigung (Gelände per `bank()` in Kegel um das Level klemmen). Feste Breite → senkrechte Wände bei tiefen Einschnitten, Lichtungen am Hang werden Tafelberge.
- NICHT den Böschungskegel mit konstanter Neigung ins Unendliche laufen lassen, sondern die Neigung mit dem Abstand bis `SLOPE_MAX` steigern (`BANK_CURVE`). Sonst kappt er Gipfel und Seen 100 m neben der Straße, bei flachem `roadSlope` die halbe Karte.
- NICHT Noise mit `fract(sin(großes Argument))` oder mit Float-Seed-Offsets (`seed + 101.3`) hashen, sondern ganzzahlig (`mix32`, `layerKey`). `sin` ist bei großen Argumenten je GPU verschieden genau und Float-Summen können per fma anders runden. Dann ergibt derselbe Seed auf einer anderen GPU ein anderes Terrain.
- NICHT den Noise-Hash ändern, ohne `SAVE_VERSION` (main.js) hochzuzählen, `tests/noise.mjs` nachzuziehen und die Statistik in `uniforms.js` neu zu messen.
- NICHT `tanh` mit unbegrenztem Argument aufrufen, sondern auf ±10 klemmen. Manche GPUs rechnen `tanh` über `exp` → Überlauf → NaN in der Heightmap.
- NICHT Lichtungen als exakten Kreis mit hartem `clamp` formen, sondern Radius per Noise variieren und weich sättigen (`e·tanh(Δ/e)`). Der Kreis mit Knick am Rand liest sich von oben sofort als gestanzte Scheibe.
- NICHT zwischen `writeBuffer`, Dispatch und Readback-Kopie ein `await` setzen (`computeMap`). Uniform- und Storage-Puffer sind geteilt; nur die ununterbrochene Folge hält die Queue-Reihenfolge je Pass richtig.
- NICHT GPU-Folgen (`computeMap`, Flow-Export) überlappend starten, sondern über `serial()`. `erosion.delta` muss über das await des Prepass bis zum Final-Pass stehen bleiben; eine parallele Seed-Vorschau überschreibt es.
- NICHT `erosionDelta` sampeln, wenn die Erosion aus ist (`erosionOn = 0`). Nur der unveränderte Pfad hält alte Presets, Saves und Links bitgleich.
- NICHT in einem Erosions-Kernel Nachbarn aus einem Puffer lesen, den derselbe Kernel schreibt, sondern Ping-Pong (`b`/`bTmp`, `sedTmp`). Sonst hängt das Ergebnis von der Thread-Reihenfolge ab → nicht deterministisch.
- NICHT Sediment semi-Lagrange verschieben, sondern mit demselben Anteil wie das Wasser über die Rohre (`carry`). Semi-Lagrange ist nicht massenerhaltend und verlor ~40 % des bewegten Materials.
- NICHT mehr als 8 Storage-Puffer in ein Modul binden (WebGPU-Default `maxStorageBuffersPerShaderStage`). Erosion packt Wasser, Sediment, |v| und Wasser-vor-Fluss in ein `vec4`.
- NICHT `struct E` (erosion.wgsl) ändern, ohne `EROSION_FIELDS` im selben Zug anzupassen. Die Feldreihenfolge ist der Float-Index, der Layout-Test prüft beide.
- NICHT Winkel ± Variation hinterher klemmen, sondern die Variation auf den Abstand zur Grenze begrenzen. Sonst klebt der Winkel an 10° bzw. 60° und der Regler wirkt an den Enden nicht.

## Layout-Regeln (uniform)
1. Array-Element-Stride = Vielfaches von 16 B.
2. Offset von Mitglied i+1 = `roundUp(Ende von i, Align(i+1))`.
3. Nach einem Struct-Mitglied S liegt das nächste bei `≥ roundUp(16, Größe(S))`. naga rundet hier nicht auf, sondern meldet einen Fehler.

Aktuell: `Params` = 30 × f32 = 120 B → `roads` ab Byte 128 = Float-Index 32; `roads` = `MAX_ROADS × ROAD_POINTS` vec4 (x, y, level m, 0);
`towns` = `MAX_TOWNS` vec4 (x, y, level m, 0) direkt dahinter (`TOWNS_OFFSET`), Puffer = `UNIFORM_FLOATS`. Layout-Test `tests/uniforms.layout.mjs`.
`rivers` = `MAX_RIVERS × RIVER_POINTS` vec4 (x, y, Spiegel m, halbe Breite m) hinter `towns` (`RIVERS_OFFSET`); Uniform ≤ 64 KiB.
Bindings: 3 `erosionDelta` (EROSION_RES²), 4 `water` (res², 0 = Meer), 5 `lakes` (`LAKE_RES` = `PRE`²) (→ `.clinerules/hydro.md`).
Erosion: `struct E` = `EROSION_FIELDS` (nur f32), Puffer `EROSION_FLOATS` = auf 16 B aufgerundet; Gitter `EROSION_RES` in uniforms.js, heightmap.wgsl und erosion.wgsl (`N`) gleich.

## Symptome
Readback nur Nullen oder „road level Infinity“ → Shader-Modul abgelehnt (Browser-Konsole) oder Params-Reihenfolge JS ≠ WGSL
(`roadCount` liest dann ein falsches Feld → 0 Straßen).
Firefox „featureLevel: compatibility … not yet supported“ (three.webgpu.js) → NICHT debuggen: beabsichteter Core-Fallback (Firefox-Bug 1905951).

## Werkzeuge
- naga: `C:\naga-proj\target\debug\naga-runner.exe app\src\heightmap.wgsl` → `VALID` oder Fehlerkette
- `npm run sanity` (Node, ohne Browser)
- Browser-Konsole: Stats `Heightmap 1024²: …`, `Roads: … road level …` und `Road level GPU vs. CPU: …` sind der Readback-Test
