// Erosion auf n² Zellen (→ Plan/Erosion.md, Plan/Aufloesung.md): virtuelle Rohre (Mei 2007) + thermisch.
// Jeder Kernel schreibt nur die eigene Zelle und liest Nachbarn aus einem Puffer, den er nicht schreibt → deterministisch.
// Je Iteration: flux → water → erode (b → bTmp) → carry (sedTmp → state.s) → thermal (bTmp → b); am Ende finish.

struct E {
    cell: f32,      // m je Zelle
    dt: f32,        // s je Schritt
    rain: f32,      // m Wasser je Schritt und Zelle
    pipe: f32,      // A·g/l der virtuellen Rohre
    fluxKeep: f32,  // Dämpfung des Rohr-Flusses je Schritt (1 = keine)
    capacity: f32,  // Sediment-Kapazität Kc (m je m/s Fließgeschwindigkeit)
    dissolve: f32,  // Anteil der freien Kapazität, der je Schritt abgetragen wird
    deposit: f32,   // Anteil des Überschusses, der je Schritt abgelagert wird
    evaporate: f32, // Verdunstung je s
    depthRef: f32,  // m: dünnerer Wasserfilm trägt anteilig weniger
    depthMax: f32,  // m: tieferes Wasser trägt nicht ab → Rinnen am Hang statt Gräben in den Tälern
    talus: f32,     // tan Schuttwinkel
    thermal: f32,   // Anteil des Überschusses über dem Schuttwinkel, der je Schritt rutscht (≤ 1/16 stabil)
    n: f32,         // Zellen je Kante, wächst mit der Map (→ Plan/Aufloesung.md); Dispatch genau n/16 → keine Randprüfung
};

const MIN_TILT = 0.05; // sin: auch fast ebenes Gelände trägt etwas Sediment

@group(0) @binding(0) var<uniform> e: E;
@group(0) @binding(1) var<storage, read_write> b: array<f32>;                // Terrain m
@group(0) @binding(2) var<storage, read_write> bTmp: array<f32>;
@group(0) @binding(3) var<storage, read_write> state: array<vec4<f32>>;      // Wasser m, Sediment m, |v| m/s, Wasser vor dem Fluss m
@group(0) @binding(4) var<storage, read_write> sedTmp: array<f32>;
@group(0) @binding(5) var<storage, read_write> flux: array<vec4<f32>>;       // Abfluss m³/s nach −x, +x, −y, +y
@group(0) @binding(6) var<storage, read_write> flow: array<f32>;             // Σ Wassertiefe · |v| (Flow-Map)
@group(0) @binding(7) var<storage, read_write> delta: array<f32>;            // Start: Roh-Terrain, Ende: erodiert − roh

fn id(x: i32, y: i32) -> u32 {
    return u32(y) * u32(e.n) + u32(x);
}

// Rohr-Fluss zu den 4 Nachbarn aus dem Wasserspiegel-Gefälle; außerhalb = trocken auf gleicher Höhe → offener Rand
@compute @workgroup_size(16, 16)
fn fluxStep(@builtin(global_invocation_id) g: vec3<u32>) {
    let x = i32(g.x);
    let y = i32(g.y);
    let n = i32(e.n);
    let i = id(x, y);
    let d = state[i].x + e.rain;
    let H = b[i] + d;
    var hn = vec4<f32>(b[i]);
    if (x > 0) { hn.x = b[id(x - 1, y)] + state[id(x - 1, y)].x + e.rain; }
    if (x < n - 1) { hn.y = b[id(x + 1, y)] + state[id(x + 1, y)].x + e.rain; }
    if (y > 0) { hn.z = b[id(x, y - 1)] + state[id(x, y - 1)].x + e.rain; }
    if (y < n - 1) { hn.w = b[id(x, y + 1)] + state[id(x, y + 1)].x + e.rain; }
    var f = max(vec4<f32>(0.0), flux[i] * e.fluxKeep + e.dt * e.pipe * (vec4<f32>(H) - hn));
    let sum = f.x + f.y + f.z + f.w;
    if (sum > 0.0) { f *= min(1.0, d * e.cell * e.cell / (sum * e.dt)); } // nie mehr abgeben als da ist
    flux[i] = f;
}

