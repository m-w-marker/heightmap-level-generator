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
    hillGain: f32,
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
    clearingCount: f32,
    clearingRadius: f32,
    erosionOn: f32, // 1 = erosionDelta addieren, 0 = heutiger Pfad bitgleich (→ Plan/Erosion.md)
};

// = MAX_ROADS / ROAD_POINTS / MAX_TOWNS in roadgen.js (Layout-Test prüft); roads-Array-Größe = Produkt
const MAX_ROADS = 16u;
const ROAD_POINTS = 32u;
const MAX_TOWNS = 8u;
const EROSION_RES = 512u; // = EROSION_RES in uniforms.js / erosion.wgsl

const SLOPE_VAR_WAVE = 40.0; // m
const SLOPE_MIN = 0.1745;    // 10° in rad
const SLOPE_MAX = 1.0472;    // 60° in rad (steiler → senkrechte Streifenwände im 512²-Mesh)
const BANK_CURVE = 10.0;     // m: Böschungsneigung (tan) wächst je BANK_CURVE m Abstand um 1 (→ Plan/Boeschung.md)
const CLEARING_BANK = 0.268; // tan 15°: Lichtungsrand startet flacher als die Straßen-Böschung → keine Gruben am Hang
const CLEARING_WOBBLE = 0.5; // Radius ±50 % per Noise → unregelmäßiger Umriss statt Kreis
const CLEARING_WAVE = 9.0;   // m Wellenlänge des Umriss-Noise (≈ Radius → 2–4 Ausbuchtungen je Lichtung)
const CLEARING_KEEP = 0.5;   // m Restwelligkeit im Kern → nicht spiegelglatt

