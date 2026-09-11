// Node-Sanity für roadgen (→ Plan/Roads.md S2): Edge-to-Edge, in Map-Grenzen, deterministisch,
// Umgehung (lokaler Hügel), Levels = Terrain + Offset
import { generateRoads, sampleTerrain, MAX_ROADS, ROAD_POINTS } from '../src/roadgen.js';

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