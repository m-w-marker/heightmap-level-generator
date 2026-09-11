// Seed-basierte Straßen-Polylines auf der CPU (→ Plan/Roads.md)
// Dijkstra auf dem 128²-Terrain-Grid (Edge-to-Edge, Steigungs-/Wasser-Vermeidung),
// Chaikin-Glättung, äquidistant auf 32 Punkte resampled + terrain-followende Levels
// (gleitender Mittelwert + roadOffset).
// Feste Größe 8×32 — WGSL hardcodiert array<vec4, 256> und die Loop.

export const MAX_ROADS = 8;
export const ROAD_POINTS = 32;

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

export function generateRoads(seed, mapSize, count, terrain, opts) {
    const rand = mulberry32(seed);
    const n = Math.min(Math.max(count, 0), MAX_ROADS);
    const N = terrain.size, cs = mapSize / N;
    const points = new Float32Array(MAX_ROADS * ROAD_POINTS * 2);
    const levels = new Float32Array(MAX_ROADS * ROAD_POINTS);
    const cellX = x => Math.min(N - 1, Math.max(0, Math.floor(x / cs)));
    for (let r = 0; r < n; r++) {
        // Start an zufälliger Kante (t geclamped, keine degenerierten Ecken-Straßen),
        // Ziel auf gegenüberliegender (50 %) oder benachbarter Kante
        const edge = Math.floor(rand() * 4);
        const [sx, sy] = edgePoint(edge, 0.02 + 0.96 * rand(), mapSize);
        const tEdge = rand() < 0.5 ? edge ^ 2 : (edge + 1 + 2 * Math.floor(rand() * 2)) % 4;
        const [tx, ty] = edgePoint(tEdge, 0.02 + 0.96 * rand(), mapSize);

        const path = dijkstra(terrain, mapSize, cellX(sx) + cellX(sy) * N, cellX(tx) + cellX(ty) * N, opts);
        // Welt-Punkte: Startpunkt, Grid-Zellenzentren, Zielpunkt → Chaikin → Resample
        const pts = [sx, sy];
        for (const c of path) pts.push((c % N + 0.5) * cs, ((c / N | 0) + 0.5) * cs);
        pts.push(tx, ty);
        const res = resample(chaikin(pts, 2), ROAD_POINTS);
        points.set(res, r * ROAD_POINTS * 2);

        // Terrain-followende Levels: bilinear Höhe → gleitender Mittelwert (levelSmoothing Punkte) → + roadOffset
        const half = Math.floor(opts.levelSmoothing / 2);
        for (let i = 0; i < ROAD_POINTS; i++) {
            let sum = 0, c = 0;
            for (let k = Math.max(0, i - half); k <= Math.min(ROAD_POINTS - 1, i + half); k++) {
                sum += sampleTerrain(terrain, mapSize, res[2 * k], res[2 * k + 1]);
                c++;
            }
            levels[r * ROAD_POINTS + i] = sum / c + opts.roadOffset;
        }
    }
    return { points, levels };
}

function edgePoint(edge, t, mapSize) {
    if (edge === 0) return [t * mapSize, 0];
    if (edge === 1) return [mapSize, t * mapSize];
    if (edge === 2) return [t * mapSize, mapSize];
    return [0, t * mapSize];
}

// Dijkstra 8-Nachbarn; Kantenkosten = length + slopePenalty·|Δh| (+ waterAvoid·length unter waterLevel)
// (+ rimAvoid·length·Ring-Gewicht: Prepass hat keinen Ring, Straßen dort werden zu Pässen → nur queren).
// Feste Nachbar-Reihenfolge + striktes < → deterministisch (→ Plan/Roads.md „Routing“)
function dijkstra(terrain, mapSize, start, goal, opts) {
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
    // Ring-Gewicht wie rimF in heightmap.wgsl: 1 an der Kante → 0 bei rimZone
    function rimWeight(x, y) {
        const e = Math.min(x + 0.5, y + 0.5, N - 0.5 - x, N - 0.5 - y) * cs;
        const t = Math.min(e / opts.rimZone, 1);
        return 1 - t * t * (3 - 2 * t);
    }
    const NB = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    dist[start] = 0;
    pushOrDec(start, 0);
    while (hs > 0) {
        const u = pop();
        const du = dist[u];
        if (u === goal) break;
        const ux = u % N, uy = (u / N) | 0;
        for (let k = 0; k < 8; k++) {
            const x = ux + NB[k][0], y = uy + NB[k][1];
            if (x < 0 || y < 0 || x >= N || y >= N) continue;
            const v = y * N + x;
            const len = Math.hypot(NB[k][0], NB[k][1]) * cs;
            let c = len + opts.slopePenalty * Math.abs(h[v] - h[u]);
            if (h[u] < opts.waterLevel || h[v] < opts.waterLevel) c += opts.waterAvoid * len;
            if (opts.rimAmp > 0) c += opts.rimAvoid * len * rimWeight(x, y);
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