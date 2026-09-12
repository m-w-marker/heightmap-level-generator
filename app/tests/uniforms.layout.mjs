// Uniform-Layout-Test: PARAM_FIELDS ↔ struct Params in heightmap.wgsl (→ Plan/Bugfix.md Schritt 2)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARAM_FIELDS, ROADS_OFFSET, TOWNS_OFFSET, RIVERS_OFFSET, UNIFORM_FLOATS, EROSION_FIELDS, EROSION_FLOATS, grids, RES_MIN, RES_MAX, encodeUniforms, encodeErosion } from '../src/uniforms.js';
import { MAX_ROADS, ROAD_POINTS, MAX_TOWNS } from '../src/roadgen.js';
import { MAX_RIVERS, RIVER_POINTS, RIVER_WET, RIVER_SINK } from '../src/hydro.js';
import { TOWN_FADE } from '../src/masks.js';

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

// Array-Größen + Reihenfolge in struct Uniforms: params, roads, towns, rivers (alle vec4 → kein Padding dazwischen)
const uniM = wgsl.match(/struct Uniforms \{([\s\S]*?)\}/);
const members = uniM ? uniM[1].split('\n').map(l => l.replace(/\/\/.*/, '').trim()).filter(Boolean).map(l => l.split(':')[0].trim()) : [];
check(JSON.stringify(members) === JSON.stringify(['params', 'roads', 'towns', 'rivers']), `struct Uniforms = params, roads, towns, rivers (ist ${members.join(', ')})`);
for (const [name, n] of [['roads', MAX_ROADS * ROAD_POINTS], ['towns', MAX_TOWNS], ['rivers', MAX_RIVERS * RIVER_POINTS]]) {
    const m = wgsl.match(new RegExp(`${name}:\\s*array<vec4<f32>,\\s*(\\d+)>`));
    check(!!m && Number(m[1]) === n, `WGSL ${name}-Array ${m ? m[1] : '–'} == ${n}`);
}
check(TOWNS_OFFSET === ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS, `TOWNS_OFFSET ${TOWNS_OFFSET} == hinter roads`);
check(RIVERS_OFFSET === TOWNS_OFFSET + 4 * MAX_TOWNS, `RIVERS_OFFSET ${RIVERS_OFFSET} == hinter towns`);
check(UNIFORM_FLOATS === RIVERS_OFFSET + 4 * MAX_RIVERS * RIVER_POINTS, `UNIFORM_FLOATS ${UNIFORM_FLOATS} == Ende von rivers`);
check(UNIFORM_FLOATS * 4 <= 65536, `Uniform ${UNIFORM_FLOATS * 4} B ≤ 64 KiB (maxUniformBufferBindingSize)`);