// Wassertiefe + Geschwindigkeit aus Zu- und Abfluss
@compute @workgroup_size(16, 16)
fn water(@builtin(global_invocation_id) g: vec3<u32>) {
    let x = i32(g.x);
    let y = i32(g.y);
    let n = i32(e.n);
    let i = id(x, y);
    var inL = 0.0;
    var inR = 0.0;
    var inT = 0.0;
    var inB = 0.0;
    if (x > 0) { inL = flux[id(x - 1, y)].y; }
    if (x < n - 1) { inR = flux[id(x + 1, y)].x; }
    if (y > 0) { inT = flux[id(x, y - 1)].w; }
    if (y < n - 1) { inB = flux[id(x, y + 1)].z; }
    let f = flux[i];
    let st = state[i];
    let d0 = st.x + e.rain;
    let d1 = max(d0 + e.dt * (inL + inR + inT + inB - f.x - f.y - f.z - f.w) / (e.cell * e.cell), 0.0);
    let dm = 0.5 * (d0 + d1);
    var speed = 0.0;
    if (dm > 1e-4) { speed = length(vec2<f32>(inL - f.x + f.y - inR, inT - f.z + f.w - inB)) * 0.5 / (e.cell * dm); }
    state[i] = vec4<f32>(d1, st.y, speed, d0);
    flow[i] += dm * speed;
}

// Abtrag / Ablage nach Transportkapazität C = Kc · sin(Neigung) · |v| · Tiefen-Faktor (steigt bis depthRef, fällt bis depthMax)
@compute @workgroup_size(16, 16)
fn erode(@builtin(global_invocation_id) g: vec3<u32>) {
    let x = i32(g.x);
    let y = i32(g.y);
    let n = i32(e.n);
    let i = id(x, y);
    let gx = (b[id(min(x + 1, n - 1), y)] - b[id(max(x - 1, 0), y)]) / (2.0 * e.cell);
    let gy = (b[id(x, min(y + 1, n - 1))] - b[id(x, max(y - 1, 0))]) / (2.0 * e.cell);
    let s2 = gx * gx + gy * gy;
    let sinA = max(sqrt(s2 / (1.0 + s2)), MIN_TILT);
    let st = state[i];
    let C = e.capacity * sinA * st.z * min(st.x / e.depthRef, 1.0) * max(1.0 - st.x / e.depthMax, 0.0);
    var h = b[i];
    var s = st.y;
    if (C > s) {
        let a = e.dissolve * (C - s);
        h -= a;
        s += a;
    } else {
        let a = e.deposit * (s - C);
        h += a;
        s -= a;
    }
    bTmp[i] = h;
    sedTmp[i] = s;
}

// Anteil des Wassers einer Zelle, der in diesem Schritt über das Rohr f abfließt (≤ 1 durch die Skalierung in fluxStep)
fn share(f: f32, d0: f32) -> f32 {
    return select(0.0, f * e.dt / (d0 * e.cell * e.cell), d0 > 0.0);
}

// Sediment wandert mit demselben Anteil wie das Wasser über die Rohre → massenerhaltend (semi-Lagrange verlor ~40 %);
// über den offenen Rand verlässt es die Map. Dazu Verdunstung
@compute @workgroup_size(16, 16)
fn carry(@builtin(global_invocation_id) g: vec3<u32>) {
    let x = i32(g.x);
    let y = i32(g.y);
    let n = i32(e.n);
    let i = id(x, y);
    let st = state[i];
    let f = flux[i];
    var s = sedTmp[i] * (1.0 - share(f.x + f.y + f.z + f.w, st.w));
    if (x > 0) { let k = id(x - 1, y); s += sedTmp[k] * share(flux[k].y, state[k].w); }
    if (x < n - 1) { let k = id(x + 1, y); s += sedTmp[k] * share(flux[k].x, state[k].w); }
    if (y > 0) { let k = id(x, y - 1); s += sedTmp[k] * share(flux[k].w, state[k].w); }
    if (y < n - 1) { let k = id(x, y + 1); s += sedTmp[k] * share(flux[k].z, state[k].w); }
    state[i] = vec4<f32>(st.x * max(1.0 - e.evaporate * e.dt, 0.0), s, st.zw);
}

// Thermisch: über dem Schuttwinkel rutscht Material zum Nachbarn (8er-Nachbarschaft, Fluss a→b in a und b gleich gerechnet)
@compute @workgroup_size(16, 16)
fn thermal(@builtin(global_invocation_id) g: vec3<u32>) {
    let x = i32(g.x);
    let y = i32(g.y);
    let n = i32(e.n);
    let h = bTmp[id(x, y)];
    var dh = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let nx = x + dx;
            let ny = y + dy;
            if ((dx == 0 && dy == 0) || nx < 0 || ny < 0 || nx >= n || ny >= n) { continue; }
            let hn = bTmp[id(nx, ny)];
            let lim = e.talus * e.cell * length(vec2<f32>(f32(dx), f32(dy)));
            dh += e.thermal * (max(hn - h - lim, 0.0) - max(h - hn - lim, 0.0));
        }
    }
    b[id(x, y)] = h + dh;
}

// Rest-Sediment ablegen, Differenz zum Roh-Terrain (in delta) schreiben
@compute @workgroup_size(16, 16)
fn finish(@builtin(global_invocation_id) g: vec3<u32>) {
    let i = id(i32(g.x), i32(g.y));
    delta[i] = b[i] + state[i].y - delta[i];
}
