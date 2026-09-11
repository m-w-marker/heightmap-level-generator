// Heightmap-Generator (Compute) — 1024×1024, Map 400×400 m
// Layer-Reihenfolge pro Pixel: → Plan/Build.md „WGSL-Design“

struct Params {
    seed: f32,
    mapSize: f32,
    res: f32,
    maxH: f32,
    baseLevel: f32,
    hillAmp: f32,
    hillScale: f32,
    mountainAmp: f32,
    mountainScale: f32,
    maskScale: f32,
    mountainThr: f32,
    cliffDrop: f32,
    cliffScale: f32,
    cliffWidth: f32,
    cliffMaskScale: f32,
    cliffThr: f32,
    rimAmp: f32,
    rimZone: f32,
    rimScale: f32,
    roadCount: f32,
    roadHalfWidth: f32,
    roadSlope: f32,    // rad
    roadSlopeVar: f32, // rad
    roadTolerance: f32,
};

// = MAX_ROADS / ROAD_POINTS in roadgen.js (Layout-Test prüft); Array-Größe = Produkt
const MAX_ROADS = 16u;
const ROAD_POINTS = 32u;

const SLOPE_VAR_WAVE = 40.0; // m
const SLOPE_MIN = 0.1745;    // 10° in rad
const SLOPE_MAX = 1.3963;    // 80° in rad

