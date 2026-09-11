# Plan: Straßen-Steigung begrenzen (Canyon-Klippen)

**Status:** fertig
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
- **Level begrenzen:** nach dem Wasser-Boden zwei Hüllen: *Abtrag* = größte Hülle ≤ Level, *Auftrag* =
  kleinste Hülle ≥ Level (Vorwärts- + Rückwärtslauf). Level = Mittel beider → Rampe halb in das Plateau
  geschnitten, halb aufgeschüttet.
  → verworfen: nur Abtrag (tiefe Schluchten ins Plateau) bzw. nur Auftrag (Dämme in die Ebene).
- **Im ganzen Netz statt je Straße** (Befund G2): Knoten = Polyline-Punkte aller Straßen, Kanten = Nachbarn
  derselben Straße + fremde Punkte < 8 m. Je Straße gab es einen Sägezahn, weil zwei Rampen auf einer Trasse
  lagen (GPU vs. CPU Δ 11,6 m). → verworfen: Level auf dem 128²-Zellgraphen (geglättete Polyline ist kürzer
  als der Zellpfad, dann Steigung bis 25 %).
- **Hüllen erst mit 2g, dann g** (Befund G2): Das Mittel der g-Hüllen macht aus einem Sprung eine Rampe mit
  g/2 über die doppelte Länge → lange Dämme. Mit 2g entsteht die Rampe mit g, mittig über dem Sprung.
- **Randzone im Routing gesperrt** (Befund G2): Gegenüber Klippen-Kosten wurde der Rand-Ring zur billigen Rampe.
- **Canyon-Preset `roadMaxGrade` 25 %:** Mit 12 % braucht eine 45-m-Klippe ~375 m Rampe, fast die ganze Map
  (Level ↔ Gelände im Mittel 8,7 m, mit 25 %: 3,5 m). Mountains/Favorite bei 12 % im Mittel 0,8 m.

## Meilensteine
1. **G1 Routing + Level** (`roadgen.js`, `main.js` Regler, `tests/roadgen.sanity.mjs`) → Prüfung: check grün;
   neuer Sanity-Test mit synthetischer Klippe (Plateau | Ebene, Klippe mit einer Lücke): jede Straße über
   die Klippenlinie quert in der Lücke, Level-Schritt ≤ `gMax·ds` auf allen Straßen; Plateau ohne Lücke
   bleibt verbunden.
2. **G2 headless** Canyon / Plateaus + Mountains → Prüfung: Screenshots ohne Straße die Klippe hinunter,
   keine Einschnitte als Riesenschluchten; ggf. `GRADE_COST` / Preset-Werte nachziehen, check grün.

## Abgeschlossen
- [x] G1 Routing + Level — geprüft am 2026-09-11 (Sanity: Querung in der Lücke, Steigung ≤ 12 %, gleiche
  Stelle = gleiches Level, Rampe mittig; ohne Routing-Term bzw. ohne Begrenzung jeweils rot)
- [x] G2 headless Canyon + Mountains — geprüft am 2026-09-11 (alle 7 Presets: 0 Punkte außerhalb des
  Toleranzbands; Canyon: keine Straße die Klippe hinunter)

<!-- fertig: git mv Plan/StrassenSteigung.md Plan/erledigt/ -->
