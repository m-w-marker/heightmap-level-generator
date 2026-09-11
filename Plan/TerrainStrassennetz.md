# Plan: Terrain-Kalibrierung + Straßennetz

**Status:** offen
**Datum:** 2026-09-11

## Ziel
Terrain-Regler, die wirken, was sie sagen (Meter, Flächen-%), ohne Abschneiden an `maxH`. Statt
unabhängiger Rand-zu-Rand-Straßen ein Netz zwischen Orten mit Kreuzungen, ohne Parallelspuren, mit
Pässen im Rand-Ring. Löst `Plan/Roads.md` S4 ab.

## Befund (Screenshot + Noise-Statistik 2026-09-11, 20 Seeds)
- fbm(3 Okt.) liegt p5–p95 bei −0,41…+0,37 → Berg-Maske `smoothstep(0.35, 0.65)` = 0 auf 96 % der Map,
  Kanten-Maske (0.30–0.60) = 0 auf 91 % → Regler wirken nur in Flecken, dort abrupt.
- Hügel: `fbm·0.5·hillAmp` → p95 ≈ 0,2·hillAmp (hillAmp 17 → ±3,4 m).
- `maxH` 90 < Basis + Rand + Berge → `clamp(…, 0, 1)` schneidet Rand/Gipfel flach.
- Straßen: jede einzeln Rand→Rand geroutet → gleicher billigster Korridor → Parallelspuren; Zufalls-
  Endpunkte verbinden nichts; Level-Glättung schneidet Kerben in den Rand-Ring.
- Straßenfarbe (`roadMask > 0.5`) reicht in die Böschung → `roadWidth 3` sieht aus wie ~15 m.

## Entscheidungen
- **Masken per Abdeckung:** neue Regler `mountainCoverage`, `cliffCoverage` (0–100 % der Map).
  fbm wird durch sein gemessenes σ geteilt (≈ N(0,1)); Schwelle `Φ⁻¹(1 − coverage)` rechnet die CPU
  (`uniforms.js`) und schickt sie als Uniform. (Verworfen: Perzentil aus dem Prepass = Maske müsste
  mit in den Readback, mehr Code für ±wenige %.)
- **Amplituden in Metern:** Noise-Terme durch ihr gemessenes p95 normiert → p95 der Auslenkung ≈
  Regler (`hillAmp 17` → ±17 m). σ/p95-Konstanten stehen einmal in `uniforms.js`, gemessen und
  bewacht von `tests/terrain.stats.mjs` (JS-Nachbau des WGSL-Noise – für Statistik reicht f64, anders
  als für Straßen-Levels).
- **`maxH` automatisch** = `baseLevel + hillAmp + mountainAmp + cliffDrop/2 + rimAmp` (obere
  Schranke) → nie Abschneiden oben; Regler entfällt, GUI zeigt den Wert. Unten bleibt Clamp auf 0.
- **Pässe im Rand-Ring:** Prepass ohne Rand-Ring (`rimAmp = 0`) → Routing und Levels sehen das innere
  Gelände; im Final-Pass wird `rimF` nahe Straßen abgesenkt (`smoothstep(roadHalfWidth, passWidth,
  dMin)`), Innen-Straßen meiden die Randzone über Kosten `rimAvoid` (Ausfahrten queren sie kurz).
- **Straßenfarbe nur Fahrbahn:** `roadMask` = Fahrbahn (1 m weiche Kante), Flattening-Gewicht `roadF`
  bleibt inkl. Böschung.
