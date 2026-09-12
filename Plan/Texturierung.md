# Plan: Texturierung im Tool (Auto-Material, R11)

**Status:** freigegeben (2026-09-12, User): Auflösung 1–2K (→ 2K-JPG im Repo, Regler „Texture size“ 1K/2K), Regler steuern
auch 2D + Splatmap, Texturen im Repo, Kandidaten-Spalte 1. Endnutzer legen eigene Texturen auf → Schichten austauschbar halten.
**Datum:** 2026-09-12

## Ziel
Das 3D-Terrain bekommt echte CC0-Texturen (Gras, Fels, Kies, Sand, Schnee, Straße), die automatisch über die Masken aus R8
(Neigung, Höhe, Krümmung) plus `roadMask` verteilt werden, wie ein Unreal-Auto-Material. Nah sieht man Textur, fern das
heutige Farbbild. Je Schicht Regler (z. B. „Fels ab °“, „Schnee ab m“).

## Entscheidungen
- **Shader-Weg: `MeshStandardNodeMaterial` (three r186, `three/webgpu`) mit TSL**, `colorNode` + `normalNode`, kein GLSL/`onBeforeCompile`
  (gibt es unter WebGPU nicht). Vorhanden und genutzt: `texture(arr, uv).depth(layer)` (Texture-Arrays), `triplanarTextures`
  (Blendfaktor aus |n|, 3 Samples), `positionWorld`, `normalWorld`, `uniform`, `smoothstep`, `mix`. Schicht-Gewichte als eigene `Fn`.
- **Eine Masken-Textur je Regeneration** (RGBA8 1024², linear, kein sRGB): R Neigung °/90, G Krümmung (p99-Skala), B `roadMask`,
  A Ufer/Nässe. Aus `masks.js`, dieselben Funktionen wie der Export (R8) → Tool und Unreal sehen dieselben Masken.
  Dabei `slopeRelief` (main.js, `// vereinfacht:`-Marker) in `masks.js` aufgehen lassen (User-Vorgabe: Zusammenführen erst bei R11).
  Höhe kommt aus `positionWorld.y` (m), nicht aus der Textur.
- **Schichten in 2 Texture-Arrays** (Albedo sRGB, Normal linear), je 6 Ebenen à 1024² oder 2048², Mipmaps, anisotrop → 2 Bindings statt 12.
- **Auflösung 1–2K (User):** Quellen als 2K-JPG im Repo; Regler „Texture size“ 1K/2K (Default 2K), 1K = beim Laden per Canvas
  verkleinert → schwache GPUs sparen ¾ Speicher ohne zweiten Dateisatz. KTX2 erst, wenn 2K-Speicher stört.
- **Austauschbar (User: Endnutzer nehmen eigene Texturen):** eine Schicht = `public/textures/<schicht>/albedo.jpg` + `normal.jpg`
  (NormalGL), beliebige Größe, beim Laden auf die Array-Größe skaliert; keine Texturnamen oder -größen im Shader.
  Eigene Texturen per Datei-Dialog im Tool = eigener späterer Punkt, nicht Teil von R11.
  Roughness nicht als Textur: Gelände ist durchgehend matt → je Schicht eine Konstante (spart ⅓ Speicher).
- **Projektion:** planar über Welt-XZ (1 Sample je Schicht); **Triplanar nur für Fels** (steile Hänge, Klippen, Böschungen),
  dort streckt planar. Detail-Normals: planar per `normalMap` (Tangenten aus Ableitungen, UV = Welt-XZ); Fels triplanar mit
  Whiteout-Blend je Achse in eigener `Fn`.
- **Übergänge:** Gewicht aus Maske (smoothstep, Regler) × Höhen-/Helligkeits-Blend (Albedo-Luminanz als Pseudo-Höhe) → Steine
  stehen aus dem Gras heraus statt weicher Überblendung. Straße gewinnt wie im Shader (`roadMask` > 0.5).
- **Fern-Überblendung:** ab Kameradistanz X (Regler, Start ~150 m) Mix zur heutigen Farbtextur (R9) → Übersicht bleibt wie jetzt,
  kein Kachel-Moiré, glTF-Export (R10) bleibt die Farbtextur.
- **Anti-Tiling:** zweites Sample derselben Ebene in anderer Skala, per Welt-Noise gemischt (nur Albedo) → Wiederholung bei
  400 m / Kachel ~4 m nicht sichtbar. Erst wenn die Screenshots es verlangen (Schritt T6).
- **Ein Schalter „Textures“** (an/aus) → aus = heutiges Farbmaterial (Fallback für schwache GPUs, Vergleich im Test).
- Wasser bleibt Farbe (keine Schicht), echter Wasserspiegel gehört zu R16.

## Textur-Budget
| | JPG 2K im Repo (gewählt) | KTX2 / Basis ETC1S (später, falls nötig) |
|---|---|---|
| Dateien | 6 × (Albedo + NormalGL) = 12 | 12 `.ktx2` |
| Download / Repo | ~1,5–3 MB je Map → **~20–30 MB** | ~0,6–1 MB je Map → **~8–12 MB** + Transcoder 0,58 MB |
| GPU-Speicher 2K | RGBA8 + Mips 22 MB/Ebene → **~270 MB** | BC7/ASTC ~5,6 MB/Ebene → **~67 MB** |
| GPU-Speicher 1K | **~67 MB** | **~17 MB** |
| Werkzeug | keins (Canvas → `DataArrayTexture`) | `basisu`/`toktx` lokal, `KTX2Loader.detectSupport(renderer)` |
| Masken-Textur | 4 MB (RGBA8 1024², ohne Mips) | gleich |

