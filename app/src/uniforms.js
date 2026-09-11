// Uniform-Encoding: 1:1 zu struct Params in heightmap.wgsl — die Feldreihenfolge ist der Float-Index.
// Layout-Regeln + No-Gos → .clinerules/wgsl.md · Layout-Test: tests/uniforms.layout.mjs (→ Plan/Bugfix.md Schritt 2)
import { MAX_ROADS, ROAD_POINTS } from './roadgen.js';

// Gemessene Noise-Statistik (tests/noise.mjs, 40 Seeds) → Regler wirken in Metern / Flächen-%,
// bewacht von tests/terrain.stats.mjs (→ Plan/TerrainStrassennetz.md T1)
export const FBM5_P95 = 0.4706;   // p95 |fbm 5 Okt.| → hillAmp = p95-Auslenkung
export const RIDGE5_P95 = 0.8272; // p95 ridge 5 Okt. → mountainAmp = p95-Gipfelhöhe
const FBM4_GRAD0 = 1.014;         // mittlerer |∇fbm 4 Okt.| an der 0-Linie (Noise-Raum)
// Quantile fbm 3 Okt. bei 0, 5, …, 100 %; Enden = theoretisches Max + Maskenweiche → 0 % / 100 % exakt
const MASK_SOFT = 0.15; // = Weiche der Masken-smoothsteps in heightmap.wgsl
export const fbmMax = octaves => 1 - 0.5 ** octaves;
const FBM3_Q = [-fbmMax(3) - MASK_SOFT, -0.403, -0.3239, -0.2671, -0.2197, -0.1776, -0.1392, -0.1028, -0.0679, -0.0336,
    0.0002, 0.034, 0.0676, 0.1023, 0.1384, 0.1764, 0.2184, 0.2663, 0.3229, 0.4029, fbmMax(3) + MASK_SOFT];

// Masken-Schwelle, über der `pct` % der Map liegen
export function coverageThr(pct) {
    const q = Math.min(Math.max(1 - pct / 100, 0), 1) * (FBM3_Q.length - 1);
    const i = Math.min(Math.floor(q), FBM3_Q.length - 2);
    return FBM3_Q[i] + (FBM3_Q[i + 1] - FBM3_Q[i]) * (q - i);
}

// Obere Schranke der Höhe aus den theoretischen Noise-Maxima → oben nie Clamp
export function autoMaxH(p) {
    return Math.max(1, p.baseLevel
        + p.hillAmp * fbmMax(5) / FBM5_P95
        + p.mountainAmp * fbmMax(5) / RIDGE5_P95
        + p.cliffDrop / 2
        + p.rimAmp * (0.6 + 0.4 * fbmMax(3))); // 0.6/0.4 = Rand-Ring-Mix in heightmap.wgsl
}

export const PARAM_FIELDS = {
    seed: p => p.seed,
    mapSize: p => p.mapSize,
    res: p => p.res,
    maxH: p => p.maxH,
    baseLevel: p => p.baseLevel,
    hillAmp: p => p.hillAmp / FBM5_P95,
    hillScale: p => 1 / p.hillWave,
    mountainAmp: p => p.mountainAmp / RIDGE5_P95,
    mountainScale: p => 1 / p.mountainWave,
    maskScale: p => 1 / p.clusterWave,
    mountainThr: p => coverageThr(p.mountainCoverage),
    cliffDrop: p => p.cliffDrop,
    cliffScale: p => 1 / p.cliffWave,
    // Übergangsbreite in m → Noise-Band: cn = fbm·0.5+0.5, Breite 2·band / (0.5·G·scale) = cliffWidth
    cliffWidth: p => p.cliffWidth * FBM4_GRAD0 / 4,
    cliffMaskScale: p => 1 / p.cliffAreaWave,
    cliffThr: p => coverageThr(p.cliffCoverage),
    rimAmp: p => p.rimAmp,
    rimZone: p => p.rimZone,
    rimScale: p => 1 / p.rimWave,
    roadCount: p => p.roadCount,
    roadHalfWidth: p => p.roadWidth / 2,
    roadSlope: p => Math.tan(p.roadSlope * Math.PI / 180), // Böschungswinkel ° → Höhe pro m
    roadOffset: p => p.roadOffset,
    passWidth: p => Math.max(p.passWidth, p.roadWidth / 2 + 1), // smoothstep braucht edge0 < edge1
};

// Float-Index von roads: Params-Felder auf die 16-Byte-Align des vec4-Arrays aufgefüllt
export const ROADS_OFFSET = Math.ceil(Object.keys(PARAM_FIELDS).length / 4) * 4;

export function encodeUniforms(p, roads, levels, out) {
    let i = 0;
    for (const f of Object.values(PARAM_FIELDS)) out[i++] = f(p);
    // Rest bis ROADS_OFFSET: Padding (roads muss 16-Byte-aligned liegen)
    // 1 Punkt = vec4(x, y, level, 0) — f32-/vec2-Arrays sind im uniform-Adressraum ungültig (→ .clinerules/wgsl.md)
    for (let k = 0; k < MAX_ROADS * ROAD_POINTS; k++) {
        out[ROADS_OFFSET + 4 * k] = roads[2 * k];
        out[ROADS_OFFSET + 4 * k + 1] = roads[2 * k + 1];
        out[ROADS_OFFSET + 4 * k + 2] = levels[k];
    }
}
