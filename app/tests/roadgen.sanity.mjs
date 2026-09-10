// Node-Sanity für roadgen (→ Plan/Build.md M3): 32 Punkte/Straße, in Map-Grenzen, deterministisch
import { generateRoads, MAX_ROADS, ROAD_POINTS } from '../src/roadgen.js';

const seed = 1337;
const mapSize = 400;
let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}

function same(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

const a = generateRoads(seed, mapSize, 4);
check(same(a, generateRoads(seed, mapSize, 4)), 'deterministisch: gleicher Seed → gleiche Straßen');
check(!same(a, generateRoads(seed + 1, mapSize, 4)), 'anderer Seed → andere Straßen');

for (const count of [4, 8]) {
    const roads = generateRoads(seed, mapSize, count);
    check(roads.length === MAX_ROADS * ROAD_POINTS * 2, `feste Größe ${MAX_ROADS * ROAD_POINTS * 2} Floats (count=${count})`);
    for (let r = 0; r < count; r++) {
        const pts = roads.subarray(r * ROAD_POINTS * 2, (r + 1) * ROAD_POINTS * 2);
        let inBounds = true;
        let len = 0;
        for (let i = 0; i < pts.length; i += 2) {
            const x = pts[i], y = pts[i + 1];
            if (x < 0 || x > mapSize || y < 0 || y > mapSize) inBounds = false;
            if (i >= 2) len += Math.hypot(x - pts[i - 2], y - pts[i - 1]);
        }
        check(inBounds, `Straß ${r}: alle ${ROAD_POINTS} Punkte in Map-Grenzen`);
        check(len > 200, `Straß ${r}: Länge ${len.toFixed(0)} m > 200 m`);
    }
}

if (fail) {
    console.error(`${fail} Checks fehlgeschlagen`);
    process.exit(1);
}
console.log('roadgen-Sanity: OK — 4 und 8 Straßen × 32 Punkte, in Map-Grenzen, deterministisch');