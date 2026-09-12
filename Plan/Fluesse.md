# Plan: Flüsse und Seen (R16)

**Status:** in Arbeit
**Datum:** 2026-09-12

## Ziel
Flüsse entstehen aus der Abflussakkumulation des Geländes (inkl. Erosion R15) und laufen bergab in Seen, ins Meer
(unter `waterLevel`) oder bis zum Ringfuß. Senken werden Bergseen mit eigenem Spiegel. Im 3D gibt es erstmals einen echten
Wasserspiegel; 2D-Vorschau, Splatmap (Kanal B) und Straßen kennen das neue Wasser. Straßen liegen nie unter Wasser.

## Entscheidungen
- **Hydrologie auf der CPU auf dem 128²-Prepass** (dasselbe Gelände, auf dem die Straßen routen: roh + Erosion + Rand-Ring)
  → `src/hydro.js`, ohne DOM, in Node testbar. Priority-Flood (Barnes 2014) von den Abflüssen: Zellen unter `waterLevel`
  (Meer) und die Randzone (Ringfuß, wie die Ausfahrten). Senken füllen sich bis zum Überlauf → Seen mit eigenem Spiegel.
  Fließrichtung = Zelle, von der aus geflutet wurde → auch über flache Seen eindeutig; Akkumulation in umgekehrter Flutreihenfolge.
  Ohne Abfluss am Rand würde der geschlossene Rand-Ring die ganze Map zu einem See bis zur tiefsten Scharte füllen.
- **Flüsse als Polylinien im Uniform wie die Straßen** (`MAX_RIVERS` × `RIVER_POINTS`, `vec4(x, y, Spiegel m, halbe Breite m)`):
  Quelle = Zelle über der Einzugsgebiets-Schwelle ohne Fluss-Zufluss, dem Abfluss folgen bis See/Meer/Ringfuß oder Mündung in
  einen schon verfolgten Fluss; die größten zuerst; Chaikin-Glättung; Spiegel entlang des Laufs nie steigend.
  Breite wächst mit √Einzugsgebiet bis `riverWidth`, Tiefe = ¼ Breite.
- **Seen als 128²-Spiegelfeld** (Storage-Puffer, 0 = kein See); im Shader Maximum über die 3×3-Nachbarzellen (Dilatation) →
  das Ufer ist die 1024²-Höhenlinie auf Spiegelhöhe, keine 3-m-Treppe. Senken unter `LAKE_MIN_AREA` m² oder
  `LAKE_MIN_DEPTH` m bleiben trocken (sonst hunderte Pfützen aus dem Noise).
- **Shader:** nach Rand-Ring, vor den Straßen: Flussbett parabolisch bis Spiegel − Tiefe, daneben Ufer per `bank()` wie die
  Straßen-Böschung (nur abtragen, nie aufschütten). Neuer Ausgang `water` (res², Wasserspiegel m) = max(`waterLevel`,
  See-Spiegel, Fluss-Spiegel im Bett + 1 m). Straßen danach wie heute → an Kreuzungen füllt der Straßendamm das Bett (Durchlass).
- **Straßen nie unter Wasser:** Routing-Strafe `waterAvoid` auch auf See- und Flusszellen; Straßen-Level ≥ örtlicher Spiegel +
  `roadTolerance` + 0,3 m (verallgemeinert die heutige `waterLevel`-Regel); Orte nicht auf nassen Zellen.
- **Aus = bitgleich:** `riverCatchment` 0 (Default) → keine Flüsse, keine Seen, `water` = `waterLevel` → heights, roadMask,
  Vorschau, Splatmap wie vorher. Neue Schlüssel fehlen in alten Links → 0 = aus.
- **Wasser = `h < water[i]`** statt `h < waterLevel` in Vorschau-Farbe, Splatmap (B), Statistik. Farbformel `t = h / W`
  → bei W = `waterLevel` exakt die alte.
- **3D-Wasserspiegel:** eigenes TN²-Mesh mit y = `water` (bilinear wie das Terrain), halbtransparent, glatt; unter dem Gelände
  verdeckt der Tiefentest → keine Maske nötig. glTF-Export bleibt nur das Terrain (`// vereinfacht:`).
- **Regler (Tab World, Gruppe „Rivers & lakes“):** `riverCatchment` % der Map-Fläche als Einzugsgebiet einer Quelle (0 = aus),
  `riverWidth` m (Breite an der größten Mündung), `lakeArea` m² Mindestfläche eines Bergsees (0 = keine Bergseen).
- Seed-Vorschau läuft über `computeMap` → bekommt Flüsse automatisch.

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. F1 `hydro.js`: Priority-Flood, Fließrichtung, Akkumulation, Seen, Fluss-Polylinien → Prüfung: Test `hydro.test.mjs`
   (geneigte Ebene mit Tal: Fluss im Tal, Spiegel nie steigend, endet am Abfluss; Grube → See mit Überlauf-Spiegel;
   deterministisch; ≤ 30 ms bei 128²)
2. F2 Shader + Uniform: rivers-Array, `riverCount`, See-Puffer, `water`-Ausgang, Bett + Ufer → Prüfung: naga, Layout-Test,
   aus = alle Presets bitgleich (headless Hash)
3. F3 Einbindung: `computeMap` → hydro → roadgen (Strafe, Level ≥ Spiegel, Orte trocken) → Uniform; Regler; Vorschau,
   Splatmap, Statistik mit `water` → Prüfung: `check`; headless: Flüsse laufen bergab ins Wasser, 0 Straßenpixel unter dem
   örtlichen Spiegel, aus = bitgleich inkl. Vorschau-Pixel
4. F4 3D-Wasserspiegel → Prüfung: Screenshots fern + nah (Lakes, Defaults + Flüsse, Mountains + Flüsse), kein Wasser über
   Land außerhalb von Bett/See
5. F5 Tuning + Preset „River valley“ → Prüfung: Screenshots, Seed-Vergleich Kachel ≈ große Map
6. F6 Doku: `.clinerules/hydro.md` (paths: hydro.js, Test), wgsl.md-Layout → Prüfung: `check` grün

## Abgeschlossen
- [x] F1 hydro.js (Priority-Flood mit `minHeap`, `chaikin`, `resample` aus roadgen exportiert; Test: Tal-Fluss bis Ringfuß,
  Spiegel fallend, Breite bis riverWidth, Grube → See auf Überlauf-Höhe, Meer-Mündung, aus = nichts, verrauscht 15,5 ms,
  deterministisch) — geprüft am 2026-09-12
- [ ] F2 Shader + Uniform — geprüft am
- [ ] F3 Einbindung — geprüft am
- [ ] F4 3D-Wasserspiegel — geprüft am
- [ ] F5 Tuning + Preset — geprüft am
- [ ] F6 Doku — geprüft am

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
