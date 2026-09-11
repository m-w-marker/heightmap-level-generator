# Plan: Ausfahrten am Ringfuß + Reset/Presets

**Status:** fertig
**Datum:** 2026-09-11

## Ziel
Der Rand-Ring deckt den Horizont ab und bleibt geschlossen: Ausfahrten enden am Ringfuß statt per
Pass hindurchzuführen. Dazu ein Reset auf Standardwerte und Presets für typische Landschaften.

## Entscheidungen
- **Ausfahrt-Knoten am Ringfuß** (Kante + `rimZone` nach innen, dort ist `rimF` = 0) → Straße führt
  sichtbar auf den Ring zu und endet dort (Spawn/Übergang/Tunnelportal). Löst die Pässe aus
  `Plan/TerrainStrassennetz.md` T2 ab.
- **Prepass wieder mit Ring, `rimAvoid` + Pass-Absenkung + `passWidth` raus:** Der Ring im Routing-
  Gelände hält Straßen über `slopePenalty` von selbst fern → weniger Code, ein Regler weniger.
  (Verworfen: kurvige Pässe ohne Durchblick – aufwendig, wenig Nutzen.)
- **Reset = `gui.reset()`** (lil-gui setzt alle Controller auf ihre Startwerte, inkl. Seed) – kein
  eigener Defaults-Spiegel.
- **Presets = Reset + Overrides** (Teilmenge der Params, Seed also auch Standard): Hügelland,
  Weidefläche (leicht hügelig), Gebirge, Canyon/Plateaus, Seenplatte (grün mit Gewässern). Als Buttons
  im Ordner „Presets“ (Dropdown würde von `gui.reset()` mitgesetzt → onChange-Schleife).

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. **A1 Ausfahrten am Ringfuß** (`roadgen.js`, `heightmap.wgsl`, `uniforms.js`, `main.js`, Tests,
   `wgsl.md` Aktuell-Zeile): Knoten nach innen, Pass/`passWidth`/`rimAvoid` raus, Prepass mit Ring.
   → Prüfung: Sanity auf Gelände mit Ring: Ausfahrten bei `rimZone` ±0,5 m, kein Straßenpunkt tiefer
     als 2 m in der Randzone; `npm run check` grün.
2. **A2 Reset + Presets** (`main.js`, README).
   → Prüfung: `npm run check` grün; Browser: Reset stellt Standard + Seed 1337 her, jedes Preset
     regeneriert einmal und sieht nach seinem Namen aus.

## Abgeschlossen
- [x] A1 Ausfahrten am Ringfuß — geprüft am 2026-09-11 (check grün; Browser gesammelt am Ende)
- [x] A2 Reset + Presets — geprüft am 2026-09-11 (check grün)
- [x] Browser-Abnahme A1 + A2 (Ring geschlossen, Presets sehen nach ihrem Namen aus) → dann nach erledigt/

<!-- fertig: git mv Plan/PresetsAusfahrten.md Plan/erledigt/ -->
