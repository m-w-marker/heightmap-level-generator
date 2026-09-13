// Heightmap-Generator (Compute) — res² über mapSize² m (Default 1024² über 512 m)
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
    waterLevel: f32,
    riverCount: f32,
    erosionRes: f32, // Raster von erosionDelta, wächst mit der Map (→ Plan/Aufloesung.md)
    lakeRes: f32,    // Raster des See-Spiegelfelds = Prepass
};

// = MAX_ROADS / ROAD_POINTS / MAX_TOWNS in roadgen.js (Layout-Test prüft); roads-Array-Größe = Produkt
const MAX_ROADS = 16u;
const ROAD_POINTS = 32u;
const MAX_TOWNS = 8u;
const MAX_RIVERS = 16u;   // = MAX_RIVERS / RIVER_POINTS / RIVER_WET in hydro.js
const RIVER_POINTS = 32u;
const RIVER_WET = 1.0;    // m: Wasser reicht über das Bett hinaus
const RIVER_DEPTH = 0.5;  // Tiefe je m halber Breite (= ¼ Breite)
const RIVER_BANK = 0.577; // tan 30°: Ufer über dem Spiegel, danach steiler wie die Straßen-Böschung
const LAKE_EDGE = 0.25;   // bilineare Seemaske: Wasser bis ~¾ Zelle über die Seezellen hinaus
// m: Fluss-Spiegel unter dem 128²-Spiegel aus hydro.js → das 1024²-Gelände neben dem Bett (Noise ±0,3 m) bleibt trocken,
// Wasser endet an der glatten Bettkante; sonst endete es am nassen Streifen über tieferer Aue → Zacken im Wasser-Mesh
const RIVER_SINK = 0.4; // = RIVER_SINK in hydro.js (Layout JSON)

const SLOPE_VAR_WAVE = 40.0; // m
const SLOPE_MIN = 0.1745;    // 10° in rad
const SLOPE_MAX = 1.0472;    // 60° in rad (steiler → senkrechte Streifenwände im 512²-Mesh)
const BANK_CURVE = 10.0;     // m: Böschungsneigung (tan) wächst je BANK_CURVE m Abstand um 1 (→ Plan/Boeschung.md)
const CLEARING_BANK = 0.268; // tan 15°: Lichtungsrand startet flacher als die Straßen-Böschung → keine Gruben am Hang
const CLEARING_WOBBLE = 0.5; // Radius ±50 % per Noise → unregelmäßiger Umriss statt Kreis
const CLEARING_LOBES = 1.0;  // Noise-Einheiten Radius des Umriss-Kreises → 2πL Zellen ≈ 3–4 Ausbuchtungen je Lichtung
const CLEARING_SOFT = 3.0;   // Lichtungs-Böschung wird CLEARING_SOFT-mal langsamer steil als die Straßen-Böschung
const CLEARING_KEEP = 0.5;   // m Restwelligkeit im Kern → nicht spiegelglatt
const TOWN_FADE = 4.0;       // m weicher Rand der townMask hinter dem Lichtungs-Umriss (= TOWN_FADE in masks.js)
// Straßen-Koordinaten roadUV (→ Plan/Biome.md, Codierung in masks.js)
const DASH_PERIOD = 12.0;    // m Strich + Lücke (= DASH_PERIOD in masks.js)
const UV_REACH = 1.5;        // m über die Fahrbahnkante: so weit gilt die Straße mit dem kleinsten Index
const PARALLEL_COS = 0.94;   // |cos| ≥ 20°-Grenze: geteilte Strecken (Road sharing) sind parallel, keine Kreuzung
const MARK_GAP = 1.0;        // m: Markierungen enden so weit vor einer kreuzenden Fahrbahn / einem Ortsrand
const MARK_FADE = 4.0;       // m Ausblenden danach

