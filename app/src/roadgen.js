// Seed-basiertes Straßennetz auf der CPU (→ Plan/TerrainStrassennetz.md)
// Orte + Ausfahrten (planNetwork) → Dijkstra je Kante auf dem 128²-Terrain-Grid mit gemeinsamem
// Kostenfeld (vorhandene Straßen billig, Band daneben teuer) → Glättung → 32 Punkte je Straße
// + Levels aus 2D-geglättetem Terrain (+ roadOffset).
// Feste Größe MAX_ROADS×ROAD_POINTS — WGSL hat dieselben Konstanten (Layout-Test prüft).

export const MAX_ROADS = 16;
export const ROAD_POINTS = 32;
const BAND_WIDTH = 12; // m neben einer Straße: teuer → spätere Straßen münden ein statt parallel zu laufen
const BAND_AVOID = 3;  // Zusatzkosten pro m im Band
const PATH_SMOOTH = 3; // Zellen Halbfenster gleitender Mittelwert (16-Nachbar-Pfad → Kurven statt Knicke)

// Deterministischer PRNG: gleicher Seed → gleiche Straßen
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Punktliste (x, y, …) auf n Punkte mit gleichem Bogenabstand resample
function resample(pts, n) {
    const m = pts.length / 2;
    const cum = new Float64Array(m);
    for (let i = 1; i < m; i++) {
        cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    }
    const total = cum[m - 1];
    const out = new Float32Array(n * 2);
    let seg = 0;
    for (let i = 0; i < n; i++) {
        const s = (total * i) / (n - 1);
        while (seg < m - 2 && cum[seg + 1] < s) { seg++; }
        const len = cum[seg + 1] - cum[seg];
        const t = len > 1e-9 ? (s - cum[seg]) / len : 0;
        out[2 * i] = pts[2 * seg] + (pts[2 * seg + 2] - pts[2 * seg]) * t;
        out[2 * i + 1] = pts[2 * seg + 1] + (pts[2 * seg + 3] - pts[2 * seg + 1]) * t;
    }
    return out;
}

// Corner-Cutting (Endpunkte bleiben) — glättet Dijkstras Treppensteg-Pfade
function chaikin(pts, iterations) {
    let p = pts.slice();
    for (let k = 0; k < iterations; k++) {
        const m = p.length / 2;
        const out = [p[0], p[1]];
        for (let i = 1; i < m - 1; i++) {
            const ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * i + 2], by = p[2 * i + 3];
            out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by);
            out.push(0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
        }
        out.push(p[p.length - 2], p[p.length - 1]);
        p = out;
    }
    return p;
}

// Bilineare Geländehöhe in Metern (Pixelzentren bei (i+0.5), Kanten geclamped)
export function sampleTerrain(terrain, mapSize, x, y) {
    const N = terrain.size, d = terrain.data, cs = mapSize / N;
    const fx = Math.min(Math.max(x / cs - 0.5, 0), N - 1.001);
    const fy = Math.min(Math.max(y / cs - 0.5, 0), N - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = x0, xb = Math.min(x0 + 1, N - 1);
    const ya = y0, yb = Math.min(y0 + 1, N - 1);
    const top = d[ya * N + xa] * (1 - tx) + d[ya * N + xb] * tx;
    const bot = d[yb * N + xa] * (1 - tx) + d[yb * N + xb] * tx;
    return top * (1 - ty) + bot * ty;
}

// Gleitender Mittelwert über Punktpaare, Fenster schrumpft zu den Enden → Endpunkte bleiben
function smoothPath(pts, half) {
    const m = pts.length / 2, out = pts.slice();
    for (let i = 1; i < m - 1; i++) {
        const w = Math.min(half, i, m - 1 - i);
        let sx = 0, sy = 0;
        for (let k = i - w; k <= i + w; k++) { sx += pts[2 * k]; sy += pts[2 * k + 1]; }
        out[2 * i] = sx / (2 * w + 1);
        out[2 * i + 1] = sy / (2 * w + 1);
    }
    return out;
}

// Separabler Box-Blur (Radius r Zellen, Kanten geclamped) → Level-Feld: gleiche Stelle = gleiches Level
function blurTerrain(terrain, r) {
    if (r < 1) return terrain;
    const N = terrain.size, src = terrain.data;
    const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += src[y * N + Math.min(Math.max(x + k, 0), N - 1)];
        tmp[y * N + x] = s / (2 * r + 1);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[Math.min(Math.max(y + k, 0), N - 1) * N + x];
        out[y * N + x] = s / (2 * r + 1);
    }
    return { size: N, data: out };
}

