// Uniform-Encoding: 1:1 zu struct Params in heightmap.wgsl — die Feldreihenfolge ist der Float-Index.
// Layout-Regeln + No-Gos → .clinerules/wgsl.md · Layout-Test: tests/uniforms.layout.mjs (→ Plan/Bugfix.md Schritt 2)
import { MAX_ROADS, ROAD_POINTS, MAX_TOWNS } from './roadgen.js';

// Gemessene Noise-Statistik (tests/noise.mjs, 40 Seeds) → Regler wirken in Metern / Flächen-%,
// bewacht von tests/terrain.stats.mjs (→ Plan/TerrainStrassennetz.md T1)
export const FBM5_P95 = 0.4716;   // p95 |fbm 5 Okt.| → hillAmp = p95-Auslenkung
export const RIDGE5_P95 = 0.8284; // p95 ridge 5 Okt. → mountainAmp = p95-Gipfelhöhe
const FBM4_GRAD0 = 1.005;         // mittlerer |∇fbm 4 Okt.| an der 0-Linie (Noise-Raum)
// Quantile fbm 3 Okt. bei 0, 5, …, 100 %; Enden = theoretisches Max + Maskenweiche → 0 % / 100 % exakt
const MASK_SOFT = 0.15; // = Weiche der Masken-smoothsteps in heightmap.wgsl
// fbm mit Oktaven-Gain g: Amplituden 0.5·g^i → Maximum Σ, σ ∝ sqrt(Σ²) (Oktaven ≈ unabhängig)
export const fbmMax = (octaves, g = 0.5) => { let s = 0; for (let i = 0; i < octaves; i++) s += 0.5 * g ** i; return s; };
const fbmSigma = (octaves, g) => { let s = 0; for (let i = 0; i < octaves; i++) s += (0.5 * g ** i) ** 2; return Math.sqrt(s); };
// p95 |fbm 5 Okt.| bei Gain g — gemessen bei 0.5, skaliert über σ-Verhältnis
const hillP95 = g => FBM5_P95 * fbmSigma(5, g) / fbmSigma(5, 0.5);
const FBM3_Q = [-fbmMax(3) - MASK_SOFT, -0.4003, -0.3214, -0.2649, -0.218, -0.1764, -0.1376, -0.1013, -0.0661, -0.0322,
    0.002, 0.0355, 0.07, 0.1047, 0.1414, 0.1803, 0.2229, 0.2701, 0.3272, 0.4061, fbmMax(3) + MASK_SOFT];

// Masken-Schwelle, über der `pct` % der Map liegen
export function coverageThr(pct) {
    const q = Math.min(Math.max(1 - pct / 100, 0), 1) * (FBM3_Q.length - 1);
    const i = Math.min(Math.floor(q), FBM3_Q.length - 2);
    return FBM3_Q[i] + (FBM3_Q[i + 1] - FBM3_Q[i]) * (q - i);
}

// Obere Schranke der Höhe aus den theoretischen Noise-Maxima → oben nie Clamp
export function autoMaxH(p) {
    return Math.max(1, p.baseLevel
        + p.hillAmp * fbmMax(5, p.hillRoughness) / hillP95(p.hillRoughness)
        + p.mountainAmp * fbmMax(5) / RIDGE5_P95
        + p.cliffDrop / 2
        + p.rimAmp * (0.55 + 0.6 * fbmMax(3))); // 0.55/0.6 = Rand-Ring-Mix in heightmap.wgsl
}

export const PARAM_FIELDS = {
    seed: p => p.seed,
    mapSize: p => p.mapSize,
    res: p => p.res,
    maxH: p => p.maxH,
    baseLevel: p => p.baseLevel,
    hillAmp: p => p.hillAmp / hillP95(p.hillRoughness),
    hillScale: p => 1 / p.hillWave,
    hillGain: p => p.hillRoughness,
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
    roadSlope: p => p.roadSlope * Math.PI / 180,       // Böschungswinkel ° → rad (tan im Shader nach Variation)
    roadSlopeVar: p => p.roadSlopeVar * Math.PI / 180, // ± Schwankung entlang der Straße
    roadTolerance: p => p.roadTolerance,
    clearingCount: p => p.clearingCount,   // platzierte Orte (≤ townCount), 0 im Prepass
    clearingRadius: p => p.clearingRadius, // m flach um den Ort, Böschung wie an der Straße
};

// Float-Index von roads: Params-Felder auf die 16-Byte-Align des vec4-Arrays aufgefüllt; towns direkt dahinter
export const ROADS_OFFSET = Math.ceil(Object.keys(PARAM_FIELDS).length / 4) * 4;
export const TOWNS_OFFSET = ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS;
export const UNIFORM_FLOATS = TOWNS_OFFSET + 4 * MAX_TOWNS;

// towns: [{x, y, level}] aus generateRoads, höchstens MAX_TOWNS (clearingCount muss dazu passen)
export function encodeUniforms(p, roads, levels, towns, out) {
    let i = 0;
    for (const f of Object.values(PARAM_FIELDS)) out[i++] = f(p);
    // Rest bis ROADS_OFFSET: Padding (roads muss 16-Byte-aligned liegen)
    // 1 Punkt = vec4(x, y, level, 0) — f32-/vec2-Arrays sind im uniform-Adressraum ungültig (→ .clinerules/wgsl.md)
    for (let k = 0; k < MAX_ROADS * ROAD_POINTS; k++) {
        out[ROADS_OFFSET + 4 * k] = roads[2 * k];
        out[ROADS_OFFSET + 4 * k + 1] = roads[2 * k + 1];
        out[ROADS_OFFSET + 4 * k + 2] = levels[k];
    }
    towns.slice(0, MAX_TOWNS).forEach((t, k) => out.set([t.x, t.y, t.level, 0], TOWNS_OFFSET + 4 * k));
}
