# Plan: Roadmap – Ausbau

**Status:** in Arbeit
**Datum:** 2026-09-11

## Ziel
Alle gesammelten Ideen einbauen, sortiert von schnell nach aufwendig, sodass jede Stufe auf der vorherigen aufbaut
und nichts doppelt angefasst wird. Große Punkte (Erosion, Flüsse, Map-Größe) bekommen vor dem Start einen eigenen Detailplan.

## Entscheidungen
- Noise-Hash-Fix ganz nach vorn → ändert alle Seeds; muss vor Share-Links und Pages-Veröffentlichung stehen, sonst brechen verteilte Links.
- Undo und Share-Link teilen `pickParams`/`applyPreset` (Save/Load) → keine zweite Serialisierung.
- Export-Auflösung (2ⁿ+1) = Resampling beim Export → Rechengitter bleibt 1024²; variable Map-Größe ist ein eigener, späterer Punkt.
- Masken (Neigung, Normale, Krümmung) einmal berechnen, von Export (R8) und Texturierung (R11) gemeinsam genutzt → Unreal und Tool sehen dieselben Masken.
- Texturierung zweigleisig: Masken-Export für Unreal (Engine texturiert selbst) + Texturierung im Tool (Auto-Material wie Unreal). Export zuerst, weil klein.
- Texturen nur CC0 (ambientCG / Poly Haven), 1–2K (User 2026-09-12: 2K im Repo, 1K per Regler) → Repo und Pages-Download bleiben schlank.
- Splatmap im 3D vor glTF-Export und Texturierung → beide bauen auf der Einfärbung auf; Walk-Modus nach Texturierung → Nahansicht lohnt erst mit Texturen.
- Erosion vor Flüssen → Flüsse nutzen deren Abflussdaten; Flow-Map-Export kommt mit der Erosion.
- `GitHubPages.md` bleibt eigener Plan, kommt nach R5 dran. Pages-Workflow nur `npm run build` (naga-Runner gibt es in Actions nicht).
- Jeder Schritt = eigener Commit mit grünem `npm run check`.

## Abhängigkeiten
```
R1 ─ R2 (Hash+Version) ─┬─ R4 Undo ── R5 Share-Link ── GitHubPages.md
                        └─ R3 Zeitmessung ─────────────── R13 Seed-Vergleich, R15 Erosion
R6 RAW ── R7 Export-Auflösung ── R8 Masken-Export ──┐
R9 Splat-3D ─┬─ R10 glTF                            │
             └─ R11 Texturierung ◄──────────────────┘ (Masken)
                    └─ R14 Walk-Modus
R12 Lichtungen (unabhängig, Uniform-Layout)
R15 Erosion (+ Flow-Map) ── R16 Flüsse/Seen
R17 Map-Größe (zuletzt, berührt alle Meter-Parameter)
R18 README (ganz am Ende)
```

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)

### Stufe 0 – Fundament (schnell)
1. R1 Untracked `app/heap-probe.mjs`, `heap-prof.mjs`, `orig-roadgen.mjs`: User entscheidet löschen/behalten → Prüfung: `git status` sauber
2. R2 Noise-Hash ohne großes `sin`-Argument (Integer-Hash) in `heightmap.wgsl` + Spiegel `tests/noise.mjs`; `version` in Save- und Meta-JSON, Load warnt bei alter Version → Prüfung: `check` grün, gleiche Map auf zwei Durchläufen, `terrain.stats` neu kalibriert

### Stufe 1 – schnell (je ein Durchgang)
3. R3 Generierzeit (GPU + Roadgen) im Panel anzeigen, Button während der Arbeit gesperrt → Prüfung: Zeit sichtbar, plausibel
4. R4 Undo/Redo (Strg+Z / Strg+Y) über Snapshots von `pickParams` → Prüfung: 3 Änderungen, 3× Undo = Ausgangszustand
5. R5 Share-Link: Params im URL-Hash, beim Laden anwenden, Button „Link kopieren“ → Prüfung: Link in neuem Tab ergibt identische Map
6. R6 RAW-Export 16 Bit (`.r16`, little endian) aus den E1-Daten → Prüfung: Test in `sanity` (Größe, Min/Max)
7. R7 Export-Auflösung wählbar (1024, 513, 1025, 2049) mit bilinearem Resampling für PNG16/RAW/Splatmap; Metadaten angepasst → Prüfung: Dateigrößen stimmen, Ecken = Ecken des Originals
8. R8 Masken-Export für Unreal: Slope Map (Grad → 0–255), Normal Map (RGB, Konvention in Metadaten), Krümmung/AO (Kamm hell, Mulde dunkel); Masken-Funktionen in eigenem Modul, von R11 wiederverwendet → Prüfung: Test in `sanity` (ebene Fläche = Slope 0 / Normale nach oben, Rampe = bekannter Winkel), Import-Hinweis in `export.md`