// → { points (MAX_ROADS×ROAD_POINTS×2), levels (MAX_ROADS×ROAD_POINTS), count, nodes, edges }
export function generateRoads(seed, mapSize, terrain, opts) {
    const net = planNetwork(seed, mapSize, terrain, opts);
    const edges = net.edges.slice(0, MAX_ROADS);
    const N = terrain.size, cs = mapSize / N;
    const points = new Float32Array(MAX_ROADS * ROAD_POINTS * 2);
    const levels = new Float32Array(MAX_ROADS * ROAD_POINTS);
    const cellX = x => Math.min(N - 1, Math.max(0, Math.floor(x / cs)));
    const field = new Uint8Array(N * N); // 0 frei, 1 Band neben Straße, 2 Straße
    const band = Math.ceil(BAND_WIDTH / cs);
    const levelField = blurTerrain(terrain, Math.round(opts.levelSmoothing / cs));
    edges.forEach(([ia, ib], r) => {
        const A = net.nodes[ia], B = net.nodes[ib];
        const path = dijkstra(terrain, mapSize, cellX(A.x) + cellX(A.y) * N, cellX(B.x) + cellX(B.y) * N, opts, field);
        for (const c of path) {
            const cx = c % N, cy = (c / N) | 0;
            for (let y = Math.max(cy - band, 0); y <= Math.min(cy + band, N - 1); y++)
                for (let x = Math.max(cx - band, 0); x <= Math.min(cx + band, N - 1); x++)
                    if (field[y * N + x] === 0) field[y * N + x] = 1;
        }
        // Straßenzellen inkl. Zwischenzelle der Springer-Züge (sonst Lücken → Band-Kosten auf der Straße)
        path.forEach((c, i) => {
            field[c] = 2;
            if (i > 0) {
                const p = path[i - 1];
                field[Math.round(((c / N | 0) + (p / N | 0)) / 2) * N + Math.round((c % N + p % N) / 2)] = 2;
            }
        });

        // Welt-Punkte: Knoten A, Zellenzentren, Knoten B → Mittelwert + Chaikin → Resample
        const pts = [A.x, A.y];
        for (const c of path) pts.push((c % N + 0.5) * cs, ((c / N | 0) + 0.5) * cs);
        pts.push(B.x, B.y);
        const res = resample(chaikin(smoothPath(pts, PATH_SMOOTH), 2), ROAD_POINTS);
        points.set(res, r * ROAD_POINTS * 2);
        // Level nie unter Wasser (Damm statt Graben)
        for (let i = 0; i < ROAD_POINTS; i++) {
            const l = sampleTerrain(levelField, mapSize, res[2 * i], res[2 * i + 1]) + opts.roadOffset;
            levels[r * ROAD_POINTS + i] = Math.max(l, opts.waterLevel + opts.roadOffset);
        }
    });
    return { points, levels, count: edges.length, nodes: net.nodes, edges };
}

// Netz-Knoten + Kanten (→ Plan/TerrainStrassennetz.md N1)
const TOWN_CANDIDATES = 256;
const TOWN_PROBE = 10; // m: 3×3-Probe im Abstand → Höhenspanne = Flachheit der Ortsfläche
const MIN_LINK_ANGLE = 35 * Math.PI / 180; // Zusatzkanten nicht fast parallel zu vorhandenen

