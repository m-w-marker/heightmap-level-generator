# Projekt: WebGPU Heightmap Generator

Prozeduraler Heightmap-Generator auf WebGPU-Compute (WGSL): 1024² f32 über eine Map von 200–1000 m (Default 400 m).
Straßen, Abrisskanten, Hügel, Berge, Erosion, Flüsse/Seen, Rand-Ring. Live-Tuning per GUI, Seed-basiert.

## Wo steht was
- `.clinerules/` — Regeln, werden automatisch geladen. Thema-Regeln (mit `paths:`) laden nur, wenn passende
  Dateien im Spiel sind. **Nicht manuell lesen.**
- `Plan/*.md` — offene Pläne: Ziel, Schritte, Status. `Plan/erledigt/` nur bei Bedarf.
- `git log` — was fertig ist.
- `app/` — die App (Vite + three.js, Version in `app/package.json`)

## Kommandos (in `app/`)
`npm run dev` (→ localhost:5173) · `npm run build` · `npm run sanity` · `npm run check` (alles, sobald vorhanden)

## Datenfluss
Seed + Params → (Erosion 512², `erosion.wgsl`) → Prepass 128² (ohne Straßen) → `hydro.js` (Flüsse, Seen) → `roadgen.js`
(Orte + Netz, Dijkstra → Polylines + Levels) → Uniform-Buffer → `heightmap.wgsl` (Compute 16×16)
→ Storage `heights` + `roadMask` + `water` → Readback → 2D-Preview (Canvas 1024²) + 3D-Mesh (512², `computeVertexNormals`,
Preview-Pixel als Farbtextur) + Wasserspiegel-Mesh

## Konventionen
- 1 Unit = 1 m. Höhen im Buffer normalisiert 0–1 (× `maxH`, automatisch = obere Schranke → kein Clamp oben). Wasser-Spiegel 15 m.
- Terrain-Parameter in Metern (Amplitude = p95) bzw. Abdeckung in % der Map, nicht in UV oder Noise-Einheiten.
- Straßen: Fahrbahn auf terrain-folgendem Level (geglättetes Feld + `roadOffset`), Böschung mit fester Neigung; gewinnt über allem.
- 3D-Geometrie CPU-seitig aus der Heightmap (nicht `displacementMap`) → korrekte Normals.
- Map-Größe = `params.mapSize`, NICHT 400 hart verdrahten und Meter-Konstanten nicht aus Pixeln ableiten: die Auflösung
  bleibt 1024², ein Pixel wächst mit der Map.

## Pitfalls (three r186 / WebGPU)
- `await renderer.init()` vor Nutzung. Device: `renderer.backend.device`, Queue: `device.queue` (`renderer.gpu` gibt es nicht).
- Workgroup max. 256 Threads → 16×16.
- Readback: Staging `MAP_READ` + `copyBufferToBuffer` + `mapAsync` + `getMappedRange().slice(0)`.
- `queue.writeBuffer` braucht `COPY_DST`, sonst bleibt der Buffer still auf 0.
- Die three-WebGPU-API ändert sich je Version → vor neuer API die Version in `app/package.json` prüfen.

## Ablauf
- Auftrag → offenen Plan in `Plan/` lesen, dann **nur die Dateien, die der Schritt braucht**. Nicht vorsorglich alles lesen.
- Neues Feature oder geänderte Entscheidung → erst Plan (`Plan/_TEMPLATE.md`). Plan fertig → `git mv` nach `Plan/erledigt/`.

## Doku (vor dem Commit)
- Befund / neue Regel → **nur** in die Thema-Regel `.clinerules/<thema>.md`: „NICHT …“-Zeile + höchstens 2 Sätze Warum.
  Keine Fehlergeschichte, die steht in `git log`.
- Neues Thema → neue `.clinerules/<thema>.md` mit `paths:`-Frontmatter. Neue Datei zu einem bestehenden Thema → in dessen `paths:` eintragen.
- Plan-Schritt fertig → im Plan abhaken, mit Datum.
- Kein Status in `.clinerules/`.
