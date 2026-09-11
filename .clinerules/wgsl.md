---
paths:
  - "app/src/heightmap.wgsl"
  - "app/src/uniforms.js"
  - "app/tests/**"
---
# Thema: WGSL-Compute & Uniform-Layout

## No-Gos
- NICHT Arrays mit Element-Stride < 16 B im uniform-Adressraum (`array<vec2<f32>>` ist ungültig) → Punkte als `vec4(x, z, 0, 0)`, gelesen per `.xy`.
- NICHT `struct Params` ändern, ohne `encodeUniforms()` im selben Zug 1:1 anzupassen. Die Feldreihenfolge ist der Float-Index.
- NICHT Puffer- oder Array-Längen als Zahl hinschreiben, sondern aus `MAX_ROADS`/`ROAD_POINTS` berechnen. TypedArrays verwerfen Schreibzugriffe hinter dem Ende still.
- NICHT WGSL im Browser testen ohne naga-Lauf vorher.

## Layout-Regeln (uniform)
1. Array-Element-Stride = Vielfaches von 16 B.
2. Offset von Mitglied i+1 = `roundUp(Ende von i, Align(i+1))`.
3. Nach einem Struct-Mitglied S liegt das nächste bei `≥ roundUp(16, Größe(S))`. naga rundet hier nicht auf, sondern meldet einen Fehler.

Aktuell: `Params` = 21 × f32 = 84 B → `roads` ab Byte 96 = Float-Index 24; `roads` = `MAX_ROADS × ROAD_POINTS` vec4, Layout-Test `tests/uniforms.layout.mjs`.

## Symptome
Readback nur Nullen oder „Road-Level Infinity“ → Shader-Modul abgelehnt (Browser-Konsole) oder Params-Reihenfolge JS ≠ WGSL
(`roadCount` liest dann ein falsches Feld → 0 Straßen).

## Werkzeuge
- naga: `C:\naga-proj\target\debug\naga-runner.exe app\src\heightmap.wgsl` → `VALID` oder Fehlerkette
- `npm run sanity` (Node, ohne Browser)
- Browser-Konsole: Stats `Heightmap 1024²: …` und `Straßen: … Road-Level …` sind der Readback-Test
