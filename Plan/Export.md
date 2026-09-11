# Plan: 16-Bit-Heightmap, Metadaten, Splatmap

**Status:** in Arbeit
**Datum:** 2026-09-11

## Ziel
Export, der in einer Engine ohne Stufen nutzbar ist: 16-Bit-Heightmap + JSON mit Maßstab + RGBA-Splatmap
zum Texturieren. Ziel ist die eigene WebGPU-Engine, aber engine-neutral.

## Entscheidungen (User-Wahl 2026-09-11)
- **Heightmap: 16-Bit-Graustufen-PNG, 1024²** (1:1 wie intern), Wert = h / maxH · 65535. 8 Bit gibt bei maxH
  114 m Stufen von 0,45 m. Das bisherige 8-Bit-PNG bleibt als „preview“.
- **Metadaten-JSON:** mapSize (m), resolution, maxH, waterLevel, Pixelzentren-Konvention, seed + alle Params
  (Save-Format) → die Engine skaliert richtig, die Karte ist reproduzierbar.
- **Splatmap RGBA (8 Bit):** R Straße, G Fels (Hangneigung wie in der Farbrampe), B Wasser + Ufer,
  A Rest (Gras); Gewichte summieren zu 1. Keine Einzelmasken, kein Straßen-JSON.
- **Eigener PNG-Encoder** (IHDR/IDAT/IEND, CRC32, zlib per `CompressionStream('deflate')`), keine Abhängigkeit:
  Canvas kann kein 16 Bit und multipliziert Alpha vor → RGB unter A = 0 (Straße) ginge verloren.
- **Export ▾** in der Toolbar: Heightmap 16-bit · Splatmap · Metadata · Heightmap 8-bit (preview).

## Meilensteine
1. **E1 PNG-Encoder + 16-Bit + JSON** (`png.js` neu, `main.js`, Test) → Prüfung: check grün; Node-Test: eigener
   Encoder → Decoder (zlib `inflateSync`) gibt die Werte bit-genau zurück; headless: Datei ≈ 1024² × 2 B, Werte = Readback.
2. **E2 Splatmap** (`main.js`) → Prüfung: check grün; headless: Gewichte summieren zu 255 (±1), Straße/Fels/Wasser
   an erwarteten Stellen (Overlay-Screenshot).

## Abgeschlossen
- [x] E1 PNG-Encoder + 16-Bit + JSON — geprüft am 2026-09-11 (Node-Test bit-genau; headless Mountains:
  16 Bit = 8 Bit ± 0 Stufen, 4370 verschiedene Werte in 5000 Stichproben; maxH 275 m → 8-Bit-Stufe wäre 1,1 m)
- [ ] E2 Splatmap — geprüft am

<!-- fertig: git mv Plan/Export.md Plan/erledigt/ -->
