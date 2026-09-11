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
- Splatmap im 3D vor glTF-Export und Walk-Modus → beide profitieren von der Einfärbung.
- Erosion vor Flüssen → Flüsse nutzen deren Abflussdaten.
- `GitHubPages.md` bleibt eigener Plan, kommt nach R5 dran. Pages-Workflow nur `npm run build` (naga-Runner gibt es in Actions nicht).
- Jeder Schritt = eigener Commit mit grünem `npm run check`.

## Abhängigkeiten
```
R1 ─ R2 (Hash+Version) ─┬─ R4 Undo ── R5 Share-Link ── GitHubPages.md
                        └─ R3 Zeitmessung ─────────────── R11 Seed-Vergleich, R13 Erosion
R6 RAW ── R7 Export-Auflösung
R8 Splat-3D ─┬─ R9 glTF
             └─ R12 Walk-Modus
R10 Lichtungen (unabhängig, Uniform-Layout)
R13 Erosion ── R14 Flüsse/Seen
R15 Map-Größe (zuletzt, berührt alle Meter-Parameter)
R16 README (ganz am Ende)
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

### Stufe 2 – mittel
8. R8 Splatmap-Farben im 3D-Mesh (Straße/Fels/Wasser/Gras, gleiche Rampe wie Export) → Prüfung: Screenshot headless, Straßen im 3D erkennbar
9. R9 Mesh-Export glTF (`GLTFExporter`, mit Farben aus R8, Maßstab 1 Unit = 1 m) → Prüfung: Datei lädt in three/Blender, Maße 400 m
10. R10 Orte als flache Lichtungen (Radius + Übergang, Straßen gewinnen weiter) → Uniform-Layout-Test anpassen → Prüfung: `uniforms.layout` grün, Lichtungen sichtbar
11. R11 Seed-Vergleich: N Vorschauen aus dem 128²-Prepass, Klick übernimmt Seed → Prüfung: Vorschau entspricht der großen Map
12. R12 Walk-Modus (Pointer-Lock, Augenhöhe 1,7 m aus Heightmap, ESC zurück) → Prüfung: laufen auf der Straße ohne Einsinken

### Stufe 3 – groß (vor Start je eigener Detailplan)
13. R13 Erosion auf GPU (thermisch + hydraulisch, Mehrfach-Pass vor dem Straßen-Pass, Regler für Stärke/Iterationen) → Prüfung: Zeit aus R3 im Rahmen, Straßen unverändert dominant
14. R14 Flüsse und Seen aus Abflussakkumulation (nutzt R13), Wasser in Splat B → Prüfung: Flüsse laufen bergab ins Wasser, keine Straße unter Wasser
15. R15 Map-Größe variabel (≠ 400 m) → Prüfung: alle Meter-Parameter behalten ihre Bedeutung, Tests grün bei 2 Größen

### Stufe 4 – Abschluss
16. R16 README: neuer Screenshot (liefert User), Feature-Liste, Pages-Link → Prüfung: README rendert auf GitHub

## Abgeschlossen
- [x] R1 Untracked-Dateien (gelöscht) — geprüft am 2026-09-11
- [ ] R2 Noise-Hash + Version — geprüft am
- [ ] R3 Generierzeit — geprüft am
- [ ] R4 Undo/Redo — geprüft am
- [ ] R5 Share-Link — geprüft am
- [ ] R6 RAW-Export — geprüft am
- [ ] R7 Export-Auflösung — geprüft am
- [ ] R8 Splatmap im 3D — geprüft am
- [ ] R9 glTF-Export — geprüft am
- [ ] R10 Lichtungen — geprüft am
- [ ] R11 Seed-Vergleich — geprüft am
- [ ] R12 Walk-Modus — geprüft am
- [ ] R13 Erosion — geprüft am
- [ ] R14 Flüsse/Seen — geprüft am
- [ ] R15 Map-Größe — geprüft am
- [ ] R16 README — geprüft am

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
