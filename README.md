# Heightmap Level Generator

Procedural heightmap & terrain generator for game levels, running on WebGPU compute shaders (WGSL) in the browser.
Generates a 1024×1024 heightmap for a 400×400 m map with roads, cliffs, hills, mountains and a border ring —
tweak everything live and export the result as PNG.

![Generator: 3D terrain with road network, 2D map and parameter panel](docs/generator.png)

## Features

- **GPU generation** — WGSL compute shader, regenerates instantly while you drag sliders
- **Seed-based** — same seed + parameters, same terrain
- **Road network** — towns on flat, dry ground plus map exits, connected by a spanning tree with extra
  loops (only where they are a real shortcut, on their own track); routed around steep slopes and water, later roads merge into existing ones (junctions instead
  of parallel lanes); roads lie on the landscape within a tolerance band, cuts and banks only where the
  terrain demands it, with varying steepness
- **Road grade limit** — `roadMaxGrade` caps how steep a road may climb: routing looks for gaps instead of
  driving down a cliff, and where a climb is unavoidable the road becomes a ramp (half cut, half fill),
  consistent across the whole network
- **Cliffs, hills, mountains** — amplitudes in meters, coverage in % of the map
- **Border ring** — closed raised terrain around the map edge that hides the horizon; exit roads end at its foot
- **Auto height range** — `maxH` is derived from the settings, nothing gets clipped
- **Compact panel** — toolbar (seed + random seed, preset list, save, load, export) and three tabs
  (Terrain, Roads, World); readable labels with units, a tooltip per slider, rarely used ones under *Advanced*
- **Presets** — Rolling hills, Pasture, Mountains, Canyon / Plateaus, Lakes, plus reset to defaults
- **Save / Load** — all settings incl. seed as JSON; every JSON in `app/presets/` shows up in the preset list
- **Road color** — adjustable, recolors without regenerating
- **Water level** — adjustable, shown in the preview
- **2D map + 3D preview** — top-down heightmap and a lit 3D mesh (three.js)
- **Export** — 16-bit grayscale heightmap PNG (1024×1024, ~2 mm steps instead of ~0.5 m in 8-bit), RGBA splatmap
  for texturing (R road · G rock · B water/shore · A grass, weights sum to 255), metadata JSON (map size, `maxH`,
  pixel convention, all settings), plus an 8-bit preview PNG

## Quick start

Requires Node.js and a browser with WebGPU (current Chrome or Edge).

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173 (on Windows, `start.bat` does both).

## Saving settings

**Save** writes all parameters including the seed as JSON (Chrome/Edge open a save dialog, other browsers
download the file). **Load** reads such a file back. Put a JSON into `app/presets/` and it appears in the
preset list — `Favorite.json` is an example.

## Parameters

All distances are in meters (1 unit = 1 m), coverages in % of the map, `roadSlope` in degrees, `roadMaxGrade` in %.
The panel shows readable labels; hover a slider to see its JSON key (used in saved files). *Advanced* entries in italics.

| Tab | Group | Parameters |
|---|---|---|
| Terrain | Hills | `hillAmp`, `hillWave`, *`hillRoughness`* |
| | Mountains | `mountainAmp`, `mountainCoverage`, *`mountainWave`*, *`clusterWave`* |
| | Cliffs | `cliffDrop`, `cliffCoverage`, *`cliffWave`*, *`cliffWidth`*, *`cliffAreaWave`* |
| Roads | Road network | `townCount`, `exitCount`, `extraLinks`, `roadMaxGrade`, *`townSpacing`*, *`reuse`*, *`slopePenalty`*, *`waterAvoid`* |
| | Road edges | `roadWidth`, `roadSlope`, `roadSlopeVar`, `roadTolerance`, `levelSmoothing`, `roadOffset`, `roadColor` |
| World | Water & ground | `waterLevel`, `baseLevel`, `maxH` (auto) |
| | Border ring | `rimAmp`, `rimZone`, *`rimWave`* |

## How it works

Seed + parameters → 128² GPU prepass (terrain only) → road network on the CPU (`roadgen.js`: towns, spanning
tree, Dijkstra routing, grade-limited road levels) → uniform buffer → compute shader (`heightmap.wgsl`) → height buffer → readback →
2D canvas preview + 3D mesh.

## Tech

WebGPU · WGSL · three.js (r186) · lil-gui · Vite