### Stufe 2 – mittel
9. R9 Splatmap-Farben im 3D-Mesh (Straße/Fels/Wasser/Gras, gleiche Rampe wie Export) → Prüfung: Screenshot headless, Straßen im 3D erkennbar
10. R10 Mesh-Export glTF (`GLTFExporter`, mit Farben aus R9, Maßstab 1 Unit = 1 m) → Prüfung: Datei lädt in three/Blender, Maße 400 m
11. R11 Texturierung im Tool (Auto-Material): CC0-Texturen Gras/Fels/Kies/Sand/Schnee/Straße, Schichten über Masken aus R8 (Neigung, Höhe, Krümmung), Triplanar für steile Hänge, Detail-Normals; je Schicht Regler (z. B. „Fels ab °“, „Schnee ab m“) → Prüfung: Screenshots headless nah + fern, keine Streckung an Klippen, Framerate ok. Detailplan: `Plan/Texturierung.md` (freigegeben)
12. R12 Orte als flache Lichtungen (Radius + Übergang, Straßen gewinnen weiter) → Uniform-Layout-Test anpassen → Prüfung: `uniforms.layout` grün, Lichtungen sichtbar
13. R13 Seed-Vergleich: N Vorschauen aus dem 128²-Prepass, Klick übernimmt Seed → Prüfung: Vorschau entspricht der großen Map
14. R14 Walk-Modus (Pointer-Lock, Augenhöhe 1,7 m aus Heightmap, ESC zurück) → Prüfung: laufen auf der Straße ohne Einsinken

### Stufe 3 – groß (vor Start je eigener Detailplan)
15. R15 Erosion auf GPU (thermisch + hydraulisch, Mehrfach-Pass vor dem Straßen-Pass, Regler für Stärke/Iterationen) + Flow-Map-Export (Maske für R11 und Unreal) → Prüfung: Zeit aus R3 im Rahmen, Straßen unverändert dominant
16. R16 Flüsse und Seen aus Abflussakkumulation (nutzt R15), Wasser in Splat B → Prüfung: Flüsse laufen bergab ins Wasser, keine Straße unter Wasser
17. R17 Map-Größe variabel (≠ 400 m) → Prüfung: alle Meter-Parameter behalten ihre Bedeutung, Tests grün bei 2 Größen

### Stufe 4 – Abschluss
18. R18 README: neuer Screenshot (liefert User), Feature-Liste, Pages-Link → Prüfung: README rendert auf GitHub

