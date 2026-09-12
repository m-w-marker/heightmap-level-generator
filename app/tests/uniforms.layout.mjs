// Uniform-Layout-Test: PARAM_FIELDS ↔ struct Params in heightmap.wgsl (→ Plan/Bugfix.md Schritt 2)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARAM_FIELDS, ROADS_OFFSET, TOWNS_OFFSET, UNIFORM_FLOATS, EROSION_RES, EROSION_FIELDS, EROSION_FLOATS, encodeUniforms, encodeErosion } from '../src/uniforms.js';
import { MAX_ROADS, ROAD_POINTS, MAX_TOWNS } from '../src/roadgen.js';

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

// Array-Größen + Reihenfolge in struct Uniforms: params, roads, towns (towns hinter roads, beide vec4 → kein Padding)
const uniM = wgsl.match(/struct Uniforms \{([\s\S]*?)\}/);
const members = uniM ? uniM[1].split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(':')[0].trim()) : [];
check(JSON.stringify(members) === JSON.stringify(['params', 'roads', 'towns']), `struct Uniforms = params, roads, towns (ist ${members.join(', ')})`);
for (const [name, n] of [['roads', MAX_ROADS * ROAD_POINTS], ['towns', MAX_TOWNS]]) {
    const m = wgsl.match(new RegExp(`${name}:\\s*array<vec4<f32>,\\s*(\\d+)>`));
    check(!!m && Number(m[1]) === n, `WGSL ${name}-Array ${m ? m[1] : '–'} == ${n}`);
}
check(TOWNS_OFFSET === ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS, `TOWNS_OFFSET ${TOWNS_OFFSET} == hinter roads`);
check(UNIFORM_FLOATS === TOWNS_OFFSET + 4 * MAX_TOWNS, `UNIFORM_FLOATS ${UNIFORM_FLOATS} == Ende von towns`);

// WGSL-Konstanten der Loops == JS
for (const [name, val] of [['MAX_ROADS', MAX_ROADS], ['ROAD_POINTS', ROAD_POINTS], ['MAX_TOWNS', MAX_TOWNS], ['EROSION_RES', EROSION_RES]]) {
    const m = wgsl.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)u;`));
    check(!!m && Number(m[1]) === val, `WGSL const ${name} == ${val} (ist ${m ? m[1] : '–'})`);
}

// Erosion: struct E ↔ EROSION_FIELDS, Gitter-Konstante, Uniform-Größe auf 16 B (→ Plan/Erosion.md)
{
    const ero = readFileSync(join(root, 'src', 'erosion.wgsl'), 'utf8');
    const m = ero.match(/struct E \{([\s\S]*?)\}/);
    const fields = m ? m[1].split('\n').map(l => l.replace(/\/\/.*/, '').trim().replace(/,+$/, '')).filter(Boolean).map(l => l.split(':')[0].trim()) : [];
    check(JSON.stringify(fields) === JSON.stringify(Object.keys(EROSION_FIELDS)), `erosion.wgsl struct E == EROSION_FIELDS (${fields.length} vs ${Object.keys(EROSION_FIELDS).length})`);
    check(EROSION_FLOATS * 4 === Math.ceil(fields.length * 4 / 16) * 16, `EROSION_FLOATS ${EROSION_FLOATS} = struct E auf 16 B`);
    const n = ero.match(/const N\s*=\s*(\d+)u;/);
    check(!!n && Number(n[1]) === EROSION_RES, `erosion.wgsl const N == EROSION_RES ${EROSION_RES}`);
    const out = new Float32Array(EROSION_FLOATS);
    encodeErosion({ mapSize: 400, erosionStrength: 50, erosionIterations: 10, screeAngle: 40 }, true, out);
    check(out.every(Number.isFinite), 'encodeErosion: alle Felder endlich');
}

// Encode-Puffer in main.js = UNIFORM_FLOATS (sonst verwirft das TypedArray die Orte still)
check(/uniformsData\s*=\s*new Float32Array\(UNIFORM_FLOATS\)/.test(mainJs), 'main.js: uniformsData = new Float32Array(UNIFORM_FLOATS)');

// Punkt-Packing vec4(x, y, level, 0): WGSL liest Level aus .z (→ .clinerules/wgsl.md)
{
    const nP = MAX_ROADS * ROAD_POINTS;
    const out = new Float32Array(UNIFORM_FLOATS);
    const pts = new Float32Array(2 * nP).map((_, i) => i + 1);
    const lv = new Float32Array(nP).map((_, i) => 1000 + i);
    // eine Stadt zu viel: encodeUniforms kappt auf MAX_TOWNS statt hinter das Ende zu schreiben
    const towns = Array.from({ length: MAX_TOWNS + 1 }, (_, k) => ({ x: 5000 + k, y: 6000 + k, level: 7000 + k }));
    encodeUniforms({}, pts, lv, towns, out);
    let ok = true;
    for (let k = 0; k < nP; k++) {
        const o = ROADS_OFFSET + 4 * k;
        if (out[o] !== pts[2 * k] || out[o + 1] !== pts[2 * k + 1] || out[o + 2] !== lv[k] || out[o + 3] !== 0) ok = false;
    }
    check(ok, `encodeUniforms packt alle ${nP} Punkte als vec4(x, y, level, 0)`);
    check(/roadL\s*=\s*mix\(a\.z,\s*b\.z/.test(wgsl), 'WGSL liest Road-Level aus roads[].z');
    let tOk = true;
    for (let k = 0; k < MAX_TOWNS; k++) {
        const o = TOWNS_OFFSET + 4 * k;
        if (out[o] !== 5000 + k || out[o + 1] !== 6000 + k || out[o + 2] !== 7000 + k || out[o + 3] !== 0) tOk = false;
    }
    check(tOk, `encodeUniforms packt ${MAX_TOWNS} Orte als vec4(x, y, level, 0) ab Float ${TOWNS_OFFSET}`);
    check(/h = c\.z \+ e \* tanh\(clamp\(\(h - c\.z\) \/ e/.test(wgsl) && /length\(w - c\.xy\)/.test(wgsl), 'WGSL liest Ort aus towns[].xy / .z');
}

if (fail) {
    console.error(`${fail} Checks fehlgeschlagen`);
    process.exit(1);
}
console.log(`uniforms-Layout: OK — ${Object.keys(PARAM_FIELDS).length} Felder 1:1 zu WGSL, roads ab Byte ${ROADS_OFFSET * 4}, towns ab Byte ${TOWNS_OFFSET * 4}, ${UNIFORM_FLOATS * 4} B`);
