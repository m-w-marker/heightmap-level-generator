// Uniform-Encoding: 1:1 zu struct Params in heightmap.wgsl — die Feldreihenfolge ist der Float-Index.
// Layout-Regeln + No-Gos → .clinerules/wgsl.md · Layout-Test: tests/uniforms.layout.mjs (→ Plan/Bugfix.md Schritt 2)
import { MAX_ROADS, ROAD_POINTS } from './roadgen.js';

export const PARAM_FIELDS = {
    seed: p => p.seed,
    mapSize: p => p.mapSize,
    res: p => p.res,
    maxH: p => p.maxH,
    baseLevel: p => p.baseLevel,
    hillAmp: p => p.hillAmp,
    hillScale: p => 1 / p.hillWave,
    mountainAmp: p => p.mountainAmp,
    mountainScale: p => 1 / p.mountainWave,
    maskScale: p => 1 / p.clusterWave,
    cliffDrop: p => p.cliffDrop,
    cliffScale: p => 1 / p.cliffWave,
    cliffWidth: p => p.cliffWidth,
    cliffMaskScale: p => 1 / p.cliffAreaWave,
    rimAmp: p => p.rimAmp,
    rimZone: p => p.rimZone,
    rimScale: p => 1 / p.rimWave,
    roadCount: p => p.roadCount,
    roadHalfWidth: p => p.roadWidth / 2,
    roadSlope: p => p.roadSlope,
    roadLevel: p => p.roadLevel,
};

// Float-Index von roads: 21 Felder auf die 16-Byte-Align des vec4-Arrays aufgefüllt
export const ROADS_OFFSET = Math.ceil(Object.keys(PARAM_FIELDS).length / 4) * 4;

export function encodeUniforms(p, roads, out) {
    let i = 0;
    for (const f of Object.values(PARAM_FIELDS)) out[i++] = f(p);
    // u[21..23]: Padding (roads muss 16-Byte-aligned liegen)
    // 1 Punkt = vec4(x, z, 0, 0) — vec2-Arrays sind im uniform-Adressraum ungültig (→ .clinerules/wgsl.md)
    for (let k = 0; k < MAX_ROADS * ROAD_POINTS; k++) {
        out[ROADS_OFFSET + 4 * k] = roads[2 * k];
        out[ROADS_OFFSET + 4 * k + 1] = roads[2 * k + 1];
    }
}
