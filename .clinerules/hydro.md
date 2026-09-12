---
paths:
  - "app/src/hydro.js"
  - "app/tests/hydro.test.mjs"
---
# Thema: Flüsse und Seen (Hydrologie + Wasserspiegel)

## No-Gos
- NICHT die Priority-Flood nur vom Meer aus starten, sondern auch von der Randzone (Ringfuß). Der geschlossene Rand-Ring füllt sonst die ganze Map zu einem See bis zur tiefsten Scharte.
- NICHT den Fluss-Spiegel im Shader gleich dem Prepass-Spiegel setzen, sondern `RIVER_SINK` darunter. Die Aue in voller Auflösung daneben liegt sonst stellenweise tiefer, das Wasser endet am nassen Streifen in der Luft → Zacken im Wasser-Mesh.
- NICHT den See-Spiegel per fester 3×3-Zellen-Dilatation auf die volle Auflösung übertragen, sondern über die bilineare Seemaske (`LAKE_EDGE`). Tiefer liegendes Gelände wird sonst an der Dilatationsgrenze als Quadrat abgeschnitten.
- NICHT See-/Flusswasser zeichnen, wo die Straße das Gelände abgesenkt hat oder auf der Fahrbahn. Ein Einschnitt am See liefe voll, eine Uferrampe läge unter Wasser.
- NICHT den Spiegel für das Wasser-Mesh bilinear abtasten, sondern das Maximum der 4 Texel nehmen, trockene Randecken knapp unter das Gelände legen und Alpha nach Tiefe auslaufen lassen. Bilinear mischt am Rand Fluss- und Meeresspiegel; auf Meereshöhe gesetzte Randecken bilden Wände.
- NICHT den `water`-Puffer mit `waterLevel` füllen, sondern 0 = Meer (JS nimmt `waterLevel`). f32 ≠ f64 → sonst kippen bei nicht darstellbaren Werten einzelne Vorschau-Pixel, und „aus“ ist nicht mehr bitgleich.
- NICHT Flüsse aus D8-Pfaden ungeglättet übernehmen, sondern Chaikin + Mäander (`meander`). Acht Richtungen auf dem 3-m-Prepass-Raster wirken wie Kanäle.
