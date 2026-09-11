# Plan: Echte Schleifen (extraLinks) + Straßen-Regler in zwei Ordnern

**Status:** in Arbeit
**Datum:** 2026-09-11

## Ziel
`extraLinks` erzeugt sichtbare Abkürzungen statt unsichtbarer Doppelstraßen. Der Roads-Ordner wird nach
Zweck geteilt: Netz vs. Straßenrand.

## Befund (Messung 2026-09-11)
- Zusatzkanten entstehen, laufen aber in Canyon/Mountains zu 94–97 % auf vorhandenen Straßen (Favorite 38/63 %),
  Höhenwirkung im Straßenstreifen ≈ 0. Grund: Auswahl = kürzeste Ortspaare → meist Dreiecke, deren Umweg übers Netz
  kaum länger ist; mit `reuse` 0,4 ist der Umweg auf vorhandener Straße billiger als eine neue Trasse.
- `extraLinks` 4 = 2: Winkelcheck lässt nicht mehr Kanten zu.

## Entscheidungen
- **Auswahl nach Umweg:** nur Ortspaare, deren Weg übers bisherige Netz (Luftlinien der Kanten) ≥ `MIN_DETOUR`
  (1,4) × Luftlinie ist; kürzeste zuerst, Winkelcheck bleibt; Umwege nach jeder neuen Kante neu (Floyd, ≤ 8 Orte).
- **Zusatzkanten routen ohne `reuse`-Rabatt** (×1): Sonst ist der 1,4-fache Umweg auf Straße (× 0,4) immer noch
  billiger als die neue Trasse. Band neben Straßen bleibt teuer → keine Parallelspur.
- `planNetwork` liefert zusätzlich `mst` / `extra` (Anzahl) → `generateRoads` erkennt die Zusatzkanten.
- **GUI:** „Road network“ (townCount, townSpacing, exitCount, extraLinks, reuse, slopePenalty, roadMaxGrade,
  waterAvoid) und „Road edges“ (roadWidth, roadSlope, roadSlopeVar, roadOffset, roadTolerance, roadColor,
  levelSmoothing). Keine Regler entfernt.

## Meilensteine
1. **L1 Schleifen** (`roadgen.js`, `tests/roadgen.sanity.mjs`) → Prüfung: check grün; Sanity: Zusatzstraßen
   abseits der Orte ≤ 30 % auf fremder Trasse; headless Favorite/Canyon/Mountains mit `extraLinks` 0 vs. 2 sichtbar anders.
2. **L2 GUI-Ordner** (`main.js`, README) → Prüfung: check grün; headless alle Presets laufen, Ordner sichtbar.

## Abgeschlossen
- [x] L1 Schleifen — geprüft am 2026-09-11 (Sanity: ohne Umweg-Auswahl bzw. ohne reuse-Ausnahme rot;
  echte Terrains: Zusatzstraßen 0–33 % auf fremder Trasse statt 94–97 %; bei 4–5 Orten nur 1–2 sinnvolle
  Schleifen, `extraLinks` 4 = 2)
- [ ] L2 GUI-Ordner — geprüft am

<!-- fertig: git mv Plan/Schleifen.md Plan/erledigt/ -->
