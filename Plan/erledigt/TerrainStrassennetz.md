# Plan: Terrain-Kalibrierung + Straßennetz

**Status:** fertig
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
  Schwelle = gemessenes fbm-Quantil bei `1 − coverage` (Tabelle 5-%-Schritte in `uniforms.js`, CPU
  → Uniform). (Geändert in T1: Tabelle statt σ + Φ⁻¹ – exakter, keine Näherungsformel. Verworfen:
  Perzentil aus dem Prepass = Maske müsste mit in den Readback, mehr Code für ±wenige %.)
- **Amplituden in Metern:** Noise-Terme durch ihr gemessenes p95 normiert → p95 der Auslenkung ≈
  Regler (`hillAmp 17` → ±17 m). σ/p95-Konstanten stehen einmal in `uniforms.js`, gemessen und
  bewacht von `tests/terrain.stats.mjs` (JS-Nachbau des WGSL-Noise – für Statistik reicht f64, anders
  als für Straßen-Levels).
- **`maxH` automatisch** = `baseLevel + hillAmp + mountainAmp + cliffDrop/2 + rimAmp` (obere
  Schranke, theoretische Noise-Maxima) → nie Abschneiden oben; Regler entfällt schon in T1, GUI
  zeigt den Wert. Unten bleibt Clamp auf 0.
- **Pässe im Rand-Ring:** Prepass ohne Rand-Ring (`rimAmp = 0`) → Routing und Levels sehen das innere
  Gelände; im Final-Pass wird `rimF` nahe Straßen abgesenkt (`smoothstep(roadHalfWidth, passWidth,
  dMin)`), Innen-Straßen meiden die Randzone über Kosten `rimAvoid` (Ausfahrten queren sie kurz).
- **Straßenfarbe nur Fahrbahn:** `roadMask` = Fahrbahn (1 m weiche Kante).
- **Böschung als Neigung (T2, nach Screenshot):** `roadSlope` = Böschungswinkel in ° (15–60, Default 35);
  Gelände wird in den Kegel `roadL ± tan(α)·(d − hw)` geklemmt statt `mix` über feste 5-m-Breite
  (→ Wände bei tiefen Einschnitten). Level vom nächsten Segment statt „stärkstes Gewicht“ (→ Treppen).
  `roadWidth` 1–5 m, Default 4 (400-m-Map).
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
  - Glatter Verlauf: 8-Nachbar-Gitter = 45°-Zickzack → mehr Chaikin-Iterationen; Punkte je Straße
    nach Länge statt fix 32 über 400 m (13-m-Segmente = sichtbare Knicke). `slopePenalty`-Default
    höher (1.5 = 60 m Anstieg kostet nur 90 m Umweg → Straßen gehen über Berge statt drumherum).
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
   `passWidth`); weg: `roadCount`, `roadLevel` (`maxH` schon in T1). `.clinerules/projekt.md` (Flattening,
   Datenfluss, maxH), README-Parametertabelle.
   → Prüfung: `npm run check` grün; alle Slider triggern Regeneration.

## Risiken
- Value-Noise ist nicht normalverteilt → Coverage nur ≈; Stats-Test hält die Toleranz fest.
- 16 × 31 Segmente pro Pixel im Shader: bei Budget-Riss Segmente vorab pro Kachel filtern.

## Abgeschlossen
- [x] T1 Terrain-Kalibrierung — geprüft am 2026-09-11
- [x] T2 Pässe + Straßenfarbe + Böschung als Neigung — geprüft am 2026-09-11 (check grün; Browser gesammelt am Ende)
- [x] N1 Knoten + Kanten — geprüft am 2026-09-11
- [x] N2 Netz-Routing + Levels — geprüft am 2026-09-11 (check grün; Parallelband-Test zählt nur
  gleichbleibenden Abstand – Y-Einmündungen verjüngen sich; Glättung: 16 Nachbarn + gleitender
  Mittelwert statt Punkte je Länge; Browser gesammelt am Ende)
- [x] N3 GUI + Doku — geprüft am 2026-09-11 (`rimAvoid` zusätzlich in „Rand-Ring“)
- [x] Browser-Abnahme T2–N3 (Böschung, Netz, Regeneration < 500 ms; Pässe abgelöst durch
  Plan/PresetsAusfahrten.md A1) → dann Plan nach erledigt/

<!-- fertig: git mv Plan/TerrainStrassennetz.md Plan/erledigt/ -->