// Punkt = vec4(x, y, level m, Bogenlänge m), Ort = vec4(x, y, level m, 0)
// vec4 statt vec2: im uniform-Adressraum muss der Array-Stride ein Vielfaches von 16 sein (→ .clinerules/wgsl.md)
struct Uniforms {
    params: Params,
    roads: array<vec4<f32>, 512>,
    towns: array<vec4<f32>, 8>,
    rivers: array<vec4<f32>, 512>, // vec4(x, y, Spiegel m, halbe Breite m) (→ Plan/Fluesse.md)
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> heights: array<f32>;
@group(0) @binding(2) var<storage, read_write> roadMask: array<f32>;
@group(0) @binding(3) var<storage, read> erosionDelta: array<f32>; // erosionRes², erodiert − roh in m
@group(0) @binding(4) var<storage, read_write> water: array<f32>;  // res², Spiegel von See/Fluss in m, 0 = nur Meer
@group(0) @binding(5) var<storage, read> lakes: array<f32>;        // lakeRes², See-Spiegel in m (0 = kein See)
@group(0) @binding(6) var<storage, read_write> townMask: array<f32>; // res², Lichtung 1 → 0 über TOWN_FADE (nur Export)
@group(0) @binding(7) var<storage, read_write> roadUV: array<u32>;   // res², RGBA8 (pack4x8unorm) fürs Material

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

// erosionDelta bilinear an w (Pixelzentren bei (k + 0.5) / erosionRes wie sampleBilinear in export.js, Kanten geclamped)
fn erosionAt(w: vec2<f32>) -> f32 {
    let n = i32(u.params.erosionRes);
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
    // Organisch statt Kreis: Radius je Richtung per Noise ±CLEARING_WOBBLE (nur vom Winkel abhängig → zusammenhängend;
    // Noise über der Weltposition stanzte Inseln = Krater neben die Lichtung), innen bleiben ±CLEARING_KEEP m Wellen,
    // weiche Sättigung e·tanh(Δ/e) statt clamp → kein Knick am Rand. Vor Rand-Ring (bleibt geschlossen) und Straßen
    // (gewinnen weiter) (→ Plan/Roadmap.md R12)
    let cr = u.params.clearingRadius;
    let nTowns = select(0u, min(u32(u.params.clearingCount), MAX_TOWNS), cr > 0.0); // Radius 0 = aus
    var townM = 0.0;
    for (var t = 0u; t < nTowns; t = t + 1u) {
        let c = u.towns[t];
        let d = length(w - c.xy);
        let dir = (w - c.xy) / max(d, 1e-3);
        let wobble = 1.0 + CLEARING_WOBBLE * vnoise(dir * CLEARING_LOBES, mix32(layerKey(7u) + t));
        let dOut = max(d - cr * wobble, 0.0);
        let e = CLEARING_KEEP + bank(dOut / CLEARING_SOFT, CLEARING_BANK) * CLEARING_SOFT;
        h = c.z + e * tanh(clamp((h - c.z) / e, -10.0, 10.0)); // clamp: tanh großer Argumente → exp-Überlauf (NaN) je GPU
        townM = max(townM, 1.0 - smoothstep(0.0, TOWN_FADE, dOut));
    }

    // 4) Straßen: nächstes Segment liefert Distanz + Level (linear zwischen den Endpunkten) (→ .clinerules/wgsl.md)
    var roadL = 0.0;
    var dMin = 1e9;
    let nRoads = min(u32(u.params.roadCount), MAX_ROADS);
    // je Straße ihr nächstes Segment: Abstand, Querabstand mit Seite, Bogenlänge, Richtung → roadUV
    var rD: array<f32, MAX_ROADS>;
    var rLat: array<f32, MAX_ROADS>;
    var rS: array<f32, MAX_ROADS>;
    var rDir: array<vec2<f32>, MAX_ROADS>;
    for (var r = 0u; r < nRoads; r = r + 1u) {
        let base = r * ROAD_POINTS;
        rD[r] = 1e9;
        for (var s = 0u; s + 1u < ROAD_POINTS; s = s + 1u) {
            let a = u.roads[base + s];
            let b = u.roads[base + s + 1u];
            let dt = distPointSeg(w, a.xy, b.xy);
            if (dt.x < dMin) {
                dMin = dt.x;
                roadL = mix(a.z, b.z, dt.y);
            }
            if (dt.x < rD[r]) {
                let ab = b.xy - a.xy;
                let pa = w - a.xy;
                rD[r] = dt.x;
                rLat[r] = select(dt.x, -dt.x, ab.x * pa.y - ab.y * pa.x < 0.0);
                rS[r] = mix(a.w, b.w, dt.y);
                rDir[r] = ab / max(length(ab), 1e-6);
            }
        }
    }

    // 5) Rand-Ring: Anhöhe Richtung Map-Kante, geschlossen (Horizont) — Ausfahrten enden am Ringfuß
    // Abstand hinter das um rimZone eingerückte Quadrat (Ecken rund statt min()-Diagonalknick)
    let half = 0.5 * u.params.mapSize;
    let beyond = length(max(abs(w - half) - (half - u.params.rimZone), vec2<f32>(0.0)));
    let rimF = smoothstep(0.0, u.params.rimZone, beyond);
    h += rimF * (0.55 + 0.6 * fbm(w * u.params.rimScale, layerKey(5u), 3)) * u.params.rimAmp; // ~30–80 %, keine gleichmäßige Wand

    // 5b) Seen + Flüsse (→ Plan/Fluesse.md): See-Spiegel = Maximum der 2×2 nächsten Zellen des 128²-Felds, nur wo die
    // bilineare Seemaske ≥ LAKE_EDGE → Ufer = Höhenlinie in voller Auflösung, außen begrenzt durch den geglätteten Seeumriss
    // (feste 3×3-Dilatation schnitt tiefer liegendes 1024²-Gelände als Quadrat ab). Fluss: nächstes Segment wie bei den
    // Straßen; Bett parabolisch bis Spiegel − Tiefe, daneben Ufer per bank() über dem Spiegel; nur abtragen, nie aufschütten.
    // Straßen danach → Damm an Kreuzungen
    var wl = u.params.waterLevel;
    let lakeN = u32(u.params.lakeRes);
    let lf = w / u.params.mapSize * f32(lakeN) - 0.5;
    let l0 = vec2<i32>(floor(lf));
    let lt = lf - floor(lf);
    var lakeW = 0.0;
    var lakeL = 0.0;
    for (var k = 0; k < 4; k++) {
        let o = vec2<i32>(k & 1, k >> 1);
        let c = clamp(l0 + o, vec2<i32>(0), vec2<i32>(i32(lakeN) - 1));
        let lv = lakes[u32(c.y) * lakeN + u32(c.x)];
        let wt = select(1.0 - lt.x, lt.x, o.x == 1) * select(1.0 - lt.y, lt.y, o.y == 1);
        lakeW += select(0.0, wt, lv > 0.0);
        lakeL = max(lakeL, lv);
    }
    if (lakeW >= LAKE_EDGE) { wl = max(wl, lakeL); }
    let nRivers = min(u32(u.params.riverCount), MAX_RIVERS);
    if (nRivers > 0u) {
        var rD = 1e9;
        var rL = 0.0;
        var rW = 1.0;
        for (var r = 0u; r < nRivers; r = r + 1u) {
            let base = r * RIVER_POINTS;
            for (var s = 0u; s + 1u < RIVER_POINTS; s = s + 1u) {
                let a = u.rivers[base + s];
                let b = u.rivers[base + s + 1u];
                let dt = distPointSeg(w, a.xy, b.xy);
                if (dt.x < rD) {
                    rD = dt.x;
                    rL = mix(a.z, b.z, dt.y);
                    rW = mix(a.w, b.w, dt.y);
                }
            }
        }
        rL -= RIVER_SINK;
        let q = min(rD / rW, 1.0);
        h = min(h, select(rL + bank(rD - rW, RIVER_BANK), rL - rW * RIVER_DEPTH * (1.0 - q * q), rD < rW));
        if (rD < rW + RIVER_WET) { wl = max(wl, rL); }
    }
    let hPre = h;

    // 6) Straßen — gewinnt über allem: Fahrbahn folgt dem Gelände im Band Level ± roadTolerance, daneben
    // Böschung mit fester Neigung (Gelände in einen Kegel um das Band geklemmt → Kante nur, wo das Gelände
    // stärker abweicht; tiefer Einschnitt = breitere Böschung, keine Wand)
    // vereinfacht: nur die nächste Straße klemmt – Kreuzungen mit abweichendem Level knicken an der Mittellinie
    if (nRoads > 0u) {
        let e = u.params.roadTolerance + bank(max(dMin - u.params.roadHalfWidth, 0.0), s0);
        h = clamp(h, roadL - e, roadL + e);
    }

    heights[idx] = clamp(h / u.params.maxH, 0.0, 1.0);
    // See/Fluss nur, wo das Gelände vor den Straßen unter dem Spiegel lag und die Straße es nicht abgesenkt hat → ein
    // Straßeneinschnitt am See läuft nicht voll (→ RAISE_MAX in roadgen.js); nie auf der Fahrbahn (Damm/Durchlass, fängt
    // Rampen am Ufer ab, die limitGrade durch den Spiegel legt). 0 = Meer: JS nimmt dann waterLevel exakt (f32 ≠ f64)
    let lane = dMin < u.params.roadHalfWidth + 0.5; // = roadMask ≥ 0.5
    water[idx] = select(0.0, wl, wl > u.params.waterLevel && hPre < wl && h >= hPre - 0.01 && !(nRoads > 0u && lane));
    roadMask[idx] = 1.0 - smoothstep(u.params.roadHalfWidth, u.params.roadHalfWidth + 1.0, dMin); // nur Fahrbahn (Farbe)
    townMask[idx] = townM;
    roadUV[idx] = roadCoords(w, nRoads, &rD, &rLat, &rS, &rDir);
}

// Koordinaten der Straße mit dem kleinsten Index in Reichweite, nicht der nächsten: geteilte Strecken (Road sharing) liegen
// als zwei leicht versetzte Polylines übereinander → die nächste wechselte ständig, Querabstand und Strich-Phase sprängen.
// Markierung aus nahe einer nicht parallelen Straße (Kreuzung, Abzweig) und an Orten
fn roadCoords(w: vec2<f32>, nRoads: u32, rD: ptr<function, array<f32, MAX_ROADS>>, rLat: ptr<function, array<f32, MAX_ROADS>>,
              rS: ptr<function, array<f32, MAX_ROADS>>, rDir: ptr<function, array<vec2<f32>, MAX_ROADS>>) -> u32 {
    let hw = u.params.roadHalfWidth;
    var c = MAX_ROADS;
    for (var r = 0u; r < nRoads; r = r + 1u) {
        if ((*rD)[r] < hw + UV_REACH) { c = r; break; }
    }
    if (c == MAX_ROADS) { return 0u; }
    var dCross = 1e9;
    for (var r = 0u; r < nRoads; r = r + 1u) {
        if (r != c && abs(dot((*rDir)[r], (*rDir)[c])) < PARALLEL_COS) { dCross = min(dCross, (*rD)[r]); }
    }
    // nur auf der Fahrbahn: am Rand der Reichweite mischt die lineare Filterung mit „keine Straße“ (Querabstand −1) →
    // der Übergang kreuzte sonst Mittel- und Randlinie
    var allow = smoothstep(hw + MARK_GAP, hw + MARK_GAP + MARK_FADE, dCross) * (1.0 - smoothstep(hw, hw + 0.5, (*rD)[c]));
    // Straßenenden (Ort, Ausfahrt): hinter dem letzten Punkt ist der Abstand radial → Randlinie würde zum Kreisbogen
    let len = u.roads[c * ROAD_POINTS + ROAD_POINTS - 1u].w;
    allow *= smoothstep(MARK_GAP, MARK_GAP + MARK_FADE, min((*rS)[c], len - (*rS)[c]));
    let tr = u.params.clearingRadius * (1.0 + CLEARING_WOBBLE) + MARK_GAP;
    for (var t = 0u; t < min(u32(u.params.clearingCount), MAX_TOWNS); t = t + 1u) {
        allow *= smoothstep(tr, tr + MARK_FADE, length(w - u.towns[t].xy));
    }
    let ph = (*rS)[c] / DASH_PERIOD * 6.2831853;
    return pack4x8unorm(vec4<f32>(clamp((*rLat)[c] / hw, -1.0, 1.0) * 0.5 + 0.5, cos(ph) * 0.5 + 0.5, sin(ph) * 0.5 + 0.5, allow));
}
