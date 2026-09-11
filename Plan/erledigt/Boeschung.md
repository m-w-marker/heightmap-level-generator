# Plan: Böschung nach außen steiler

**Status:** fertig
**Datum:** 2026-09-11

## Ziel
`roadSlope` formt nur den Straßenrand und rasiert keine entfernten Berge mehr. `roadSlopeVar` wirkt über den
ganzen Reglerbereich.

## Befund (headless, Favorite)
- Böschung = Kegel `Abstand · tan(Winkel)` um die nächste Straße, ohne Ende → flacher Winkel klemmt Gelände
  in 100–200 m Entfernung: `roadSlope` 15° → max. Höhe 84 → 62 m, Gipfel als schräge Ebenen, See fast weg.
- Winkel ± `roadSlopeVar` wird auf 10–60° geklemmt → bei 15° meist fest 10°, bei 60° meist fest 60°.

## Entscheidungen
- **Neigung wächst mit dem Abstand** (User-Wahl 2026-09-11): am Fahrbahnrand `tan(Winkel)`, dann +1 je
  `BANK_CURVE` m bis `tan(SLOPE_MAX)` (60°, bestehende Grenze gegen Streifenwände). Erlaubte Abweichung =
  Integral davon → Schulter statt Kegel; ferne Berge bleiben.
  → verworfen: maximale Breite (Stufe an der Grenze), nur Reglerminimum anheben (flache Böschung unmöglich).
- **Variation im Bereich:** Schwankung auf den Abstand zu 10° bzw. 60° begrenzt statt hinterher zu klemmen.
- Nur `heightmap.wgsl` (Konstanten), kein neuer Regler, kein Uniform-Wechsel.

## Meilensteine
1. **B1 Shader** → Prüfung: check grün; headless Favorite bei `roadSlope` 15/35/60: max. Höhe und Wasser
   ≈ unverändert gegenüber Default, Bild zeigt Schulter statt rasierter Gipfel; alle Presets 0 Punkte außerhalb des Bands.

## Abgeschlossen
- [x] B1 Shader — geprüft am 2026-09-11 (Favorite bei 15/35/60°: max. 84,8 m, Wasser 1,1 % identisch;
  alle Presets 0 Punkte außerhalb des Bands; Nebenbefund: Mountains-Gipfel wurden schon bei 35° gekappt,
  max. 173,5 → 198,7 m)

<!-- fertig: git mv Plan/Boeschung.md Plan/erledigt/ -->
