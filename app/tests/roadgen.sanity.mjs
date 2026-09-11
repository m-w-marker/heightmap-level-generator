// Node-Sanity für roadgen (→ Plan/Roads.md S2): Edge-to-Edge, in Map-Grenzen, deterministisch,
// Umgehung (lokaler Hügel), Levels = Terrain + Offset
import { generateRoads, planNetwork, sampleTerrain, MAX_ROADS, ROAD_POINTS } from '../src/roadgen.js';

const seed = 1337;
const mapSize = 400;
const N = 128;
const opts = { waterLevel: 15, roadOffset: 2, levelSmoothing: 5, slopePenalty: 5, waterAvoid: 2 };

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}

function same(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function flatTerrain() {
    return { size: N, data: new Float32Array(N * N).fill(30) };
}

// 60-m-Hügel bei (200,150), σ 25 m — Umgehung immer günstiger als Überquerung (5·2·60 m Strafe)
function bumpTerrain() {
    const data = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = (i + 0.5) * mapSize / N, y = (j + 0.5) * mapSize / N;
        const d = Math.hypot(x - 200, y - 150);
        data[j * N + i] = 30 + 60 * Math.exp(-((d / 25) ** 2));
    }
    return { size: N, data };
}

const a = generateRoads(seed, mapSize, 4, flatTerrain(), opts);
const a2 = generateRoads(seed, mapSize, 4, flatTerrain(), opts);
check(same(a.points, a2.points), 'deterministisch: gleicher Seed → gleiche Straßen');
check(same(a.levels, a2.levels), 'deterministisch: gleicher Seed → gleiche Levels');
check(!same(a.points, generateRoads(seed + 1, mapSize, 4, flatTerrain(), opts).points), 'anderer Seed → andere Straßen');

for (const count of [4, 8]) {
    const { points, levels } = generateRoads(seed, mapSize, count, flatTerrain(), opts);
    check(points.length === MAX_ROADS * ROAD_POINTS * 2, `feste Größe ${MAX_ROADS * ROAD_POINTS * 2} Floats (count=${count})`);
    check(levels.length === MAX_ROADS * ROAD_POINTS, `Levels-Größe ${MAX_ROADS * ROAD_POINTS} (count=${count})`);
    for (let r = 0; r < count; r++) {
        const pts = points.subarray(r * ROAD_POINTS * 2, (r + 1) * ROAD_POINTS * 2);
        let inBounds = true;
        let len = 0;
        for (let i = 0; i < pts.length; i += 2) {
            const x = pts[i], y = pts[i + 1];
            if (x < 0 || x > mapSize || y < 0 || y > mapSize) inBounds = false;
            if (i >= 2) len += Math.hypot(x - pts[i - 2], y - pts[i - 1]);
        }
        check(inBounds, `Straß ${r}: alle ${ROAD_POINTS} Punkte in Map-Grenzen`);
        check(len > 200, `Straß ${r}: Länge ${len.toFixed(0)} m > 200 m`);
        const edgeDist = (x, y) => Math.min(x, y, mapSize - x, mapSize - y);
        check(edgeDist(pts[0], pts[1]) <= 2, `Straß ${r}: Startpunkt an Kante (Edge-to-Edge)`);
        check(edgeDist(pts[pts.length - 2], pts[pts.length - 1]) <= 2, `Straß ${r}: Endpunkt an Kante (Edge-to-Edge)`);
        for (let i = 0; i < ROAD_POINTS; i++)
            check(Math.abs(levels[r * ROAD_POINTS + i] - 32) < 0.01, `Straß ${r}: Level = 30 m + 2 m Offset`);
    }
}

// Umgehung: keine Straß über den Hügelgrat — Max-Höhe entlang Pfad < 60 m (Grund 30 m + halbe Amplitude)
{
    const bump = bumpTerrain();
    const { points } = generateRoads(seed, mapSize, 8, bump, opts);
    for (let r = 0; r < 8; r++) {
        let mx = 0;
        for (let i = r * ROAD_POINTS * 2; i < (r + 1) * ROAD_POINTS * 2; i += 2)
            mx = Math.max(mx, sampleTerrain(bump, mapSize, points[i], points[i + 1]));
        check(mx < 60, `Straß ${r}: Max-Höhe entlang Pfad ${mx.toFixed(1)} m < 60 m (Hügelgrat 90 m)`);
    }
}

