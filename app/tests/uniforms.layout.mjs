// Uniform-Layout-Test: PARAM_FIELDS ↔ struct Params in heightmap.wgsl (→ Plan/Bugfix.md Schritt 2)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARAM_FIELDS, ROADS_OFFSET, encodeUniforms } from '../src/uniforms.js';
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

// Byte-Offset von roads = Params-Größe auf 16 B aufgerundet (Layout-Regel 2+3, → .clinerules/wgsl.md)
const roadsByte = Math.ceil(wgslFields.length * 4 / 16) * 16;
check(ROADS_OFFSET * 4 === roadsByte, `ROADS_OFFSET*4 == ${roadsByte} (ist ${ROADS_OFFSET * 4})`);

// Array-Größe in WGSL
const arrM = wgsl.match(/roads:\s*array<vec4<f32>,\s*(\d+)>/);
check(!!arrM, 'roads-Array in heightmap.wgsl');
if (arrM) check(Number(arrM[1]) === MAX_ROADS * ROAD_POINTS,
    `WGSL roads-Array ${arrM[1]} == MAX_ROADS*ROAD_POINTS ${MAX_ROADS * ROAD_POINTS}`);

// WGSL-Konstanten der Straßen-Loop == JS
for (const [name, val] of [['MAX_ROADS', MAX_ROADS], ['ROAD_POINTS', ROAD_POINTS]]) {
    const m = wgsl.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)u;`));
    check(!!m && Number(m[1]) === val, `WGSL const ${name} == ${val} (ist ${m ? m[1] : '–'})`);
}

// Länge des Encode-Puffers in main.js (Ausdruck auswerten, falls er Konstanten nutzt)
const bufM = mainJs.match(/uniformsData\s*=\s*new Float32Array\(([^)]+)\)/);
check(!!bufM, 'uniformsData-Allokation in main.js');
if (bufM) {
    const len = new Function('ROADS_OFFSET', 'MAX_ROADS', 'ROAD_POINTS', `return ${bufM[1]}`)(ROADS_OFFSET, MAX_ROADS, ROAD_POINTS);
    const expected = ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS;
    check(len === expected, `Encode-Puffer ${len} Floats == ${expected} Floats`);
}

// Punkt-Packing vec4(x, y, level, 0): WGSL liest Level aus .z (→ .clinerules/wgsl.md)
{
    const nP = MAX_ROADS * ROAD_POINTS;
    const out = new Float32Array(ROADS_OFFSET + 4 * nP);
    const pts = new Float32Array(2 * nP).map((_, i) => i + 1);
    const lv = new Float32Array(nP).map((_, i) => 1000 + i);
    encodeUniforms({}, pts, lv, out);
    let ok = true;
    for (let k = 0; k < nP; k++) {
        const o = ROADS_OFFSET + 4 * k;
        if (out[o] !== pts[2 * k] || out[o + 1] !== pts[2 * k + 1] || out[o + 2] !== lv[k] || out[o + 3] !== 0) ok = false;
    }
    check(ok, `encodeUniforms packt alle ${nP} Punkte als vec4(x, y, level, 0)`);
    check(/roadL\s*=\s*mix\(a\.z,\s*b\.z/.test(wgsl), 'WGSL liest Road-Level aus roads[].z');
}

if (fail) {
    console.error(`${fail} Checks fehlgeschlagen`);
    process.exit(1);
}
console.log(`uniforms-Layout: OK — ${Object.keys(PARAM_FIELDS).length} Felder 1:1 zu WGSL, roads ab Byte ${ROADS_OFFSET * 4}`);