// Punkt = vec4(x, y, level m, 0)
// vec4 statt vec2: im uniform-Adressraum muss der Array-Stride ein Vielfaches von 16 sein (→ .clinerules/wgsl.md)
struct Uniforms {
    params: Params,
    roads: array<vec4<f32>, 512>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> heights: array<f32>;
@group(0) @binding(2) var<storage, read_write> roadMask: array<f32>;

// --- Noise ---

fn hash(p2: vec2<f32>, seed: f32) -> f32 {
    let n = dot(p2, vec2<f32>(127.1, 311.7)) + seed * 74.7;
    return fract(sin(n) * 43758.5453123);
}

// Value-Noise in [-1, 1]
fn vnoise(p2: vec2<f32>, seed: f32) -> f32 {
    let i = floor(p2);
    let f = fract(p2);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash(i, seed);
    let b = hash(i + vec2<f32>(1.0, 0.0), seed);
    let c = hash(i + vec2<f32>(0.0, 1.0), seed);
    let d = hash(i + vec2<f32>(1.0, 1.0), seed);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

fn fbm(p2: vec2<f32>, seed: f32, octaves: i32) -> f32 {
    var v = 0.0;
    var amp = 0.5;
    var freq = 1.0;
    for (var i = 0i; i < octaves; i++) {
        v += amp * vnoise(p2 * freq, seed + f32(i) * 17.31);
        freq *= 2.03;
        amp *= 0.5;
    }
    return v;
}

// Scharfe Kämme (Ridge-Noise) in [0, 1]
fn ridge(p2: vec2<f32>, seed: f32, octaves: i32) -> f32 {
    var v = 0.0;
    var amp = 0.5;
    var freq = 1.0;
    for (var i = 0i; i < octaves; i++) {
        let n = vnoise(p2 * freq, seed + f32(i) * 17.31) * 0.5 + 0.5;
        v += amp * (1.0 - abs(2.0 * n - 1.0));
        freq *= 2.03;
        amp *= 0.5;
    }
    return v;
}

// Distanz Punkt → Segment + Segment-Parameter t (→ Plan/Build.md WGSL-Design 5)
fn distPointSeg(pt: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
    let ab = b - a;
    let t = clamp(dot(pt - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return vec2<f32>(length(pt - (a + ab * t)), t);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let res = u32(u.params.res);
    if (gid.x >= res || gid.y >= res) { return; }
    let idx = gid.y * res + gid.x;

    let uv = vec2<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5) / f32(res);
    let w = uv * u.params.mapSize; // Weltkoordinate in Metern

    // Amplituden, Schwellen und cliffWidth kommen auf der CPU normiert an (→ uniforms.js, Messwerte)
    // 1) Basisterain + Hügel
    var h = u.params.baseLevel + fbm(w * u.params.hillScale, u.params.seed, 5) * u.params.hillAmp;

    // 2) Berge: Cluster-Maske (Schwelle = Abdeckung, Weiche ±0.15 = MASK_SOFT) × Ridge
    let mMask = smoothstep(u.params.mountainThr - 0.15, u.params.mountainThr + 0.15, fbm(w * u.params.maskScale, u.params.seed + 101.3, 3));
    h += mMask * ridge(w * u.params.mountainScale, u.params.seed + 202.7, 5) * u.params.mountainAmp;

    // 3) Abrisskanten: Plateaus mit steilen Bruchkanten
    // vereinfacht: Meter → Noise-Band über den mittleren Gradienten an der Kante – lokal ±Faktor 2
    let cn = fbm(w * u.params.cliffScale, u.params.seed + 303.1, 4) * 0.5 + 0.5;
    let cMask = smoothstep(u.params.cliffThr - 0.15, u.params.cliffThr + 0.15, fbm(w * u.params.cliffMaskScale, u.params.seed + 404.9, 3));
    let band = max(u.params.cliffWidth * u.params.cliffScale, 0.02);
    h += cMask * (smoothstep(0.5 - band, 0.5 + band, cn) * 2.0 - 1.0) * u.params.cliffDrop * 0.5;

    // 4) Straßen: nächstes Segment liefert Distanz + Level (linear zwischen den Endpunkten) (→ .clinerules/wgsl.md)
    var roadL = 0.0;
    var dMin = 1e9;
    let nRoads = min(u32(u.params.roadCount), MAX_ROADS);
    for (var r = 0u; r < nRoads; r = r + 1u) {
        let base = r * ROAD_POINTS;
        for (var s = 0u; s + 1u < ROAD_POINTS; s = s + 1u) {
            let a = u.roads[base + s];
            let b = u.roads[base + s + 1u];
            let dt = distPointSeg(w, a.xy, b.xy);
            if (dt.x < dMin) {
                dMin = dt.x;
                roadL = mix(a.z, b.z, dt.y);
            }
        }
    }

    // 5) Rand-Ring: Anhöhe Richtung Map-Kante, geschlossen (Horizont) — Ausfahrten enden am Ringfuß
    let edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)) * u.params.mapSize;
    let rimF = 1.0 - smoothstep(0.0, u.params.rimZone, edge);
    h += rimF * (0.6 + 0.4 * fbm(w * u.params.rimScale, u.params.seed + 505.3, 3)) * u.params.rimAmp;

    // 6) Straßen — gewinnt über allem: Fahrbahn folgt dem Gelände im Band Level ± roadTolerance, daneben
    // Böschung mit fester Neigung (Gelände in einen Kegel um das Band geklemmt → Kante nur, wo das Gelände
    // stärker abweicht; tiefer Einschnitt = breitere Böschung, keine Wand)
    // vereinfacht: nur die nächste Straße klemmt – Kreuzungen mit abweichendem Level knicken an der Mittellinie
    // Böschungswinkel schwankt entlang der Straße (Noise, Wellenlänge SLOPE_VAR_WAVE) → mal Schulter, mal Abrisskante
    if (nRoads > 0u) {
        let ang = clamp(u.params.roadSlope + u.params.roadSlopeVar * vnoise(w / SLOPE_VAR_WAVE, u.params.seed + 606.1),
            SLOPE_MIN, SLOPE_MAX);
        let e = u.params.roadTolerance + max(dMin - u.params.roadHalfWidth, 0.0) * tan(ang);
        h = clamp(h, roadL - e, roadL + e);
    }

    heights[idx] = clamp(h / u.params.maxH, 0.0, 1.0);
    roadMask[idx] = 1.0 - smoothstep(u.params.roadHalfWidth, u.params.roadHalfWidth + 1.0, dMin); // nur Fahrbahn (Farbe)
}