Liegen in `app/public/textures/<schicht>/` mit `SOURCES.md` (Asset-ID, URL, Lizenz CC0). Beschaffung per
`app/tools/fetch-textures.mjs` (lädt, entpackt, benennt um) → reproduzierbar, keine Handarbeit.

## Quellen (CC0, IDs geprüft am 2026-09-12, alle mit 1K-JPG)
| Schicht | Kandidat 1 | Alternativen |
|---|---|---|
| Gras | ambientCG `Grass004` | ambientCG `Ground037` (Gras + Erde) |
| Fels | ambientCG `Rock030` | Poly Haven `coast_land_rocks_01` |
| Kies / Schutt | ambientCG `Gravel022` | Poly Haven `pebble_ground_01` |
| Sand (Ufer) | Poly Haven `coast_sand_01` | Poly Haven `dense_sand`, `damp_sand` |
| Schnee | ambientCG `Snow006` | — |
| Straße (Feldweg) | Poly Haven `gravel_road` | ambientCG `Ground054`, `Ground048` |

Download-Muster (2K): ambientCG `https://ambientcg.com/get?file=<ID>_2K-JPG.zip` (Color + NormalGL im Zip);
Poly Haven `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/<id>/<id>_diff_2k.jpg` bzw. `_nor_gl_2k.jpg`
(geprüft wurde die 1K-Variante; 2K-Pfade in T2 verifizieren).
Normalen in OpenGL-Konvention (three) — nicht die DirectX-Variante nehmen (→ `.clinerules/export.md`, dort umgekehrt für Unreal).

## Regler (neuer Tab „Material“, Save-Schlüssel wie alle params → Share-Link, Undo)
- `rockSlope` Fels ab ° (Default 35) + `rockBlend` ° (15) — heute fest `ROCK_SLOPE` 35°–50°
- `snowHeight` Schnee ab m über Wasser (140) + `snowBlend` m (20) — heute Rampen-Stop 140 m
- `sandHeight` Ufer bis m über Wasser (1,5) — heute `STOPS[1]`
- `gravelCurv` Kies in Mulden/Hangfuß ab Krümmung (0 = aus)
- `texScale` m je Kachel (4), `texFade` Überblend-Distanz m (150), `textures` an/aus

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. T1 Masken zusammenführen: `slopeRelief` → `masks.js`; Masken-Textur je Regeneration → Prüfung: `check` grün, 2D-Preview
   pixelgleich zu vorher (headless Hash), Masken-Textur = Export-Masken (Stichprobe)
2. T2 Texturen beschaffen (`fetch-textures.mjs`, 2K-JPG, `public/textures/<schicht>/albedo.jpg|normal.jpg`, `SOURCES.md`)
   → Prüfung: 12 Dateien à 2048², Summe ≤ 30 MB
3. T3 NodeMaterial-Gerüst: `MeshStandardNodeMaterial`, `colorNode` = Farbtextur, Schalter „Textures“ → Prüfung: Screenshot
   headless gleich dem heutigen (Ø |ΔRGB| < 1)
4. T4 Schichten planar + Gewichte aus Masken + Regler + Fern-Überblendung → Prüfung: Screenshots nah + fern (Favorite,
   Mountains, Lakes, Canyon); Regler bewegen → sichtbare Wirkung; fern ≈ heutiges Bild
5. T5 Fels triplanar + Detail-Normals → Prüfung: Nahaufnahme Klippe/Böschung planar vs. triplanar, keine Streckung; Licht
   reagiert auf Detail-Normals
6. T6 Anti-Tiling (nur falls in T4/T5-Screenshots Kachelmuster sichtbar) + Framerate → Prüfung: fps headless (rAF-Zähler,
   1400×900) bei 1K und 2K ≥ 60 bzw. ≥ 80 % von „Textures aus“; eine Schicht-Datei durch eine andere Größe ersetzen → lädt
7. T7 Doku: `.clinerules/textur.md` (paths: material-Datei, masks.js), README-Hinweis auf CC0-Quellen

## Entschieden (User, 2026-09-12)
1. Auflösung 1–2K → 2K-JPG im Repo + Regler „Texture size“ 1K/2K; KTX2 erst bei Speicherproblemen (Loader-Tausch, Shader bleibt).
2. Regler (Fels ab °, Sand bis m, Schnee ab m) steuern 3D, 2D-Vorschau und Splatmap-Export (eine Wahrheit); Defaults = heutige
   Werte → ohne Reglerbewegung keine Änderung. Kies/Schnee/Sand haben im RGBA-Splat keinen Kanal → zweite Splatmap = eigener Punkt.
3. Texturen im Repo (`public/textures`, nötig für GitHub Pages).
4. Kandidaten-Spalte 1; Endnutzer tauschen ohnehin gegen eigene Texturen → austauschbar halten (siehe Entscheidungen).

## Abgeschlossen
- [ ] T1 Masken zusammenführen — geprüft am
- [ ] T2 Texturen beschaffen — geprüft am
- [ ] T3 NodeMaterial-Gerüst — geprüft am
- [ ] T4 Schichten planar + Regler — geprüft am
- [ ] T5 Triplanar + Detail-Normals — geprüft am
- [ ] T6 Anti-Tiling + Framerate — geprüft am
- [ ] T7 Doku — geprüft am

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
