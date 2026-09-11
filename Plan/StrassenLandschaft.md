# Plan: Straßen liegen auf der Landschaft

**Status:** in Arbeit
**Datum:** 2026-09-11

## Ziel
Straßen folgen dem Gelände wie Feldwege (Referenzbild 2026-09-11) statt als Damm/Plateau; seitliche
Abrisskanten nur, wo das Gelände es erzwingt, mal höher, mal flacher.

## Befund
- `roadOffset` 2 m → jede Straße 2 m über geglättetem Gelände → Damm mit Böschung überall.
- Fahrbahn exakt auf Level geklemmt → Hügelwellen weggeschnitten/aufgeschüttet → Plateau-Look.
- Böschungswinkel überall 35° → alle Kanten gleich.

## Entscheidungen
- **Toleranzband:** Kegel beginnt bei ±`roadTolerance` (0–3 m, Default 0,7) statt 0 →
  `clamp(h, roadL − tol − e, roadL + tol + e)`; kleine Wellen bleiben, Kante nur bei größerer
  Abweichung. Uniform-Feld ersetzt den Platzhalter `roadOffset` (Shader brauchte ihn nie, Offset
  steckt im Level) → kein Layout-Shift.
- **Defaults:** `roadOffset` −0,3 m (leicht eingesunken, Regler −2…3), `levelSmoothing` 6 m.
  Wasser: Level ≥ `waterLevel + roadTolerance + 0,3` → auch der tiefste Toleranzpunkt bleibt trocken.
- **Wechselnde Kanten:** Böschungswinkel = `roadSlope ± roadSlopeVar · vnoise(w / 40 m)` (Regler
  0–30°, Default 20), geclamped 10–80°.
- **Fahrbahnfarbe einstellbar:** Farbregler `roadColor` (Default erdiges Beige wie im Referenzbild);
  Änderung färbt nur neu ein (Preview + Mesh), keine Regeneration.

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. **R1 Toleranz + Defaults + Farbe** (`heightmap.wgsl`, `uniforms.js`, `roadgen.js`, `main.js`, Tests).
   → Prüfung: `npm run check` grün; Konsole GPU-vs-CPU mit Band `roadTolerance + 0,5`.
2. **R2 Wechselnder Böschungswinkel** (`heightmap.wgsl`, `uniforms.js`, `main.js`, Layout-Test).
   → Prüfung: `npm run check` grün; Browser: Kanten entlang der Straße unterschiedlich steil.

## Abgeschlossen
- [x] R1 Toleranz + Defaults + Farbe — geprüft am 2026-09-11 (check grün; Browser gesammelt am Ende)
- [ ] R2 Wechselnder Böschungswinkel — geprüft am YYYY-MM-DD

<!-- fertig: git mv Plan/StrassenLandschaft.md Plan/erledigt/ -->