## Abgeschlossen
- [x] R1 Untracked-Dateien (gelöscht) — geprüft am 2026-09-11
- [x] R2 Noise-Hash + Version (Statistik neu gemessen, Abweichung < 1 %; 10 Seeds alt/neu gleich verteilt) — geprüft am 2026-09-11
- [x] R3 Generierzeit (Statuszeile GPU/Roads/Total, ↻ gesperrt; headless: GPU 6–8 ms, Roads 9–21 ms, Total ~160 ms) — geprüft am 2026-09-12
- [x] R4 Undo/Redo (headless: Seed + Slider + Preset, 3× Undo = Start, Redo, neuer Zweig kappt Redo) — geprüft am 2026-09-12
- [x] R5 Share-Link (URL-Hash = aktueller Stand, Button „Link“; headless: neuer Tab pixelgleich, hashchange, Version-1-Warnung) — geprüft am 2026-09-12
- [x] R6 RAW-Export (`src/export.js`, Test `raw.test.mjs`; headless: .r16 = 1024²·2 Byte, wertgleich zu PNG16) — geprüft am 2026-09-12
- [x] R7 Export-Auflösung (1024 = Original, 513/1025/2049 = Vertex-Gitter auf den Map-Ecken; headless: Größen, Ecken, Splat Σ255, PNG = RAW) — geprüft am 2026-09-12
- [x] R8 Masken-Export (`src/masks.js`, Test `masks.test.mjs`; Normal DirectX, Krümmung ±10 m mit p99-Skala je Map statt fest ±3 m — Presets 0,8–16 m; headless Mountains 1024/2049 < 1,4 s, Bilder plausibel; Import-Hinweise in `.clinerules/export.md` + Meta `masks`) — geprüft am 2026-09-12
- [x] R9 Splatmap im 3D (Rampe war schon als 512²-Vertex-Farben da → Straßenränder Sägezahn; jetzt 1024²-Preview als `DataTexture` mit Mipmaps, Farbwechsel ohne Mesh-Neubau; headless Favorite/Mountains/Lakes fern + nah: Ränder glatt, Farben gleich hell) — geprüft am 2026-09-12
- [x] R10 glTF-Export (`.glb` = angezeigtes 512²-Mesh + 1024²-Textur eingebettet, ~16 MB, 0,7 s; headless: GLTFLoader lädt, Textur pixelgleich zur Preview, UV (0,0) an Ecke −200/−200; Blender 5.1: 400,0 × 400,0 m, 262 144 Vertices, Textur sRGB) — geprüft am 2026-09-12
- [ ] R11 Texturierung im Tool — geprüft am
- [x] R12 Lichtungen (`clearingRadius` 15 m, Level = Mittel der Straßen-Enden am Ort, Rand per `bank()` wie die Straßen-Böschung statt fester Breite — erster Versuch mit `smoothstep` ergab Tafelberge; `towns` hinter `roads` im Uniform, `UNIFORM_FLOATS`; Layout- + Sanity-Test; headless 4 Presets: Kern flach ≤ Toleranzband, Radius 0 = alter Stand bis 1 ULP) — geprüft am 2026-09-12. Nachtrag (User: zu prominent): Default 8 m, Rand ab 15°
(`CLEARING_BANK`) statt Straßen-Böschungswinkel; Start-Landschaft flaches Hügelland mit ~5 % Wasser, Presets bitgleich.
Nachtrag 2 (User: Kreise noch sichtbar → organisch): Radius per Noise ±50 %, weiche Sättigung `e·tanh(Δ/e)`, 0,5 m Restwelle;
headless: von oben keine Kreise mehr (auch Radius 15 im Berg-Terrain), Kern-Spanne 4,6–6,2 m → 0,1–1,4 m
- [x] R13 Seed-Vergleich (Button ⊞: 12 Kacheln, erste = aktueller Seed, More / Esc; dieselbe Pipeline `computeMap` wie die große Map, Final-Pass 256²; headless: 12 Kacheln 254 ms, Kachel vs. große Map Ø 0,7/255 und Straßen 100 % deckungsgleich (fremder Seed 15,5/255 · 4 %), Klick übernimmt Seed + URL, große Map bitgleich zu vorher) — geprüft am 2026-09-12
- [x] R14 Walk-Modus (`src/walk.js`, Button 🚶: Start am Orbit-Ziel, Maus/WASD/Pfeile, Shift = rennen 15 m/s, Esc zurück;
  Höhe aus dem angezeigten Mesh; headless Favorite + Mountains: 16 m auf der Straße, Augenhöhe 1,700 m konstant, Orbit-Kamera nach Esc
  identisch) — geprüft am 2026-09-12
- [x] R15 Erosion + Flow-Map (Detailplan `Plan/erledigt/Erosion.md`: Rohr-Modell + thermisch auf festem 512-Gitter, delta
  additiv, aus = bitgleich; +24 ms bei 300 Iterationen; Preset „Eroded mountains“; Flow-Map-Export log/p99) — geprüft am 2026-09-12
- [ ] R16 Flüsse/Seen — geprüft am
- [ ] R17 Map-Größe — geprüft am
- [ ] R18 README — geprüft am

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
