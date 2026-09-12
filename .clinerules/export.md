---
paths:
  - "app/src/png.js"
  - "app/tests/png.test.mjs"
  - "app/src/main.js"
  - "app/src/export.js"
  - "app/tests/raw.test.mjs"
---
# Thema: Export (PNG, Splatmap, Metadaten)

## No-Gos
- NICHT Masken mit Alpha-Kanal über Canvas (`toBlob`/`putImageData`) exportieren, sondern über `encodePng`. Canvas multipliziert Alpha vor → RGB unter A = 0 (z. B. Straße) geht verloren. 16 Bit kann Canvas gar nicht.
- NICHT Splat-Gewichte mit einem schon reduzierten Anteil verketten (`(1 − water)` mit `water = (1 − road)·wet`), sondern mit dem Rohanteil (`1 − wet`). Sonst Summe > 255 → A negativ → läuft in Uint8 auf 255 über.
- NICHT den 8-Bit-Export als Engine-Heightmap anbieten. Bei maxH 275 m ist eine Stufe 1,1 m hoch.
