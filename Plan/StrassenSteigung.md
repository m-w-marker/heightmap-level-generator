# Plan: Straßen-Steigung begrenzen (Canyon-Klippen)

**Status:** offen
**Datum:** 2026-09-11

## Ziel
Straßen fahren keine Klippe mehr hinunter: Routing sucht Lücken/Rampen, das Fahrbahn-Level steigt nie
steiler als `roadMaxGrade`.

## Befund
- Routing-Kosten `len + slopePenalty·|Δh|` sind linear in `|Δh|` → 45 m Klippe auf 6 m kostet so viel wie
  45 m Anstieg auf 300 m. Kürzester Weg führt daher gerade über die Kante.
- Level = geglättetes Feld an den Polyline-Punkten, ohne Steigungsgrenze → Absturz statt Rampe.

## Entscheidungen
- **`roadMaxGrade`** in % (Default 12, Regler 4–30), nur CPU (`roadgen.js`) → kein Uniform-/WGSL-Wechsel.
- **Routing weich:** je Dijkstra-Kante Steigung `g = |Δh| / len`; über dem Maximum Zusatzkosten
  `len · GRADE_COST · (g / gMax − 1)²`. Quadratisch = überproportional, aber endlich → umschlossene
  Plateaus bleiben erreichbar. Startwert `GRADE_COST = 2`, im headless-Test nachjustieren.
  → verworfen: harte Sperre (Plateau ohne Lücke wäre unerreichbar, Dijkstra ohne Ziel).
- **Level begrenzen:** nach dem Wasser-Boden je Straße zwei Hüllen mit Steigung ≤ `gMax·ds`
  (`ds` = Punktabstand nach Resample): *Abtrag* = größte Hülle ≤ Level (Vorwärts- + Rückwärtslauf mit
  `min`), *Auftrag* = kleinste Hülle ≥ Level (mit `max`). Level = Mittel beider → Rampe halb in das Plateau
  geschnitten, halb aufgeschüttet; das Mittel zweier Hüllen hält die Grenze ebenfalls ein.
  → verworfen: nur Abtrag (tiefe Schluchten ins Plateau) bzw. nur Auftrag (Dämme in die Ebene).
- vereinfacht: Begrenzung je Straße, nicht im gemeinsamen Level-Feld → wo zwei Straßen eine Klippenrampe
  teilen, kann das Level zwischen ihnen springen – ab sichtbaren Stufen an Kreuzungen.

## Meilensteine
1. **G1 Routing + Level** (`roadgen.js`, `main.js` Regler, `tests/roadgen.sanity.mjs`) → Prüfung: check grün;
   neuer Sanity-Test mit synthetischer Klippe (Plateau | Ebene, Klippe mit einer Lücke): jede Straße über
   die Klippenlinie quert in der Lücke, Level-Schritt ≤ `gMax·ds` auf allen Straßen; Plateau ohne Lücke
   bleibt verbunden.
2. **G2 headless** Canyon / Plateaus + Mountains → Prüfung: Screenshots ohne Straße die Klippe hinunter,
   keine Einschnitte als Riesenschluchten; ggf. `GRADE_COST` / Preset-Werte nachziehen, check grün.

## Abgeschlossen
- [ ] G1 Routing + Level — geprüft am
- [ ] G2 headless Canyon + Mountains — geprüft am

<!-- fertig: git mv Plan/StrassenSteigung.md Plan/erledigt/ -->
