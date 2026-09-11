---
paths:
  - "app/src/heightmap.wgsl"
  - "app/src/uniforms.js"
  - "app/tests/**"
---
# Thema: WGSL-Compute & Uniform-Layout

## No-Gos
- NICHT Arrays mit Element-Stride < 16 B im uniform-Adressraum (`array<vec2<f32>>`, `array<f32>` sind ungültig) → Punkte als `vec4(x, y, level, 0)`, gelesen per `.xy` / `.z`.
- NICHT `struct Params` ändern, ohne `encodeUniforms()` im selben Zug 1:1 anzupassen. Die Feldreihenfolge ist der Float-Index.
- NICHT Puffer- oder Array-Längen als Zahl hinschreiben, sondern aus `MAX_ROADS`/`ROAD_POINTS` berechnen. TypedArrays verwerfen Schreibzugriffe hinter dem Ende still.
- NICHT WGSL im Browser testen ohne naga-Lauf vorher.
- NICHT das Straßen-Level vom Segment mit dem größten Gewicht nehmen, sondern vom nächstgelegenen. Innerhalb der Fahrbahn ist das Gewicht für alle nahen Segmente 1 → das erste gewinnt → Level-Treppen.
- NICHT Straßen-Böschung als feste Breite (`mix` über `smoothstep`), sondern als Neigung (Gelände in Kegel um das Level klemmen). Feste Breite → senkrechte Wände bei tiefen Einschnitten.
- NICHT den Böschungskegel mit konstanter Neigung ins Unendliche laufen lassen, sondern die Neigung mit dem Abstand bis `SLOPE_MAX` steigern (`BANK_CURVE`). Sonst kappt er Gipfel und Seen 100 m neben der Straße, bei flachem `roadSlope` die halbe Karte.
- NICHT Winkel ± Variation hinterher klemmen, sondern die Variation auf den Abstand zur Grenze begrenzen. Sonst klebt der Winkel an 10° bzw. 60° und der Regler wirkt an den Enden nicht.

## Layout-Regeln (uniform)
1. Array-Element-Stride = Vielfaches von 16 B.
2. Offset von Mitglied i+1 = `roundUp(Ende von i, Align(i+1))`.
3. Nach einem Struct-Mitglied S liegt das nächste bei `≥ roundUp(16, Größe(S))`. naga rundet hier nicht auf, sondern meldet einen Fehler.

Aktuell: `Params` = 25 × f32 = 100 B → `roads` ab Byte 112 = Float-Index 28; `roads` = `MAX_ROADS × ROAD_POINTS` vec4 (x, y, level m, 0), Layout-Test `tests/uniforms.layout.mjs`.

## Symptome
Readback nur Nullen oder „road level Infinity“ → Shader-Modul abgelehnt (Browser-Konsole) oder Params-Reihenfolge JS ≠ WGSL
(`roadCount` liest dann ein falsches Feld → 0 Straßen).
Firefox „featureLevel: compatibility … not yet supported“ (three.webgpu.js) → NICHT debuggen: beabsichteter Core-Fallback (Firefox-Bug 1905951).

## Werkzeuge
- naga: `C:\naga-proj\target\debug\naga-runner.exe app\src\heightmap.wgsl` → `VALID` oder Fehlerkette
- `npm run sanity` (Node, ohne Browser)
- Browser-Konsole: Stats `Heightmap 1024²: …`, `Roads: … road level …` und `Road level GPU vs. CPU: …` sind der Readback-Test
