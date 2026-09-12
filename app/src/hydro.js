// Flüsse und Seen aus dem Prepass-Gelände (→ Plan/Fluesse.md); ohne DOM, in Node testbar.
// terrain = { size: N, data: Float32Array N² in m } (Zeile = Map +y, Zellzentren bei (i + 0.5) · cs)
import { chaikin, resample, minHeap } from './roadgen.js';

export const MAX_RIVERS = 16;   // = MAX_RIVERS in heightmap.wgsl (Layout-Test prüft)
export const RIVER_POINTS = 32; // = RIVER_POINTS in heightmap.wgsl
export const RIVER_WET = 1;     // m: Wasser reicht über das Bett hinaus (= RIVER_WET in heightmap.wgsl)
const RIVER_MIN_W = 1.5;        // m Breite an der Quelle
const LAKE_MIN_DEPTH = 0.3;     // m: flachere Senken bleiben trocken
const MIN_RIVER_CELLS = 4;      // kürzere Zuflüsse weglassen
const NB8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Abstand Punkt → Segment + Parameter t
function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 1e-12 ? Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / l2, 0), 1) : 0;
    return [Math.hypot(px - ax - dx * t, py - ay - dy * t), t];
}

// Mäander quer zum Lauf: D8-Pfade auf 128² kennen nur 8 Richtungen → Flachlandflüsse wirkten wie Kanäle. Zwei Sinus mit
// inkommensurablen Wellenlängen (~12× Breite) → nicht periodisch; Amplitude ≤ Breite, an Quelle und Mündung 0, bei mittlerem
// Gefälle ≥ MEANDER_GRADE gerade (Bergbach). p = RIVER_POINTS × vec4(x, y, Spiegel, halbe Breite), k = Phase je Fluss
const MEANDER_GRADE = 0.1;
function meander(p, k) {
    const n = RIVER_POINTS, len = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(p[4 * i] - p[4 * i - 4], p[4 * i + 1] - p[4 * i - 3]));
    const L = len[n - 1];
    if (L < 1e-6) return;
    const flat = Math.max(1 - (p[2] - p[4 * n - 2]) / L / MEANDER_GRADE, 0);
    const off = [];
    for (let i = 0; i < n; i++) {
        const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
        const tx = p[4 * b] - p[4 * a], ty = p[4 * b + 1] - p[4 * a + 1], tl = Math.hypot(tx, ty) || 1;
        const lambda = 24 * p[4 * i + 3]; // 12× Breite
        const s = len[i] / lambda * 2 * Math.PI;
        const amp = 2 * p[4 * i + 3] * flat * Math.sin(Math.PI * len[i] / L);
        const d = amp * (0.6 * Math.sin(s + 1.7 * k) + 0.4 * Math.sin(1.618 * s + 0.9 * k));
        off.push([-ty / tl * d, tx / tl * d]);
    }
    off.forEach(([dx, dy], i) => { p[4 * i] += dx; p[4 * i + 1] += dy; });
}