// Orte: flach + trocken + außerhalb Randzone, gierig (flachste zuerst) mit Mindestabstand.
// Ausfahrten: gleichmäßig über den Umfang verteilt, am Ringfuß. Kanten: MST über Orte + extraLinks kürzeste
// Zusatzkanten (Winkelcheck) + jede Ausfahrt → nächster Ort. → { nodes: [{x, y, exit}], edges: [[a, b]] }
export function planNetwork(seed, mapSize, terrain, opts) {
    const rand = mulberry32(seed ^ 0x9e3779b9);
    const margin = opts.rimZone + TOWN_PROBE;
    const cands = [];
    for (let k = 0; k < TOWN_CANDIDATES; k++) {
        const x = margin + rand() * (mapSize - 2 * margin);
        const y = margin + rand() * (mapSize - 2 * margin);
        let lo = Infinity, hi = -Infinity;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const h = sampleTerrain(terrain, mapSize, x + i * TOWN_PROBE, y + j * TOWN_PROBE);
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
        }
        if (lo < opts.waterLevel + 1) continue;
        cands.push({ x, y, score: hi - lo, k });
    }
    cands.sort((a, b) => a.score - b.score || a.k - b.k);
    const nodes = [];
    for (const c of cands) {
        if (nodes.length >= opts.townCount) break;
        if (nodes.every(n => Math.hypot(n.x - c.x, n.y - c.y) >= opts.townSpacing)) nodes.push({ x: c.x, y: c.y, exit: false });
    }
    const nT = nodes.length;

    const off = rand();
    for (let k = 0; k < opts.exitCount; k++) {
        const s = (((k + off) / opts.exitCount + 0.1 * (rand() - 0.5)) % 1 + 1) % 1 * 4;
        // auf dem um rimZone eingerückten Quadrat = Ringfuß (rimF = 0) → Ring bleibt geschlossen
        const [x, y] = edgePoint(Math.floor(s), Math.min(Math.max(s % 1, 0.1), 0.9), mapSize - 2 * opts.rimZone);
        nodes.push({ x: x + opts.rimZone, y: y + opts.rimZone, exit: true });
    }

    const d = (a, b) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
    const edges = [];
    // MST (Prim) über die Orte
    const inTree = nodes.map((_, i) => i === 0);
    for (let m = 1; m < nT; m++) {
        let best = null, bd = Infinity;
        for (let i = 0; i < nT; i++) if (inTree[i]) for (let j = 0; j < nT; j++) {
            if (!inTree[j] && d(i, j) < bd) { bd = d(i, j); best = [i, j]; }
        }
        inTree[best[1]] = true;
        edges.push(best);
    }
    // Zusatzkanten für Schleifen: kürzeste zuerst, Winkel ≥ MIN_LINK_ANGLE zu allen Kanten an beiden Enden
    const dir = (a, b) => Math.atan2(nodes[b].y - nodes[a].y, nodes[b].x - nodes[a].x);
    const angleOk = (a, b) => edges.every(([p, q]) => {
        const o = p === a ? q : q === a ? p : -1;
        if (o < 0) return true;
        const diff = Math.abs(((dir(a, b) - dir(a, o)) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
        return diff >= MIN_LINK_ANGLE;
    });
    const pairs = [];
    for (let i = 0; i < nT; i++) for (let j = i + 1; j < nT; j++) {
        if (!edges.some(([p, q]) => (p === i && q === j) || (p === j && q === i))) pairs.push([i, j]);
    }
    pairs.sort((p, q) => d(p[0], p[1]) - d(q[0], q[1]));
    let extra = 0;
    for (const [i, j] of pairs) {
        if (extra >= opts.extraLinks) break;
        if (angleOk(i, j) && angleOk(j, i)) { edges.push([i, j]); extra++; }
    }
    // Ausfahrt → nächster Ort
    for (let e = nT; e < nodes.length && nT > 0; e++) {
        let best = 0;
        for (let t = 1; t < nT; t++) if (d(e, t) < d(e, best)) best = t;
        edges.push([e, best]);
    }
    return { nodes, edges };
}

function edgePoint(edge, t, mapSize) {
    if (edge === 0) return [t * mapSize, 0];
    if (edge === 1) return [mapSize, t * mapSize];
    if (edge === 2) return [t * mapSize, mapSize];
    return [0, t * mapSize];
}

// Dijkstra 16-Nachbarn (inkl. Springer-Züge: 26,6°-Schritte statt 45°-Zickzack);
// Kantenkosten = length + slopePenalty·|Δh| (+ waterAvoid·length unter waterLevel); Rand-Ring steckt im
// Prepass-Gelände → wird über slopePenalty gemieden. Kostenfeld `field`: auf Straße × reuse, im Band daneben + BAND_AVOID·length.
// Feste Nachbar-Reihenfolge + striktes < → deterministisch (→ Plan/Roads.md „Routing“)
function dijkstra(terrain, mapSize, start, goal, opts, field) {
    const N = terrain.size, h = terrain.data, cs = mapSize / N, nN = N * N;
    const dist = new Float64Array(nN).fill(Infinity);
    const prev = new Int32Array(nN).fill(-1);
    // Min-Heap mit decrease-key (pos): jeder Knoten max. 1× im Heap → Größe ≤ nN (Arrays fix nN)
    const heapN = new Int32Array(nN);
    const heapK = new Float64Array(nN);
    const pos = new Int32Array(nN).fill(-1);
    let hs = 0;
    function siftUp(i) {
        const node = heapN[i], key = heapK[i];
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heapK[p] <= key) break;
            heapK[i] = heapK[p]; heapN[i] = heapN[p];
            pos[heapN[i]] = i;
            i = p;
        }
        heapK[i] = key; heapN[i] = node;
        pos[node] = i;
    }
    function pushOrDec(node, key) {
        const p = pos[node];
        if (p >= 0) {
            if (key < heapK[p]) { heapK[p] = key; siftUp(p); }
            return;
        }
        heapN[hs] = node; heapK[hs] = key; pos[node] = hs;
        siftUp(hs++);
    }
    function pop() {
        const top = heapN[0];
        pos[top] = -1;
        const node = heapN[--hs], key = heapK[hs];
        if (hs > 0) {
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                // gegen key des nachgerückten Knotens vergleichen, nicht heapK[i] (= alte Wurzel)
                let m = i, mk = key;
                if (l < hs && heapK[l] < mk) { m = l; mk = heapK[l]; }
                if (r < hs && heapK[r] < mk) m = r;
                if (m === i) break;
                heapK[i] = heapK[m]; heapN[i] = heapN[m];
                pos[heapN[i]] = i;
                i = m;
            }
            heapK[i] = key; heapN[i] = node;
            pos[node] = i;
        }
        return top;
    }
    const NB = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
        [-2, -1], [-1, -2], [1, -2], [2, -1], [-2, 1], [-1, 2], [1, 2], [2, 1]];
    dist[start] = 0;
    pushOrDec(start, 0);
    while (hs > 0) {
        const u = pop();
        const du = dist[u];
        if (u === goal) break;
        const ux = u % N, uy = (u / N) | 0;
        for (let k = 0; k < NB.length; k++) {
            const x = ux + NB[k][0], y = uy + NB[k][1];
            if (x < 0 || y < 0 || x >= N || y >= N) continue;
            const v = y * N + x;
            const len = Math.hypot(NB[k][0], NB[k][1]) * cs;
            let c = len + opts.slopePenalty * Math.abs(h[v] - h[u]);
            if (h[u] < opts.waterLevel || h[v] < opts.waterLevel) c += opts.waterAvoid * len;
            if (field[v] === 2) c *= opts.reuse;
            else if (field[v] === 1) c += BAND_AVOID * len;
            const nd = du + c;
            if (nd < dist[v]) {
                dist[v] = nd;
                prev[v] = u;
                pushOrDec(v, nd);
            }
        }
    }
    const path = [];
    for (let v = goal; v !== -1; v = prev[v]) path.push(v);
    path.reverse();
    return path;
}