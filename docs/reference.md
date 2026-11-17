# Reference

Details for the [Heightmap Level Generator](../README.md): export formats, parameters and how it works.

## Export

**Export** for **Unreal, Unity, Godot (Terrain3D) or Web / three.js**: the target picks the sizes the engine accepts
(Unreal: N+1 and 1009 / 2017 / 4033 / 8129, Unity: 513 … 4097, Godot and Web: native), the normal map convention
(DirectX for Unreal, OpenGL otherwise) and the row order (Unity), and the metadata carries the values for the engine's
import dialog (e.g. Unreal X/Y/Z scale and location). The size menu shows pixels and spacing; on the default map native is
1024 px at 0.5 m, Unreal 1025 px at exactly 0.5 m. **Detail ×2** computes the map again at 0.25 m per pixel for the export:
sharper road, bank, cliff and river edges.
- Heightmap as 16-bit PNG and as RAW `.r16` (~2 mm steps), plus an 8-bit preview PNG
- Splatmap RGBA (R road · G rock · B water/shore · A grass, weights sum to 255)
- Masks: slope, normal map (DirectX / Unreal), curvature, flow map (where the water ran)
- Road, town and water masks: where the roads, the town clearings and the water are, with a soft edge
- Water level as 16-bit PNG: height of the water surface per pixel (sea, lakes, rivers), encoded like the heightmap
- Color map PNG: the colors of the 2D map at export size, without water blue, as a color texture
- Layout JSON: towns, exits, roads, rivers and lakes as points and connections, for your own scripts
  (see [Masks and layout for your own tools](#masks-and-layout-for-your-own-tools))
- 3D mesh as glTF `.glb` with the color texture, 1 unit = 1 m
- Metadata JSON: map size, `maxH`, pixel convention, mask encodings, all settings

## Masks and layout for your own tools

Meant for automation in any engine or tool: paint materials, keep vegetation off roads and water, place buildings
(PCG, Houdini, a script), build road splines, find paths.

**Road / Town / Water mask PNG**: 8-bit gray, linear data (import without sRGB), same size, target and row order as the
heightmap. 255 = inside, 0 = outside, with a soft edge instead of hard steps; for a hard edge use `value >= 128`.
- *Road*: the road surface, soft 1 m edge (the R channel of the splatmap without its priorities)
- *Town*: the flat clearing around each town, irregular outline, soft 4 m edge; roads are not included. Empty when
  *Towns* = 0 or the clearing radius is 0
- *Water*: sea, lakes and rivers; value = water depth / 0.4 m (0 at the shore, 128 = 0.2 m deep)

**Water level PNG (16-bit)**: same size, encoding and row order as the heightmap, water surface in m =
`value / 65535 * maxH` for sea, lakes and rivers. Dry pixels hold min(level of the nearest water, terrain), so
`depth = water level − terrain` works everywhere: dry where depth ≤ 0, and the shoreline stays smooth when both images
are sampled bilinearly. One water mesh from this grid covers mountain lakes, rivers and the sea.

**Color map PNG**: the colors of the 2D map as RGBA8 sRGB, same size and row order as the heightmap; import it as a
color texture with sRGB, unlike the masks. There is no water blue: wet pixels carry the shore color, so the ground runs on
under the water without an edge at the shoreline, and your own water surface goes on top.

**Layout JSON**: the geometry of the generated map, independent of the target engine. Metres, origin in the map
centre, axes like the `.glb` mesh (right-handed, y up): x = image column, z = image row, x and z from −mapSize/2 to
+mapSize/2. The file describes itself (`coordinates`, `fields`); `export` holds the grid of the images exported with
the same settings: sample (i, j) lies at x = x0 + i·dx, z = z0 + j·dz (Unity exports have their rows flipped, dz < 0).
`coordinates.engines` gives the conversion for Unreal (cm, Z up), Unity, Godot and three.js.

```json
{
  "towns":  [{ "id": "town0", "position": [181.67, 33.45, 185.02], "level": 33.24, "radius": 8, "roads": ["road0", "road7"] }],
  "exits":  [{ "id": "exit0", "position": [-138.45, 35.95, -196], "road": "road6" }],
  "roads":  [{ "id": "road0", "from": "town0", "to": "town1", "width": 4, "points": [[181.67, 33.45, 185.02], ...], "level": [...] }],
  "rivers": [{ "id": "river0", "points": [[x, water surface, z, width], ...] }],
  "lakes":  [{ "id": "lake0", "level": 55.55, "area": 768, "centre": [x, y, z], "bbox": [xMin, zMin, xMax, zMax] }],
  "sea":    { "level": 15 }
}
```

Road points follow the centre line from `from` to `to`; their y is the road surface in the heightmap. Rivers run from
the source to the mouth (last point). Lake outlines and the exact clearing shapes are in the masks.

## Saving settings

**Save** writes all parameters including the seed as JSON (Chrome/Edge open a save dialog, other browsers
download the file). **Load** reads such a file back. Put a JSON into `app/presets/` and it appears in the
preset list. `Favorite.json` is an example. **Link** copies a URL with the same settings.

## Parameters

All distances are in meters (1 unit = 1 m), coverages and river catchment in % of the map, angles in degrees,
`roadMaxGrade` in %. The panel shows readable labels; hover a slider to see its JSON key (used in saved files and links).
*Advanced* entries in italics.

| Tab | Group | Parameters |
|---|---|---|
| Terrain | Hills | `hillAmp`, `hillWave`, *`hillRoughness`* |
| | Mountains | `mountainAmp`, `mountainCoverage`, *`mountainWave`*, *`clusterWave`* |
| | Cliffs | `cliffDrop`, `cliffCoverage`, *`cliffWave`*, *`cliffWidth`*, *`cliffAreaWave`* |
| | Erosion | `erosionStrength`, `erosionIterations`, `screeAngle` |
| Roads | Road network | `townCount`, `clearingRadius`, `exitCount`, `extraLinks`, `roadMaxGrade`, *`townSpacing`*, *`reuse`*, *`slopePenalty`*, *`waterAvoid`* |
| | Road edges | `roadWidth`, `roadSlope`, `roadSlopeVar`, `roadTolerance`, `levelSmoothing`, `roadOffset`, `roadColor` |
| World | Map | `mapSize` |
| | Water & ground | `waterLevel`, `baseLevel`, `maxH` (auto) |
| | Rivers & lakes | `riverCatchment`, `riverWidth`, `lakeArea` |
| | Border ring | `rimAmp`, `rimZone`, *`rimWave`* |
| Material | Biome | `biome` (`temperate`, `steppe`, `desert`, `snow`; missing in older files = `temperate`) |
| | Rock & snow | `rockSlope`, `rockBlend`, `snowHeight`, `snowBlend` |
| | Ground | `sandHeight`, `gravelCurv` |
| | Textures | `texScale`, `texFade`, `texTint` |
| | View | *Textures* on/off, *Texture size* 1K / 2K (not saved) |

Material settings change only the colors and textures; they don't regenerate the map. Switching the biome also sets
its road color (`roadColor`), which you can change afterwards.

## How it works

Seed + parameters → optional erosion on a half-resolution GPU grid (`erosion.wgsl`) → GPU prepass at 3 m cells (terrain only) →
rivers and lakes on the CPU (`hydro.js`: priority flood, drainage, river courses) → road network on the CPU
(`roadgen.js`: towns, spanning tree, Dijkstra routing, grade-limited road levels above the water) → uniform buffer →
compute shader (`heightmap.wgsl`) → height, road mask, water level, town mask and road coordinate buffers → readback →
2D canvas preview, 3D terrain mesh and water surface. The 3D material (`material.js`, three.js TSL node material) blends
the texture layers of the biome (`biomes.js`) per pixel from a mask texture (slope, curvature, road, distance to the
shore), draws road markings from the road coordinates (distance across the road, position along it) and fades into the
color map with distance.

