# CLAUDE.md — WebGPU Heightmap Generator

## Projekt
Prozeduraler Heightmap-Generator auf WebGPU-Compute (WGSL): 1024×1024 Float32 für eine 400×400-m-Map.
Features: Straßen, Abrisskanten, Hügel, Berge, Hügel-Ring um die Map-Kante.
Live-Tuning per GUI, Seed-basiert regenerierbar.

## Struktur
- `CLAUDE.md` — diese Datei: Kontext & Konventionen. **Kein Status.** (Status: `git log` + `Plan/`)
- `.clinerules/` — Regeln für KI-Sessionen (autogeladen)
- `Plan/` — Baupläne. Vorlage: `_TEMPLATE.md`. Fertig: `erledigt/`.
- `rules/` — Detaildateien je Thema: Begründung der No-Gos (Zahlen, Fehler, Tests). Vor Änderung
  des Themas lesen – Zuordnung über die Themen-Tabelle unten.
- `app/` — die komplette App (Vite + three.js)

## Kommandos (in `app/`)
    npm install
    npm run dev        # → http://localhost:5173
    npm run build      # Produktions-Build als Smoke-Test
    npm run sanity     # roadgen-Sanity in Node (ohne Browser)

## Tech-Stack
- three.js (WebGPURenderer) — Version: `app/package.json`
- Vite
- WGSL (Compute Shader) — Heightmap-Generierung 100 % auf GPU

## Datenfluss
Seed + Parameter → CPU `app/src/roadgen.js` (Straßen-Polyline)
→ Uniform-Buffer → WGSL-Compute `app/src/heightmap.wgsl` (Workgroup 16×16)
→ Storage-Buffer (`heights` + `roadMask`, je 4 MB) → Readback (Staging, MAP_READ)
→ 2D-Preview (DOM-Canvas 1024², Farbcodierung) + 3D `BufferGeometry` (512² Vertices, computeVertexNormals)

## Konventionen
- 1 Unit = 1 Meter; Höhen normalisiert 0–1; Wasser-Spiegel 15 m
- Terrain-Parameter (Scale, Amplitude, Breite) **in Metern**, nicht in UV
- Straßen: Flattening auf `roadLevel`, gewinnt über allem Untergrund
- 3D-Geometry CPU-seitig aus Heightmap bauen (nicht `displacementMap`) → korrekte Normals
- three.js WebGPU-API ändert sich zwischen Versionen → vor API-Änderungen `app/package.json` prüfen

## Pitfalls
- `WebGPURenderer` ist asynchron: `await renderer.init()` vor jeder Nutzung; Device über `renderer.backend.device`, Queue über `device.queue` (Standard-WebGPU) — `renderer.gpu` existiert in r186 nicht
- WebGPU: `maxWorkgroupSizeTotal = 256` → Workgroup 16×16, **kein** 64×64
- Readback: Staging-Buffer `MAP_READ` + `copyBufferToBuffer` + `mapAsync` + `getMappedRange().slice(0)`
- `queue.writeBuffer` braucht `COPY_DST` auf dem Ziel-Buffer (sonst bleibt der Buffer still bei 0 → alle Parameter null → WGSL liefert Nullen)

## No-Gos (Satz = Verbot + Datum + Zeiger; Begründung und Zahlen in rules/<thema>.md)
- NICHT `array<vec2<f32>>` o. ä. mit Element-Stride < 16 B im uniform-Adressraum deklarieren (2026-07-10 → rules/wgsl.md)
- NICHT WGSL-Änderungen ohne naga-Prüflauf (`C:\naga-proj\target\debug\naga-runner.exe app\src\heightmap.wgsl`) im Browser testen (2026-07-10 → rules/wgsl.md)
- NICHT Felder von `struct Params` in `heightmap.wgsl` ändern, ohne `encodeUniforms()` in `main.js` im selben Zug 1:1 anzupassen (2026-07-10 → rules/wgsl.md)

## Themen-Tabelle (Thema | Dateien | Detaildatei)
| Thema | Dateien | Detaildatei |
|---|---|---|
| WGSL-Compute, Uniform-Layout, Readback | `app/src/heightmap.wgsl`, `app/src/main.js` (`encodeUniforms`, Readback) | `rules/wgsl.md` |
| Straßen-Generierung (CPU) | `app/src/roadgen.js`, `app/tests/roadgen.sanity.mjs` | – |
| Preview & 3D-Rendering | `app/src/main.js` | – |
