// Uniform-Layout-Test: PARAM_FIELDS ↔ struct Params in heightmap.wgsl (→ Plan/Bugfix.md Schritt 2)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARAM_FIELDS, ROADS_OFFSET } from '../src/uniforms.js';
import { MAX_ROADS, ROAD_POINTS } from '../src/roadgen.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wgsl = readFileSync(join(root, 'src', 'heightmap.wgsl'), 'utf8');
const mainJs = readFileSync(join(root, 'src', 'main.js'), 'utf8');

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}

// Feldnamen + Reihenfolge == Object.keys(PARAM_FIELDS)
const structM = wgsl.match(/struct Params \{([\s\S]*?)\}/);
check(!!structM, 'struct Params in heightmap.wgsl');
const wgslFields = structM
    ? structM[1].split('\n').map(l => l.trim().replace(/,+$/, '')).filter(Boolean).map(l => l.split(':')[0].trim())
    : [];
check(JSON.stringify(wgslFields) === JSON.stringify(Object.keys(PARAM_FIELDS)),
    `WGSL-Feldreihenfolge == PARAM_FIELDS (${wgslFields.length} vs ${Object.keys(PARAM_FIELDS).length} Felder)`);

// Byte-Offset von roads
check(ROADS_OFFSET * 4 === 96, `ROADS_OFFSET*4 == 96 (ist ${ROADS_OFFSET * 4})`);

// Array-Größe in WGSL
const arrM = wgsl.match(/roads:\s*array<vec4<f32>,\s*(\d+)>/);
check(!!arrM, 'roads-Array in heightmap.wgsl');
if (arrM) check(Number(arrM[1]) === MAX_ROADS * ROAD_POINTS,
    `WGSL roads-Array ${arrM[1]} == MAX_ROADS*ROAD_POINTS ${MAX_ROADS * ROAD_POINTS}`);

// Länge des Encode-Puffers in main.js (Ausdruck auswerten, falls er Konstanten nutzt)
const bufM = mainJs.match(/uniformsData\s*=\s*new Float32Array\(([^)]+)\)/);
check(!!bufM, 'uniformsData-Allokation in main.js');
if (bufM) {
    const len = new Function('ROADS_OFFSET', 'MAX_ROADS', 'ROAD_POINTS', `return ${bufM[1]}`)(ROADS_OFFSET, MAX_ROADS, ROAD_POINTS);
    const expected = ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS;
    check(len === expected, `Encode-Puffer ${len} Floats == ${expected} Floats`);
}

if (fail) {
    console.error(`${fail} Checks fehlgeschlagen`);
    process.exit(1);
}
console.log(`uniforms-Layout: OK — ${Object.keys(PARAM_FIELDS).length} Felder 1:1 zu WGSL, roads ab Byte ${ROADS_OFFSET * 4}`);
