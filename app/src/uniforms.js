// Uniform-Encoding: 1:1 zu struct Params in heightmap.wgsl — die Feldreihenfolge ist der Float-Index.
// Layout-Regeln + No-Gos → .clinerules/wgsl.md · Layout-Test: tests/uniforms.layout.mjs (→ Plan/Bugfix.md Schritt 2)
import { MAX_ROADS, ROAD_POINTS, MAX_TOWNS } from './roadgen.js';
import { MAX_RIVERS, RIVER_POINTS } from './hydro.js';

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
    erosionOn: p => p.erosionOn ? 1 : 0,   // erosionDelta addieren (→ Plan/Erosion.md)
    waterLevel: p => p.waterLevel,         // Wasserspiegel-Ausgang: Meer (→ Plan/Fluesse.md)
    riverCount: p => p.riverCount,         // Flüsse aus hydrology(), 0 im Prepass
    erosionRes: p => grids(p.mapSize).ero, // Raster von erosionDelta (→ Plan/Aufloesung.md)
    lakeRes: p => grids(p.mapSize).pre,    // Raster des See-Spiegelfelds = Prepass
};

// Raster je Map-Größe (→ Plan/Aufloesung.md): ein Pixel bleibt PX_M (512 m / 1024 px, → Plan/Pixel05.md); Vielfache von 128
// → alle Dispatches glatt durch 16. Heightmap res, Mesh tn = res/2, Erosion ero = res/2 (→ Plan/Erosion.md), Prepass/Routing/
// Hydrologie pre = res/8. Größen außerhalb RES_MIN…RES_MAX oder nicht auf 64 m (geladene JSON) → Pixel weicht dann ab
export const PX_M = 0.5;
export const RES_MIN = 512, RES_MAX = 2560;
export function grids(mapSize) {
    const res = Math.min(Math.max(Math.round(mapSize / PX_M / 128) * 128, RES_MIN), RES_MAX);
    return { res, tn: res / 2, ero: res / 2, pre: res / 8 };
}

// 1:1 zu struct E in erosion.wgsl; p = params + mapSize, erode = false → nur Wasser (Flow-Map), Terrain bleibt
const EROSION_CAPACITY = 0.05; // Kc bei erosionStrength 100 %
export const EROSION_FIELDS = {
    cell: p => p.mapSize / grids(p.mapSize).ero,
    dt: () => 0.1,
    rain: () => 0.0005,
    pipe: p => 9.81 * p.mapSize / grids(p.mapSize).ero, // A = l² → A·g/l = g·l
    fluxKeep: () => 0.99,
    capacity: (p, erode) => erode ? EROSION_CAPACITY * p.erosionStrength / 100 : 0,
    dissolve: () => 0.3,
    deposit: () => 0.02, // langsam → Sediment erreicht die Talböden; 0.3 füllte die Rinnen gleich wieder
    evaporate: () => 0.05,
    depthRef: () => 0.01,
    depthMax: () => 0.3,
    talus: p => Math.tan(Math.min(p.screeAngle, 89) * Math.PI / 180),
    thermal: (p, erode) => erode ? 0.05 : 0,
    n: p => grids(p.mapSize).ero, // Zellen je Kante
};
export const EROSION_FLOATS = Math.ceil(Object.keys(EROSION_FIELDS).length / 4) * 4; // uniform-Struct auf 16 B aufgerundet
export function encodeErosion(p, erode, out) {
    let i = 0;
    for (const f of Object.values(EROSION_FIELDS)) out[i++] = f(p, erode);
}

// Float-Index von roads: Params-Felder auf die 16-Byte-Align des vec4-Arrays aufgefüllt; towns, rivers direkt dahinter
export const ROADS_OFFSET = Math.ceil(Object.keys(PARAM_FIELDS).length / 4) * 4;
export const TOWNS_OFFSET = ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS;
export const RIVERS_OFFSET = TOWNS_OFFSET + 4 * MAX_TOWNS;
export const UNIFORM_FLOATS = RIVERS_OFFSET + 4 * MAX_RIVERS * RIVER_POINTS;

// towns: [{x, y, level}] aus generateRoads, höchstens MAX_TOWNS (clearingCount muss dazu passen);
// rivers: fertig gepackte vec4 aus hydrology() oder null (riverCount muss dazu passen)
export function encodeUniforms(p, roads, levels, towns, rivers, out) {
    let i = 0;
    for (const f of Object.values(PARAM_FIELDS)) out[i++] = f(p);
    // Rest bis ROADS_OFFSET: Padding (roads muss 16-Byte-aligned liegen)
    // 1 Punkt = vec4(x, y, level, s) — f32-/vec2-Arrays sind im uniform-Adressraum ungültig (→ .clinerules/wgsl.md);
    // s = Bogenlänge ab Straßenanfang in m (Markierungen, → Plan/Biome.md)
    for (let k = 0; k < MAX_ROADS * ROAD_POINTS; k++) {
        const o = ROADS_OFFSET + 4 * k;
        out[o] = roads[2 * k];
        out[o + 1] = roads[2 * k + 1];
        out[o + 2] = levels[k];
        out[o + 3] = k % ROAD_POINTS ? out[o - 1] + Math.hypot(roads[2 * k] - roads[2 * k - 2], roads[2 * k + 1] - roads[2 * k - 1]) : 0;
    }
    towns.slice(0, MAX_TOWNS).forEach((t, k) => out.set([t.x, t.y, t.level, 0], TOWNS_OFFSET + 4 * k));
    if (rivers) out.set(rivers, RIVERS_OFFSET);
}
