# Heightmap Level Generator

Procedural heightmap & terrain generator for game levels, running on WebGPU compute shaders (WGSL) in the browser.
Generates a heightmap at 0.5 m per pixel (1024×1024 for the default 512 m map, 2560×2560 at 1280 m) with roads, towns, cliffs, hills,
mountains, erosion, rivers and lakes inside a closed border ring. Tweak everything live, walk through it and export
heightmap, masks and mesh for your engine.

**▶ Try it in your browser: https://m-w-marker.github.io/heightmap-level-generator/** (needs WebGPU, e.g. current desktop Chrome or Edge)

![Generator: 3D terrain with lakes, rivers and roads, 2D map and parameter panel](docs/generator.png)

## Features

**Terrain**
- **GPU generation**: WGSL compute shader, regenerates while you drag sliders; generation time shown in the panel
- **Seed-based**: same seed + parameters, same terrain; compare 12 seeds side by side (⊞) and pick one
- **Cliffs, hills, mountains**: amplitudes in meters, coverage in % of the map
- **Erosion**: rain and scree wear the terrain on the GPU (gullies on the flanks, sediment in the valleys), optional
  scree slopes below cliffs (off by default; *Eroded mountains* preset)
- **Rivers and lakes**: rivers grow from the drainage of the terrain and run downhill into lakes, the sea or the foot
  of the border ring; hollows fill up to their outflow and become lakes with their own water level; a real water
  surface in 3D (*River valley* preset)
- **Border ring**: closed raised terrain around the map edge that hides the horizon; exit roads end at its foot
- **Map size**: 256–1280 m in 64 m steps; all meter values keep their meaning, a larger map shows more of the same landscape at the
  same detail (all grids grow with it; ~1 s per generation at 1280 m)
- **Auto height range**: `maxH` is derived from the settings, nothing gets clipped

**Roads**
- **Road network**: towns on flat, dry ground plus map exits, connected by a spanning tree with extra loops (only
  where they are a real shortcut); routed around steep slopes and water, later roads merge into existing ones
- **Lies on the landscape**: the road follows the terrain within a tolerance band; cuts and banks only where the
  terrain demands it, with varying steepness; towns sit on organic flat clearings
- **Grade limit**: `roadMaxGrade` caps how steep a road may climb; routing looks for gaps instead of driving down a
  cliff, unavoidable climbs become ramps, consistent across the whole network
- **Never under water**: roads avoid lakes and rivers and cross them on a raised embankment

**Tool**
- **2D map + 3D preview**: top-down color map and a lit 3D mesh (three.js) with the same colors
- **Walk mode** (🚶): first-person at eye height on the terrain; mouse to look, WASD / arrows to move, Shift to run, Esc to leave
- **Compact panel**: toolbar and three tabs (Terrain, Roads, World); labels with units, a tooltip per slider, rarely
  used ones under *Advanced*
- **Undo / redo**: Ctrl+Z / Ctrl+Y over all settings
- **Share link**: the URL always holds all settings; *Link* copies it, the same map opens in any WebGPU browser
- **Presets**: Rolling hills, Pasture, Mountains, Canyon / Plateaus, Lakes, Eroded mountains, River valley, plus defaults
- **Save / Load**: all settings incl. seed as JSON; every JSON in `app/presets/` shows up in the preset list

**Export** (native size = 0.5 m per pixel, or 513 / 1025 / 2049 px vertex grids for Unreal landscapes; 1025 on the default map = exactly 0.5 m)
- Heightmap as 16-bit PNG and as RAW `.r16` (~2 mm steps), plus an 8-bit preview PNG
- Splatmap RGBA (R road · G rock · B water/shore · A grass, weights sum to 255)
- Masks: slope, normal map (DirectX / Unreal), curvature, flow map (where the water ran)
- 3D mesh as glTF `.glb` with the color texture, 1 unit = 1 m
- Metadata JSON: map size, `maxH`, pixel convention, mask encodings, all settings

## Quick start

No install needed for the [online version](https://m-w-marker.github.io/heightmap-level-generator/). To run it locally
you need Node.js and a browser with WebGPU (current Chrome or Edge).

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173 (on Windows, `start.bat` does both).

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

## How it works

Seed + parameters → optional erosion on a half-resolution GPU grid (`erosion.wgsl`) → GPU prepass at 3 m cells (terrain only) →
rivers and lakes on the CPU (`hydro.js`: priority flood, drainage, river courses) → road network on the CPU
(`roadgen.js`: towns, spanning tree, Dijkstra routing, grade-limited road levels above the water) → uniform buffer →
compute shader (`heightmap.wgsl`) → height, road mask and water level buffers → readback → 2D canvas preview,
3D terrain mesh and water surface.

## Tech

WebGPU · WGSL · three.js (r186) · lil-gui · Vite