// opts: waterLevel, rimZone, riverCatchment (% der Map-Fläche als Einzugsgebiet einer Quelle, 0 = keine Flüsse),
//       riverWidth (m an der größten Mündung), lakeArea (m² Mindestfläche eines Sees, 0 = keine Seen)
// → { rivers: Float32Array(MAX_RIVERS·RIVER_POINTS·4) = vec4(x, y, Spiegel m, halbe Breite m), riverCount,
//     lakes: Float32Array(N²) See-Spiegel m (0 = kein See), wet: Uint8Array(N²) (Meer, See, Fluss),
//     waterAt(x, y, reach) → örtlicher Wasserspiegel m (≥ waterLevel), Flüsse im Umkreis Bett + RIVER_WET + reach }
export function hydrology(terrain, mapSize, opts) {
    const N = terrain.size, h = terrain.data, cs = mapSize / N, n = N * N;
    // Abfluss: Meer + Randzone (Zellzentrum außerhalb des um rimZone eingerückten Quadrats = Ringfuß, wie die Ausfahrten).
    // Ohne Abfluss am Rand füllte der geschlossene Rand-Ring die ganze Map bis zur tiefsten Scharte
    const rim = opts.rimZone / cs - 0.5;
    const outlet = i => h[i] < opts.waterLevel || Math.min(i % N, (i / N) | 0, N - 1 - i % N, N - 1 - ((i / N) | 0)) < rim;

    // Priority-Flood (Barnes 2014): niedrigster Spiegel zuerst → Senken füllen sich bis zum Überlauf;
    // parent = Zelle, von der aus geflutet wurde = Fließrichtung (auch über flache Seen eindeutig)
    const filled = Float32Array.from(h), parent = new Int32Array(n).fill(-1), order = new Int32Array(n);
    const seen = new Uint8Array(n), heap = minHeap(n);
    for (let i = 0; i < n; i++) if (outlet(i)) { seen[i] = 1; heap.pushOrDec(i, h[i]); }
    let k = 0;
    while (heap.size > 0) {
        const c = heap.pop(), cx = c % N, cy = (c / N) | 0;
        order[k++] = c;
        for (const [dx, dy] of NB8) {
            const x = cx + dx, y = cy + dy;
            if (x < 0 || y < 0 || x >= N || y >= N || seen[y * N + x]) continue;
            const v = y * N + x;
            seen[v] = 1;
            filled[v] = Math.max(h[v], filled[c]);
            parent[v] = c;
            heap.pushOrDec(v, filled[v]);
        }
    }
    // Einzugsgebiet in m²: gegen die Flutreihenfolge aufsummieren (Oberlieger vor Unterlieger)
    const acc = new Float64Array(n).fill(cs * cs);
    for (let j = k - 1; j >= 0; j--) if (parent[order[j]] >= 0) acc[parent[order[j]]] += acc[order[j]];

    // Seen: zusammenhängende gefüllte Senken ab lakeArea m² und LAKE_MIN_DEPTH m
    const lakes = new Float32Array(n), wet = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (h[i] < opts.waterLevel) wet[i] = 1;
    const sink = i => !outlet(i) && filled[i] > h[i];
    if (opts.lakeArea > 0) {
        const comp = new Uint8Array(n);
        for (let s = 0; s < n; s++) {
            if (comp[s] || !sink(s)) continue;
            const stack = [s], cells = [];
            let depth = 0;
            comp[s] = 1;
            while (stack.length) {
                const c = stack.pop(), cx = c % N, cy = (c / N) | 0;
                cells.push(c);
                depth = Math.max(depth, filled[c] - h[c]);
                for (const [dx, dy] of NB8) {
                    const x = cx + dx, y = cy + dy, v = y * N + x;
                    if (x >= 0 && y >= 0 && x < N && y < N && !comp[v] && sink(v)) { comp[v] = 1; stack.push(v); }
                }
            }
            if (cells.length * cs * cs >= opts.lakeArea && depth >= LAKE_MIN_DEPTH)
                for (const c of cells) { lakes[c] = filled[c]; wet[c] = 1; }
        }
    }

    // Flüsse: Zellen ab Einzugsgebiet A; je Flusszelle Hauptzufluss = Zufluss mit dem größten Einzugsgebiet.
    // Ein Lauf beginnt an einer Mündung (Unterlieger kein Fluss) oder als Nebenfluss an einer Einmündung und folgt den
    // Hauptzuflüssen bis zur Quelle → jede Flusszelle gehört zu genau einem Lauf; die größten zuerst
    const rivers = new Float32Array(MAX_RIVERS * RIVER_POINTS * 4);
    const segs = []; // [ax, ay, bx, by, Spiegel a, b, halbe Breite a, b] für waterAt
    let riverCount = 0;
    if (opts.riverCatchment > 0) {
        const A = opts.riverCatchment / 100 * mapSize * mapSize;
        const isRiver = i => i >= 0 && acc[i] >= A && !outlet(i) && !lakes[i];
        const main = new Int32Array(n).fill(-1);
        let accMax = A;
        for (let i = 0; i < n; i++) {
            if (!isRiver(i)) continue;
            accMax = Math.max(accMax, acc[i]);
            const p = parent[i];
            if (isRiver(p) && (main[p] < 0 || acc[i] > acc[main[p]])) main[p] = i; // Gleichstand: kleinerer Index
        }
        const starts = [];
        for (let i = 0; i < n; i++) if (isRiver(i) && (!isRiver(parent[i]) || main[parent[i]] !== i)) starts.push(i);
        starts.sort((a, b) => acc[b] - acc[a] || a - b);
        const halfW = a => (RIVER_MIN_W + (opts.riverWidth - RIVER_MIN_W) * Math.sqrt(Math.max(a - A, 0) / Math.max(accMax - A, 1e-9))) / 2;
        const cx = c => (c % N + 0.5) * cs, cy = c => (((c / N) | 0) + 0.5) * cs;
        for (const s of starts) {
            if (riverCount >= MAX_RIVERS) break;
            const chain = [];
            for (let c = s; c >= 0; c = main[c]) chain.push(c);
            if (chain.length < MIN_RIVER_CELLS) continue;
            chain.reverse(); // Quelle → Mündung
            if (parent[s] >= 0) chain.push(parent[s]); // bis in See / Meer / Ringfuß bzw. auf den Hauptfluss
            // Mündungs-Einzugsgebiet für die Breite: der Fluss selbst, nicht der Hauptfluss, in den er mündet
            const attr = chain.map((c, i) => [Math.max(filled[c], opts.waterLevel), halfW(acc[chain[Math.min(i, chain.length - 2)]])]);
            const xy = chain.flatMap(c => [cx(c), cy(c)]);
            const cum = [0];
            for (let i = 1; i < chain.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1]));
            const pts = resample(chaikin(xy, 2), RIVER_POINTS);
            let level = Infinity;
            for (let i = 0; i < RIVER_POINTS; i++) {
                // Attribute über den Bogenlängen-Anteil vom Zellpfad übernehmen; Spiegel nie steigend (Chaikin kürzt Ecken)
                const s2 = i / (RIVER_POINTS - 1) * cum[cum.length - 1];
                let j = 0;
                while (j < cum.length - 2 && cum[j + 1] < s2) j++;
                const t = cum[j + 1] > cum[j] ? (s2 - cum[j]) / (cum[j + 1] - cum[j]) : 0;
                level = Math.min(level, attr[j][0] + (attr[j + 1][0] - attr[j][0]) * t);
                const o = (riverCount * RIVER_POINTS + i) * 4;
                rivers.set([pts[2 * i], pts[2 * i + 1], level, attr[j][1] + (attr[j + 1][1] - attr[j][1]) * t], o);
            }
            meander(rivers.subarray(riverCount * RIVER_POINTS * 4, (riverCount + 1) * RIVER_POINTS * 4), riverCount);
            for (let i = 0; i + 1 < RIVER_POINTS; i++) {
                const o = (riverCount * RIVER_POINTS + i) * 4;
                segs.push([rivers[o], rivers[o + 1], rivers[o + 4], rivers[o + 5], rivers[o + 2], rivers[o + 6], rivers[o + 3], rivers[o + 7]]);
            }
            riverCount++;
        }
    }

    // örtlicher Spiegel: Meer, See (Maximum der Zellen im Umkreis reach + 1 Zelle ≥ Seemaske im Shader), Fluss im Umkreis Bett + RIVER_WET + reach
    function waterAt(x, y, reach = 0) {
        let w = opts.waterLevel;
        const gx = Math.min(Math.max(Math.floor(x / cs), 0), N - 1), gy = Math.min(Math.max(Math.floor(y / cs), 0), N - 1);
        const r = 1 + Math.ceil(reach / cs);
        for (let j = Math.max(gy - r, 0); j <= Math.min(gy + r, N - 1); j++)
            for (let i = Math.max(gx - r, 0); i <= Math.min(gx + r, N - 1); i++) w = Math.max(w, lakes[j * N + i]);
        for (const [ax, ay, bx, by, la, lb, wa, wb] of segs) {
            const [d, t] = segDist(x, y, ax, ay, bx, by);
            if (d < wa + (wb - wa) * t + RIVER_WET + reach) w = Math.max(w, la + (lb - la) * t);
        }
        return w;
    }
    // Flusszellen als nass markieren (Routing-Strafe, Orte): je Segment nur dessen Umgebung prüfen
    for (const [ax, ay, bx, by, , , wa, wb] of segs) {
        const r = Math.max(wa, wb) + RIVER_WET + cs / 2;
        const cell = v => Math.min(Math.max(Math.floor(v / cs), 0), N - 1);
        for (let j = cell(Math.min(ay, by) - r); j <= cell(Math.max(ay, by) + r); j++)
            for (let i = cell(Math.min(ax, bx) - r); i <= cell(Math.max(ax, bx) + r); i++) {
                const [d, t] = segDist((i + 0.5) * cs, (j + 0.5) * cs, ax, ay, bx, by);
                if (d < wa + (wb - wa) * t + RIVER_WET + cs / 2) wet[j * N + i] = 1;
            }
    }

    return { rivers, riverCount, lakes, wet, waterAt };
}
