# Plan: Erosion auf der GPU + Flow-Map (R15)

**Status:** in Arbeit
**Datum:** 2026-09-12

## Ziel
Hydraulische + thermische Erosion auf der GPU formt das Roh-Terrain (Hügel, Berge, Klippen) zu Rinnen, Schuttkegeln und
weicheren Hängen, bevor Straßen, Lichtungen und Rand-Ring darübergelegt werden. Nebenprodukt: Flow-Map (wo Wasser lief)
als Export für Unreal und als Maske für R11/R16.

## Entscheidungen
- **Gitter-Wassermodell (virtual pipes, Mei 2007) statt Tropfen-Partikel** → jede Zelle liest nur Nachbarn (gather), keine
  Atomics, kein Wettlauf → gleicher Seed = gleiche Map auf jedem Durchlauf. Tropfen bräuchten Float-Atomics (gibt es in WGSL
  nicht) oder die CPU (~1 s je Regeneration).
- **Festes Erosions-Gitter `EROSION_RES` = 512² (0,78 m)**, unabhängig von der Ausgabe-Auflösung → große Map (1024²),
  Prepass (128²) und Seed-Vorschau (256²) sehen dieselbe Erosion. Gespeichert wird nur `delta = erodiert − roh` (m);
  Prepass und Final-Pass rechnen das Roh-Terrain weiter analytisch und addieren `delta` bilinear → 1024²-Noise-Detail bleibt.
- **Erosion aus (Stärke 0) = heutiger Pfad** (Flag im Uniform, kein Sampling) → alle Presets, Saves und Share-Links bitgleich,
  `SAVE_VERSION` bleibt 2. Neue Schlüssel fehlen in alten Links → Default 0 = aus.
- **Straßen routen auf dem erodierten Gelände:** Prepass 128² = roh + `delta` → Level und Böschungen passen zum Rinnen-Relief.
  Straßen, Lichtungen, Rand-Ring kommen danach wie heute → Straßen gewinnen weiter.
- Rand-Ring wird nicht erodiert (kommt nach der Erosion) → `// vereinfacht:` bis der User es anders will.
- Rand des Erosions-Gitters offen (Wasser fließt ab) → kein Stau an der Map-Kante.
- **Thermisch:** Material rutscht, wo die Neigung über dem Schuttwinkel liegt (gather, massenerhaltend: Fluss a→b wird in a
  und b aus denselben Werten gerechnet). Läuft in jeder Iteration nach dem Wasser-Schritt.
- **Regler (Tab Terrain, Gruppe „Erosion“):** `erosionStrength` % (0 = aus, Default 0), `erosionIterations` (Dauer, Default 300),
  `screeAngle` ° Schuttwinkel (Default 90 = aus: bei 40–60° werden Abrisskanten zu stumpfen Schutthängen, Canyon-Screenshots).
  Übrige Konstanten in `EROSION_FIELDS`, nach Screenshots gestimmt.
- **Sediment wandert mit dem Wasser über dieselben Rohre** (Anteil = abfließendes Wasser / Zellwasser) statt semi-Lagrange →
  massenerhaltend; semi-Lagrange verlor ~40 % der bewegten Masse. Ablage langsam (0,02/Schritt), sonst füllt das Sediment
  die Rinnen sofort wieder. Tiefes Wasser (> 0,3 m) trägt nicht ab → Rinnen an den Flanken statt Gräben in den Tälern.
- Eigenes Shader-Modul `erosion.wgsl` mit eigenem kleinem Uniform (`EROSION_FIELDS` in `uniforms.js`, Layout-Test wie Params).
- **Flow-Map:** Summe über die Iterationen von Wassertiefe × |v| je Zelle (512²), Export 8 Bit log-skaliert (p99 = 255),
  auf Export-Größe resampelt. Erosion aus → Export lässt die Wasser-Simulation einmal ohne Abtrag laufen (Terrain unberührt).
  `// vereinfacht:` Straßen lenken das Wasser in der Flow-Map nicht um (Simulation läuft vor den Straßen).
- Präzision: `sqrt`/Division in WGSL sind nicht bit-genau über GPUs → erodierte Maps können sich zwischen GPUs minimal
  unterscheiden (auf derselben GPU identisch). Erosion aus bleibt GPU-unabhängig wie bisher.

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. E1 Shader-Umbau ohne Wirkung: `rawTerrain(w)` als Funktion, Param `erosionOn` + Binding `erosionDelta` (512² f32),
   Layout-Test → Prüfung: `check` grün, alle Presets bitgleich zu vorher (headless Hash)
2. E2 Erosion: `erosion.wgsl` (Roh-Pass 512², Regen, Pipe-Fluss, Wasser/Geschwindigkeit, Abtrag/Ablage, Sediment-Transport,
   Verdunstung, thermisch), Regler, `computeMap` ruft sie vor dem Prepass → Prüfung: naga beide Module, 2 Läufe bitgleich,
   Masse (Terrain + Sediment) ±1 %, keine NaN, Zeit ≤ 300 ms zusätzlich (R3-Anzeige)
3. E3 Tuning + Preset „Eroded mountains“ → Prüfung: Screenshots fern + nah (Mountains, Rolling hills, Canyon) mit/ohne,
   Rinnen und Schuttkegel sichtbar, keine Schachbrett-/Spitzen-Artefakte, Straßen-Level GPU vs. CPU wie ohne Erosion
4. E4 Flow-Map-Export (+ Metadaten, `export.md`), Byte-Codierung in `masks.js` mit Test → Prüfung: `sanity`, Bild hell in
   Tälern, dunkel auf Kämmen; Erosion aus → Terrain-Hash unverändert nach Export
5. E5 Seed-Vergleich mit Erosion → Prüfung: Kachel vs. große Map Ø |ΔRGB| wie in R13 (< 2/255)
6. E6 Doku: `.clinerules/wgsl.md` (Erosion-Layout, No-Gos) → Prüfung: `check` grün

## Abgeschlossen
- [x] E1 Shader-Umbau ohne Wirkung (`rawTerrain`, Entry `raw`, `erosionOn`, Binding 3; 7 Presets heights + roadMask bitgleich) — geprüft am 2026-09-12
- [x] E2 Erosion-Kernels + Regler (`erosion.wgsl` + `erosion.js`, 5 Kernel je Iteration + finish, 7 Storage-Puffer ≤ Limit 8;
  `computeMap` nacheinander statt überlappend; headless Mountains/Rolling hills/Defaults bei 50 %: 2 Läufe bitgleich, keine NaN,
  netto −0,1 % der Gesamtmasse (Abfluss über den Rand), +24 ms, Straßen-Level 0 Ausreißer; Erosion aus: 7 Presets bitgleich) — geprüft am 2026-09-12
- [x] E3 Tuning + Preset „Eroded mountains“ (Mountains + 70 % / 400 / Schutt 65°; Stärke × Dauer wirkt als Produkt, 100 % × 1000
  ergab 1-Zellen-Messergrate → Duration max. 600, 65° Schutt kappt die Grate; headless fern/mid/nah: Rinnen an den Flanken,
  Ablagerung in Talböden, Canyon-Kanten bei 90° scharf, Straße dominant, Level GPU vs. CPU 0 Ausreißer) — geprüft am 2026-09-12
- [ ] E4 Flow-Map-Export — geprüft am
- [ ] E5 Seed-Vergleich — geprüft am
- [ ] E6 Doku — geprüft am

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
