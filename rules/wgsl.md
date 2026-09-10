# WGSL-Compute & Uniform-Layout

Detaildatei zu `CLAUDE.md` (No-Gos + Themen-Tabelle). Vor Änderungen an `app/src/heightmap.wgsl`
oder `encodeUniforms()` in `app/src/main.js` vollständig lesen.

## Uniform-Layout (WGSL uniform address space) — die drei harten Regeln

1. **Array-Element-Stride muss ein Vielfaches von 16 B sein.** `array<vec2<f32>>` (Stride 8) ist
   im uniform-Adressraum ungültig → `ArrayStride { stride: 8, alignment: 16 }`. Road-Punkte
   deshalb als `vec4(x, z, 0, 0)`, im Shader per `.xy` gelesen.
2. **Mitglieds-Offsets:** Mitglied i+1 liegt bei `roundUp(Ende von i, Align(i+1))` — naga ründet
   Member-Offsets also selbst (vec4-Array → Align 16).
3. **Nach einem Strukt-Mitglied S** muss das nächste Mitglied bei `≥ roundUp(16, Größe(S))` liegen
   (`MemberOffsetAfterStruct`). naga *erhöht* den Offset dafür nicht, sondern meldet den Fehler —
   bei geringem Align des Folgeglieds (vec2-Array: Align 8) bleibt der Offset unter der Grenze.

Konsequenz für `Uniforms`: `roads` (vec4, Align 16) liegt bei **Byte 96** — `Params` hat 21
Felder (84 B), das vec4-Array wird auf 16 Byte aligniert (roundUp(84, 16) = 96). JS
(`encodeUniforms`) schreibt die Punkte deshalb ab Float 24; `u[21..23]` bleiben frei
(Buffer 540 floats). Die früheren `pad0/pad1` waren für die 22-Felder-Version (88 B) nötig;
mit der 21-Felder-Form redundant (naga validiert ohne, 2026-07-10 geprüft) → 2026-09-10
entfernt (naga + Readback-Check).

## Befund M3 (2026-07-10) — wie ein Layout-Bug sich zeigt

**Symptom:** `Road-Level: Infinity`, Readback all zeros (100 % Wasser). **Ursache:** Compute lief
nie, weil Firefox das Shader-Modul beim Validieren ablehnte (Fehler nur in der Konsole).
Zwei Fehler im Original (22-Felder-`Params`, `roads: array<vec2<f32>, 256>`):
- `ArrayStride { stride: 8, alignment: 16 }` (Regel 1)
- `Alignment(Uniform, MemberOffsetAfterStruct { index: 1, offset: 88, expected: 96 })` (Regel 3)

**Zweiter Bug (nach dem Layout-Fix):** JS-Encoding stand nicht 1:1 zur WGSL-Feldreihenfolge,
weil Felder zwischen WGSL und JS getauscht/entfernt wurden (`cliffAreaScale`) → `roadCount` wurde
als `1/rimWave = 0.011` gelesen → `u32(0.011) = 0` Straßen → `Road-Level: Infinity` *trotz*
laufendem Compute. Lektion: No-Go „Params-Feldänderung = JS im selben Zug“.

**Zahlen:** 1024² = 1 048 576 Pixel; `heights`/`roadMask` je 4 MB (f32); `roads` = 128 × vec4
= 2048 B; Uniform-Buffer 540 floats = 2160 B; Road-Level = Flattening-Niveau 26 m, gemessen
26.0–26,1 m im Firefox.

## Werkzeuge

- **naga-Validator** (30.0.1, lokal gebaut, Projekt `C:\naga-proj`):
  `C:\naga-proj\target\debug\naga-runner.exe <datei.wgsl>` → `VALID …` oder exakte Fehlerkette.
  Vor *jedem* Browser-Test auf WGSL-Änderungen — sonst ist die Firefox-Konsole das erste Diagnosemittel.
- **roadgen-Sanity** (ohne Browser): `npm run sanity` in `app/`.
- **Firefox-Readback als Test:** `npm run dev` → Konsole-Stats `Heightmap 1024²: …` und
  `Straßen: … % · Road-Level …` sind die Readback-Prüfung des Shaders.