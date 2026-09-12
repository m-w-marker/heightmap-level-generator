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
- **Regler (Tab Terrain, Gruppe „Erosion“):** `erosionStrength` % (0 = aus, Default 0), `erosionIterations` (Dauer, Default 200),
  `screeAngle` ° Schuttwinkel (Default 40). Übrige Konstanten (Regen, Verdunstung, Abtrag/Ablage) im Shader, nach Screenshots gestimmt.
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
- [ ] E1 Shader-Umbau ohne Wirkung — geprüft am
- [ ] E2 Erosion-Kernels + Regler — geprüft am
- [ ] E3 Tuning + Preset — geprüft am
- [ ] E4 Flow-Map-Export — geprüft am
- [ ] E5 Seed-Vergleich — geprüft am
- [ ] E6 Doku — geprüft am

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
