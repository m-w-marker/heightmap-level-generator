---
paths:
  - "app/src/png.js"
  - "app/tests/png.test.mjs"
  - "app/src/main.js"
  - "app/src/export.js"
  - "app/tests/export.test.mjs"
  - "app/src/masks.js"
  - "app/tests/masks.test.mjs"
---
# Thema: Export (PNG, Splatmap, Metadaten)

## No-Gos
- NICHT Masken mit Alpha-Kanal über Canvas (`toBlob`/`putImageData`) exportieren, sondern über `encodePng`. Canvas multipliziert Alpha vor → RGB unter A = 0 (z. B. Straße) geht verloren. 16 Bit kann Canvas gar nicht.
- NICHT Splat-Gewichte mit einem schon reduzierten Anteil verketten (`(1 − water)` mit `water = (1 − road)·wet`), sondern mit dem Rohanteil (`1 − wet`). Sonst Summe > 255 → A negativ → läuft in Uint8 auf 255 über.
- NICHT die fertige RGBA-Splatmap resamplen, sondern ihre Eingaben (Höhe, `roadMask`, Neigung) und danach gewichten. Interpolierte, gefloorte Kanäle ergeben keine Summe von 255 mehr.
- NICHT Masken (Slope, Normal, Curvature) in Unreal als sRGB importieren, sondern als Masks / Linear Color bzw. Normalmap. Es sind Daten, keine Farben, und sRGB verschiebt die Mitte (128 = eben/flach).
- NICHT die Normal Map in OpenGL-Konvention (Blender, three.js) ohne G-Flip nutzen. Export ist DirectX/Unreal („green down“, G = +Zeile).
- NICHT die Krümmung mit fester Meter-Skala auf 8 Bit bringen, sondern mit `curvatureScale` (p99 je Map, steht in den Metadaten). Presets liegen zwischen ±0,8 m und ±16 m.
- NICHT den 8-Bit-Export als Engine-Heightmap anbieten. Bei maxH 275 m ist eine Stufe 1,1 m hoch.
