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
    cliffDrop: f32,
    cliffScale: f32,
    cliffWidth: f32,
    cliffMaskScale: f32,
    rimAmp: f32,
    rimZone: f32,
    rimScale: f32,
};

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> heights: array<f32>;

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

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let res = u32(p.res);
    if (gid.x >= res || gid.y >= res) { return; }
    let idx = gid.y * res + gid.x;

    let uv = vec2<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5) / f32(res);
    let w = uv * p.mapSize; // Weltkoordinate in Metern

    // 1) Basisterain + Hügel
    var h = p.baseLevel + fbm(w * p.hillScale, p.seed, 5) * p.hillAmp * 0.5;

    // 2) Berge: Cluster-Maske × Ridge
    let mMask = smoothstep(0.35, 0.65, fbm(w * p.maskScale, p.seed + 101.3, 3));
    h += mMask * ridge(w * p.mountainScale, p.seed + 202.7, 5) * p.mountainAmp;

    // 3) Abrisskanten: Plateaus mit steilen Bruchkanten
    // vereinfacht: Meter → Noise-Band über Gradient ≈ 0.5 × Scale
    let cn = fbm(w * p.cliffScale, p.seed + 303.1, 4) * 0.5 + 0.5;
    let cMask = smoothstep(0.30, 0.60, fbm(w * p.cliffMaskScale, p.seed + 404.9, 3));
    let band = max(p.cliffWidth * p.cliffScale * 0.5, 0.02);
    h += cMask * (smoothstep(0.5 - band, 0.5 + band, cn) * 2.0 - 1.0) * p.cliffDrop * 0.5;

    // 4) Rand-Ring: Anhöhe Richtung Map-Kante
    let edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)) * p.mapSize;
    let rimF = 1.0 - smoothstep(0.0, p.rimZone, edge);
    h += rimF * (0.6 + 0.4 * fbm(w * p.rimScale, p.seed + 505.3, 3)) * p.rimAmp;

    heights[idx] = clamp(h / p.maxH, 0.0, 1.0);
}