// WGSL-Konstanten der Loops == JS
for (const [name, val] of [['MAX_ROADS', MAX_ROADS], ['ROAD_POINTS', ROAD_POINTS], ['MAX_TOWNS', MAX_TOWNS],
    ['MAX_RIVERS', MAX_RIVERS], ['RIVER_POINTS', RIVER_POINTS]]) {
    const m = wgsl.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)u;`));
    check(!!m && Number(m[1]) === val, `WGSL const ${name} == ${val} (ist ${m ? m[1] : '–'})`);
}
for (const [name, val] of [['RIVER_WET', RIVER_WET], ['RIVER_SINK', RIVER_SINK], ['TOWN_FADE', TOWN_FADE]]) {
    const m = wgsl.match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+);`));
    check(!!m && Number(m[1]) === val, `WGSL const ${name} == ${val} (ist ${m ? m[1] : '–'})`);
}
check(/lakeN = u32\(u\.params\.lakeRes\)/.test(wgsl) && /lakes\[u32\(c\.y\) \* lakeN/.test(wgsl) && /n = i32\(u\.params\.erosionRes\)/.test(wgsl)
    && /rL = mix\(a\.z, b\.z/.test(wgsl) && /rW = mix\(a\.w, b\.w/.test(wgsl), 'WGSL: See-Feld mit lakeRes, erosionDelta mit erosionRes, Fluss-Spiegel .z, halbe Breite .w');

// Raster je Map-Größe (→ Plan/Aufloesung.md, Plan/Pixel05.md): 512 m = 1024²; jede Reglerstufe (64 m) glatt 0,5 m/px, Raster durch 16
{
    const g = grids(512);
    check(g.res === 1024 && g.tn === 512 && g.ero === 512 && g.pre === 128, `grids(512) = 1024/512/512/128 (ist ${Object.values(g).join('/')})`);
    for (let m = 256; m <= 1280; m += 64) {
        const q = grids(m);
        const ok = Object.values(q).every(v => v % 16 === 0) && m / q.res === 0.5;
        check(ok, `grids(${m}): ${Object.values(q).join('/')} durch 16, ${(m / q.res).toFixed(4)} m/px`);
    }
    check(grids(256).res === RES_MIN && grids(1280).res === RES_MAX, 'Regler-Enden 256 / 1280 m = RES_MIN / RES_MAX');
    check(grids(50).res === RES_MIN && grids(5000).res === RES_MAX, 'grids außerhalb 256–1280 m geklemmt');
    const p = PARAM_FIELDS.erosionRes({ mapSize: 700 }), l = PARAM_FIELDS.lakeRes({ mapSize: 700 });
    check(p === grids(700).ero && l === grids(700).pre, 'Uniform erosionRes / lakeRes = grids');
}

// Erosion: struct E ↔ EROSION_FIELDS, Gitter-Konstante, Uniform-Größe auf 16 B (→ Plan/Erosion.md)
{
    const ero = readFileSync(join(root, 'src', 'erosion.wgsl'), 'utf8');
    const m = ero.match(/struct E \{([\s\S]*?)\}/);
    const fields = m ? m[1].split('\n').map(l => l.replace(/\/\/.*/, '').trim().replace(/,+$/, '')).filter(Boolean).map(l => l.split(':')[0].trim()) : [];
    check(JSON.stringify(fields) === JSON.stringify(Object.keys(EROSION_FIELDS)), `erosion.wgsl struct E == EROSION_FIELDS (${fields.length} vs ${Object.keys(EROSION_FIELDS).length})`);
    check(EROSION_FLOATS * 4 === Math.ceil(fields.length * 4 / 16) * 16, `EROSION_FLOATS ${EROSION_FLOATS} = struct E auf 16 B`);
    check(!/const N\s*=/.test(ero) && /u32\(e\.n\)/.test(ero), 'erosion.wgsl: Raster aus e.n statt Konstante');
    const out = new Float32Array(EROSION_FLOATS);
    encodeErosion({ mapSize: 400, erosionStrength: 50, erosionIterations: 10, screeAngle: 40 }, true, out);
    check(out.every(Number.isFinite), 'encodeErosion: alle Felder endlich');
}

// Bindings heightmap.wgsl ↔ Bind-Group in main.js: Reihenfolge der Puffer = @binding 0…n, lückenlos; ≤ 8 Storage-Puffer
{
    const binds = [...wgsl.matchAll(/@binding\((\d+)\) var<(\w+)[^>]*> (\w+)/g)].map(m => ({ k: +m[1], space: m[2], name: m[3] }));
    check(binds.every((b, i) => b.k === i), `WGSL-Bindings lückenlos 0…${binds.length - 1}`);
    check(binds.filter(b => b.space === 'storage').length <= 8, 'heightmap.wgsl: ≤ 8 Storage-Puffer');
    const m = mainJs.match(/layout: pipeline\.getBindGroupLayout\(0\),\s*entries: \[([^\]]*)\]/);
    const js = m ? m[1].split(',').map(s => s.trim()) : [];
    const want = ['uniformsBuf', 'heightBuf', 'roadMaskBuf', 'erosion.delta', 'waterBuf', 'lakesBuf', 'townMaskBuf'];
    check(JSON.stringify(js) === JSON.stringify(want), `main.js Bind-Group = ${want.join(', ')} (ist ${js.join(', ')})`);
    check(JSON.stringify(binds.map(b => b.name)) === JSON.stringify(['u', 'heights', 'roadMask', 'erosionDelta', 'water', 'lakes', 'townMask']),
        `WGSL-Bindings = u, heights, roadMask, erosionDelta, water, lakes, townMask (ist ${binds.map(b => b.name).join(', ')})`);
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
    const rivers = new Float32Array(4 * MAX_RIVERS * RIVER_POINTS).map((_, i) => 9000 + i);
    encodeUniforms({}, pts, lv, towns, rivers, out);
    check(out.subarray(RIVERS_OFFSET).every((v, i) => v === 9000 + i), `encodeUniforms packt rivers 1:1 ab Float ${RIVERS_OFFSET}`);
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