// Punkt / Ort = vec4(x, y, level m, 0)
// vec4 statt vec2: im uniform-Adressraum muss der Array-Stride ein Vielfaches von 16 sein (→ .clinerules/wgsl.md)
struct Uniforms {
    params: Params,
    roads: array<vec4<f32>, 512>,
    towns: array<vec4<f32>, 8>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> heights: array<f32>;
@group(0) @binding(2) var<storage, read_write> roadMask: array<f32>;
@group(0) @binding(3) var<storage, read> erosionDelta: array<f32>; // EROSION_RES², erodiert − roh in m

// --- Noise ---

// Integer-Hash (lowbias32) statt fract(sin(…)): sin großer Argumente ist je GPU verschieden (→ .clinerules/wgsl.md)
fn mix32(v: u32) -> u32 {
    var x = v;
    x ^= x >> 16u;
    x *= 0x7feb352du;
    x ^= x >> 15u;
    x *= 0x846ca68bu;
    x ^= x >> 16u;
    return x;
}

// Schlüssel je Noise-Ebene aus dem Seed — ganzzahlig, damit keine f32-Rundung (fma) den Hash kippt
fn layerKey(layer: u32) -> u32 {
    return mix32(mix32(u32(u.params.seed)) + layer);
}

// cell = ganzzahlige Gitterzelle (floor) → [0, 1)
fn hash(cell: vec2<f32>, key: u32) -> f32 {
    let c = bitcast<vec2<u32>>(vec2<i32>(cell));
    return f32(mix32(c.x ^ mix32(c.y ^ key)) >> 8u) / 16777216.0; // 24 Bit = f32-Mantisse
}

// Value-Noise in [-1, 1]
fn vnoise(p2: vec2<f32>, key: u32) -> f32 {
    let i = floor(p2);
    let f = fract(p2);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash(i, key);
    let b = hash(i + vec2<f32>(1.0, 0.0), key);
    let c = hash(i + vec2<f32>(0.0, 1.0), key);
    let d = hash(i + vec2<f32>(1.0, 1.0), key);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// gain = Amplitudenfaktor je Oktave (Rauheit): klein = glatt rollend, groß = zerklüftet
fn fbmGain(p2: vec2<f32>, key: u32, octaves: i32, gain: f32) -> f32 {
    var v = 0.0;
    var amp = 0.5;
    var freq = 1.0;
    for (var i = 0i; i < octaves; i++) {
        v += amp * vnoise(p2 * freq, mix32(key + u32(i)));
        freq *= 2.03;
        amp *= gain;
    }
    return v;
}

fn fbm(p2: vec2<f32>, key: u32, octaves: i32) -> f32 {
    return fbmGain(p2, key, octaves, 0.5);
}

// Scharfe Kämme (Ridge-Noise) in [0, 1]
fn ridge(p2: vec2<f32>, key: u32, octaves: i32) -> f32 {
    var v = 0.0;
    var amp = 0.5;
    var freq = 1.0;
    for (var i = 0i; i < octaves; i++) {
        let n = vnoise(p2 * freq, mix32(key + u32(i))) * 0.5 + 0.5;
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

// Erlaubte Höhenabweichung d m hinter der Kante: Neigung s0, dann +1 je BANK_CURVE m bis tan(SLOPE_MAX); Integral →
// Schulter statt endlosem Kegel (der rasiert bei flachem Winkel Berge 100 m neben der Straße)
fn bank(d: f32, s0: f32) -> f32 {
    let sM = tan(SLOPE_MAX);
    let dc = min(d, (sM - s0) * BANK_CURVE);
    return s0 * dc + dc * dc / (2.0 * BANK_CURVE) + sM * (d - dc);
}

// Roh-Terrain in m (Schichten 1–3) = Eingang der Erosion (→ Plan/Erosion.md); w = Weltkoordinate in m
fn rawTerrain(w: vec2<f32>) -> f32 {
    // Amplituden, Schwellen und cliffWidth kommen auf der CPU normiert an (→ uniforms.js, Messwerte)
    // 1) Basisterain + Hügel
    var h = u.params.baseLevel + fbmGain(w * u.params.hillScale, layerKey(0u), 5, u.params.hillGain) * u.params.hillAmp;

    // 2) Berge: Cluster-Maske (Schwelle = Abdeckung, Weiche ±0.15 = MASK_SOFT) × Ridge
    let mMask = smoothstep(u.params.mountainThr - 0.15, u.params.mountainThr + 0.15, fbm(w * u.params.maskScale, layerKey(1u), 3));
    h += mMask * ridge(w * u.params.mountainScale, layerKey(2u), 5) * u.params.mountainAmp;

    // 3) Abrisskanten: Plateaus mit steilen Bruchkanten
    // vereinfacht: Meter → Noise-Band über den mittleren Gradienten an der Kante – lokal ±Faktor 2
    let cn = fbm(w * u.params.cliffScale, layerKey(3u), 4) * 0.5 + 0.5;
    let cMask = smoothstep(u.params.cliffThr - 0.15, u.params.cliffThr + 0.15, fbm(w * u.params.cliffMaskScale, layerKey(4u), 3));
    let band = max(u.params.cliffWidth * u.params.cliffScale, 0.02);
    h += cMask * (smoothstep(0.5 - band, 0.5 + band, cn) * 2.0 - 1.0) * u.params.cliffDrop * 0.5;
    return h;
}

// Pixelzentrum → Weltkoordinate in m
fn world(gid: vec2<u32>, res: u32) -> vec2<f32> {
    let uv = vec2<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5) / f32(res);
    return uv * u.params.mapSize;
}

// Roh-Terrain res² in m nach heights (Erosions-Eingang, → Plan/Erosion.md)
@compute @workgroup_size(16, 16)
fn raw(@builtin(global_invocation_id) gid: vec3<u32>) {
    let res = u32(u.params.res);
    if (gid.x >= res || gid.y >= res) { return; }
    heights[gid.y * res + gid.x] = rawTerrain(world(gid.xy, res));
}

// erosionDelta bilinear an w (Pixelzentren bei (k + 0.5) / EROSION_RES wie sampleBilinear in export.js, Kanten geclamped)
fn erosionAt(w: vec2<f32>) -> f32 {
    let n = i32(EROSION_RES);
    let f = w / u.params.mapSize * f32(n) - 0.5;
    let p0 = vec2<i32>(floor(f));
    let t = f - floor(f);
    let a = clamp(p0, vec2<i32>(0), vec2<i32>(n - 1));
    let b = clamp(p0 + 1, vec2<i32>(0), vec2<i32>(n - 1));
    let top = mix(erosionDelta[a.y * n + a.x], erosionDelta[a.y * n + b.x], t.x);
    let bot = mix(erosionDelta[b.y * n + a.x], erosionDelta[b.y * n + b.x], t.x);
    return mix(top, bot, t.y);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let res = u32(u.params.res);
    if (gid.x >= res || gid.y >= res) { return; }
    let idx = gid.y * res + gid.x;
    let w = world(gid.xy, res);

    var h = rawTerrain(w);
    if (u.params.erosionOn > 0.5) { h += erosionAt(w); }

    // Böschungsneigung am Fahrbahnrand; schwankt entlang der Straße (Noise, Wellenlänge SLOPE_VAR_WAVE) → mal Schulter,
    // mal Abrisskante. Schwankung auf den Abstand zu SLOPE_MIN/MAX begrenzt (hinterher klemmen → Winkel klebt an der Grenze)
    let ang0 = clamp(u.params.roadSlope, SLOPE_MIN, SLOPE_MAX);
    let vary = min(u.params.roadSlopeVar, min(ang0 - SLOPE_MIN, SLOPE_MAX - ang0));
    let s0 = tan(ang0 + vary * vnoise(w / SLOPE_VAR_WAVE, layerKey(6u)));

    // 3b) Lichtungen: Gelände um den Ort zum Level seiner Straßen-Enden gezogen; erlaubte Abweichung e wächst wie eine
    // Böschung (keine feste Breite → keine Wände am Hang), ab CLEARING_BANK flach → läuft aus statt Grube.
    // Organisch statt Kreis: Radius per Noise ±CLEARING_WOBBLE, innen bleiben ±CLEARING_KEEP m Wellen, weiche Sättigung
    // e·tanh(Δ/e) statt clamp → kein Knick am Rand. Vor Rand-Ring (bleibt geschlossen) und Straßen (gewinnen weiter)
    // (→ Plan/Roadmap.md R12)
    let cr = u.params.clearingRadius;
    let nTowns = select(0u, min(u32(u.params.clearingCount), MAX_TOWNS), cr > 0.0); // Radius 0 = aus
    let wobble = 1.0 + CLEARING_WOBBLE * vnoise(w / CLEARING_WAVE, layerKey(7u));
    for (var t = 0u; t < nTowns; t = t + 1u) {
        let c = u.towns[t];
        let e = CLEARING_KEEP + bank(max(length(w - c.xy) - cr * wobble, 0.0), CLEARING_BANK);
        h = c.z + e * tanh(clamp((h - c.z) / e, -10.0, 10.0)); // clamp: tanh großer Argumente → exp-Überlauf (NaN) je GPU
    }

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
    // Abstand hinter das um rimZone eingerückte Quadrat (Ecken rund statt min()-Diagonalknick)
    let half = 0.5 * u.params.mapSize;
    let beyond = length(max(abs(w - half) - (half - u.params.rimZone), vec2<f32>(0.0)));
    let rimF = smoothstep(0.0, u.params.rimZone, beyond);
    h += rimF * (0.55 + 0.6 * fbm(w * u.params.rimScale, layerKey(5u), 3)) * u.params.rimAmp; // ~30–80 %, keine gleichmäßige Wand

    // 6) Straßen — gewinnt über allem: Fahrbahn folgt dem Gelände im Band Level ± roadTolerance, daneben
    // Böschung mit fester Neigung (Gelände in einen Kegel um das Band geklemmt → Kante nur, wo das Gelände
    // stärker abweicht; tiefer Einschnitt = breitere Böschung, keine Wand)
    // vereinfacht: nur die nächste Straße klemmt – Kreuzungen mit abweichendem Level knicken an der Mittellinie
    if (nRoads > 0u) {
        let e = u.params.roadTolerance + bank(max(dMin - u.params.roadHalfWidth, 0.0), s0);
        h = clamp(h, roadL - e, roadL + e);
    }

    heights[idx] = clamp(h / u.params.maxH, 0.0, 1.0);
    roadMask[idx] = 1.0 - smoothstep(u.params.roadHalfWidth, u.params.roadHalfWidth + 1.0, dMin); // nur Fahrbahn (Farbe)
}