// Rand-Ring (→ Plan/TerrainStrassennetz.md T2): mit rimAvoid weniger Straßenpunkte in der Randzone (nur queren)
{
    const rimZone = 45;
    const inRim = o => {
        const { points } = generateRoads(seed, mapSize, MAX_ROADS, flatTerrain(), o);
        let k = 0;
        for (let i = 0; i < points.length; i += 2)
            if (Math.min(points[i], points[i + 1], mapSize - points[i], mapSize - points[i + 1]) < rimZone) k++;
        return k;
    };
    const off = inRim({ ...opts, rimAmp: 40, rimZone, rimAvoid: 0 });
    const on = inRim({ ...opts, rimAmp: 40, rimZone, rimAvoid: 2 });
    check(on < off, `rimAvoid: ${on} statt ${off} Punkte in der Randzone`);
}

// Netz-Planung (→ Plan/TerrainStrassennetz.md N1): Orte trocken/flach/außerhalb Randzone, Mindestabstand,
// Ausfahrten am Rand, Graph zusammenhängend, deterministisch
{
    // flach 30 m + See (10 m) bei (130,130) r 55 + steiler Hügel bei (280,270)
    const data = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = (i + 0.5) * mapSize / N, y = (j + 0.5) * mapSize / N;
        data[j * N + i] = Math.hypot(x - 130, y - 130) < 55 ? 10 : 30 + 60 * Math.exp(-((Math.hypot(x - 280, y - 270) / 25) ** 2));
    }
    const terr = { size: N, data };
    const nopts = { waterLevel: 15, rimZone: 45, townCount: 6, townSpacing: 60, exitCount: 3, extraLinks: 2 };
    const net = planNetwork(seed, mapSize, terr, nopts);
    check(JSON.stringify(net) === JSON.stringify(planNetwork(seed, mapSize, terr, nopts)), 'Netz deterministisch');
    const towns = net.nodes.filter(n => !n.exit), exits = net.nodes.filter(n => n.exit);
    check(towns.length >= 3 && towns.length <= nopts.townCount, `Orte: ${towns.length} (3…${nopts.townCount})`);
    check(exits.length === nopts.exitCount, `Ausfahrten: ${exits.length} == ${nopts.exitCount}`);
    const edgeDist = n => Math.min(n.x, n.y, mapSize - n.x, mapSize - n.y);
    for (const t of towns) {
        const h = sampleTerrain(terr, mapSize, t.x, t.y);
        check(h >= nopts.waterLevel + 1, `Ort (${t.x.toFixed(0)},${t.y.toFixed(0)}) trocken (${h.toFixed(1)} m)`);
        check(h < 35, `Ort (${t.x.toFixed(0)},${t.y.toFixed(0)}) nicht am Hügel (${h.toFixed(1)} m)`);
        check(edgeDist(t) >= nopts.rimZone, `Ort (${t.x.toFixed(0)},${t.y.toFixed(0)}) außerhalb Randzone`);
    }
    for (let a = 0; a < towns.length; a++) for (let b = a + 1; b < towns.length; b++)
        check(Math.hypot(towns[a].x - towns[b].x, towns[a].y - towns[b].y) >= nopts.townSpacing, `Orte ${a}/${b} Mindestabstand`);
    for (const e of exits) check(edgeDist(e) < 1e-6, 'Ausfahrt liegt auf der Kante');
    const root = net.nodes.map((_, i) => i);
    const find = i => (root[i] === i ? i : (root[i] = find(root[i])));
    for (const [a, b] of net.edges) root[find(a)] = find(b);
    check(net.nodes.every((_, i) => find(i) === find(0)), 'Netz zusammenhängend');
    check(net.edges.length <= towns.length - 1 + nopts.extraLinks + nopts.exitCount, `Kanten ${net.edges.length} ≤ MST + Extra + Ausfahrten`);
}

// Laufzeit: kaputter Heap fällt nicht funktional auf, sondern als Sekunden pro Straße (Budget < 500 ms)
{
    const bump = bumpTerrain();
    let worst = 0;
    for (let s = 1000; s < 1020; s++) {
        const t = performance.now();
        generateRoads(s, mapSize, MAX_ROADS, bump, opts);
        worst = Math.max(worst, performance.now() - t);
    }
    check(worst < 200, `generateRoads ${MAX_ROADS} Straßen: max ${worst.toFixed(0)} ms < 200 ms`);
}

if (fail) {
    console.error(`${fail} Checks fehlgeschlagen`);
    process.exit(1);
}
console.log('roadgen-Sanity: OK — Edge-to-Edge, in Map-Grenzen, deterministisch, Hügel-Umgehung, Level = Terrain + Offset, Laufzeit');