- **Netz statt Einzelstraßen:**
  - Knoten: `townCount` Orte im Inneren (geseedete Kandidaten, Score = flach + trocken + außerhalb
    Randzone, gierig mit Mindestabstand `townSpacing`) + `exitCount` Randausfahrten.
  - Kanten: MST (euklidisch) + `extraLinks` kürzeste Nicht-MST-Kanten für Schleifen; Ausfahrt → nächster Ort.
  - Routing nacheinander auf gemeinsamem Kostenfeld: Zellen auf bestehender Straße × `reuse` (billig),
    Nachbarband daneben teuer → spätere Straßen münden ein statt parallel zu laufen.
  - Level aus **2D-geglättetem Terrain-Feld** (Radius `levelSmoothing` m) + `roadOffset` statt
    Mittelwert entlang der Polyline → gleiche Stelle = gleiches Level, auch an Kreuzungen/Überlappung.
  - vereinfacht: überlappende Abschnitte bleiben doppelte Geometrie (Shader nimmt max) – ab Bedarf an
    Kreuzungs-Daten (z. B. Export als Graph).
  - `MAX_ROADS` 8 → 16 (Netz-Kanten > 8); Shader-Loop wächst mit, Budget Regeneration < 500 ms.
- **Scope-Ausschlüsse:** keine Brücken/Tunnel, keine Straßenklassen, kein Graph-Export.

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. **T1 Terrain-Kalibrierung** (`heightmap.wgsl`, `uniforms.js`, `main.js`-GUI Terrain-Ordner,
   `tests/terrain.stats.mjs`, Layout-Test im selben Zug): Coverage-Schwellen, Meter-Normierung, `maxH` auto.
   → Prüfung: Stats-Test über 20 Seeds: Abdeckung ±5 %-Pkt. bei 10/30/60 %, p95 der Hügel ±10 % von
     `hillAmp`, kein Pixel > 1 vor Clamp; `npm run check` grün; Browser: Regler wirken gleichmäßig.
2. **T2 Pässe + Straßenfarbe** (mit den bisherigen Straßen): Prepass ohne Ring, Ring-Absenkung an
   Straßen, `rimAvoid`, `roadMask` = Fahrbahn.
   → Prüfung: `npm run check` grün; Konsole: Road-Level GPU vs. CPU im Band; Browser: keine Kerben im
     Ring, Straßenfarbe = `roadWidth`.
3. **N1 Knoten + Kanten** (`roadgen.js`, nur CPU): Orte, Ausfahrten, MST + Extra-Kanten.
   → Prüfung: Sanity: Orte trocken/flach/außerhalb Randzone, Mindestabstand, Graph zusammenhängend,
     deterministisch; `npm run check` grün.
4. **N2 Netz-Routing + Levels** (`roadgen.js`, `heightmap.wgsl`, `uniforms.js`, Tests): gemeinsames
   Kostenfeld, Level aus geglättetem Feld, `MAX_ROADS` 16.
   → Prüfung: Sanity: kein Parallelband (Anteil Punkte im Band 1–3× Breite neben fremder Straße
     < 5 %), Level an gleicher Stelle ±0,1 m, Laufzeit < 200 ms; `npm run check` grün;
     Browser: Kreuzungen statt Parallelspuren, Regeneration < 500 ms.
5. **N3 GUI + Doku**: Straßen-Ordner (`townCount`, `townSpacing`, `exitCount`, `extraLinks`,
   `roadWidth`, `roadSlope`, `roadOffset`, `levelSmoothing`, `slopePenalty`, `waterAvoid`, `reuse`,
   `passWidth`); weg: `roadCount`, `roadLevel`, `maxH`. `.clinerules/projekt.md` (Flattening,
   Datenfluss, maxH), README-Parametertabelle.
   → Prüfung: `npm run check` grün; alle Slider triggern Regeneration.

## Risiken
- Value-Noise ist nicht normalverteilt → Coverage nur ≈; Stats-Test hält die Toleranz fest.
- 16 × 31 Segmente pro Pixel im Shader: bei Budget-Riss Segmente vorab pro Kachel filtern.

## Abgeschlossen
- [ ] T1 Terrain-Kalibrierung — geprüft am YYYY-MM-DD
- [ ] T2 Pässe + Straßenfarbe — geprüft am YYYY-MM-DD
- [ ] N1 Knoten + Kanten — geprüft am YYYY-MM-DD
- [ ] N2 Netz-Routing + Levels — geprüft am YYYY-MM-DD
- [ ] N3 GUI + Doku — geprüft am YYYY-MM-DD

<!-- fertig: git mv Plan/TerrainStrassennetz.md Plan/erledigt/ -->
