import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildPanel, seedGrid } from './ui.js';
import { encodePng } from './png.js';
import { quantize16, encodeR16, sampleBilinear, resample } from './export.js';
import { gradient, slopeDeg, normals, curvature, slopeBytes, normalBytes, curvatureBytes, curvatureScale, CURV_R } from './masks.js';
import WGSL from './heightmap.wgsl?raw';
import { generateRoads, MAX_ROADS, ROAD_POINTS } from './roadgen.js';
import { encodeUniforms, UNIFORM_FLOATS, EROSION_RES, autoMaxH } from './uniforms.js';
import { createErosion } from './erosion.js';
import { createWalk } from './walk.js';

// M1: Renderer + Szene (→ Plan/Build.md M1)
const renderer = new WebGPURenderer({ antialias: true });
try {
    await renderer.init();
} catch (e) {
    document.body.innerHTML = `<pre style="color:#f88;padding:20px">WebGPU not available:\n${e.message}</pre>`;
    throw e;
}

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 600, 1600);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 4000);
camera.position.set(240, 280, 240);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.minDistance = 40;
controls.maxDistance = 1200;
// headless-Prüfung: Kamera setzen, Readback lesen
if (import.meta.env.DEV) window.dbg = { camera, controls, get heights() { return heights; }, get roadMask() { return roadMask; }, get maxH() { return params.maxH; },
    get params() { return params; }, get terrain128() { return terrain128; } };

// Sonne ≈ 30° hoch + schwächeres Himmelslicht → Relief auch bei flachen Hügeln lesbar
scene.add(new THREE.HemisphereLight(0xbdd7ff, 0x3a4a33, 0.7));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.8);
sun.position.set(220, 150, 120);
scene.add(sun);

// --- M2: Compute-Pipeline + 2D-Preview (→ Plan/Build.md M2) ---
const RES = 1024;
const MAP = 400;

const params = {
    // Start = flaches Hügelland mit etwas Wasser (Seed 1337: ~5 %); Presets setzen ihre Terrain-Werte selbst
    seed: 1337,
    baseLevel: 17.5, // 2,5 m über waterLevel → Senken werden Seen
    hillAmp: 6,
    hillWave: 110,
    hillRoughness: 0.4, // Oktaven-Gain: 0.25 glatt rollend … 0.65 zerklüftet
    mountainAmp: 18,
    mountainWave: 180,
    clusterWave: 220,
    mountainCoverage: 12,
    cliffDrop: 4,
    cliffWave: 90,
    cliffWidth: 15,
    cliffAreaWave: 160,
    cliffCoverage: 8,
    rimAmp: 40,
    rimZone: 45,
    rimWave: 90,
    maxH: 0, // automatisch (autoMaxH) in generate()
    waterLevel: 15,
    roadWidth: 4,
    roadSlope: 35, // Böschungswinkel in °
    roadSlopeVar: 20, // ± ° entlang der Straße
    roadOffset: -0.3, // leicht eingesunken wie ein Feldweg (→ Plan/StrassenLandschaft.md)
    roadTolerance: 0.7,
    roadColor: '#9a8462',
    levelSmoothing: 6, // m Radius des Level-Felds
    slopePenalty: 4,
    roadMaxGrade: 12, // % max. Fahrbahn-Steigung (→ Plan/StrassenSteigung.md)
    waterAvoid: 2,
    townCount: 5,
    townSpacing: 80,
    clearingRadius: 8, // m flach um jeden Ort (→ Plan/Roadmap.md R12); größer wirkt am Hang wie ein Platz im Berg
    exitCount: 3,
    extraLinks: 2,
    reuse: 0.4,
    erosionStrength: 0, // % (0 = aus → Maps wie vor der Erosion, → Plan/Erosion.md)
    erosionIterations: 300,
    screeAngle: 90, // ° Schuttwinkel der thermischen Erosion; 90 = aus, darunter werden Abrisskanten zu Schutthängen
};
const DEFAULTS = { ...params }; // Basis jedes Presets

const uniformsData = new Float32Array(UNIFORM_FLOATS);

const device = renderer.backend.device;
if (!device) throw new Error('No WebGPU device (WebGL fallback active?)');
const queue = device.queue;
device.addEventListener('uncapturederror', e => console.error('WebGPU:', e.error.message));

const heightBuf = device.createBuffer({
    size: RES * RES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
});
const uniformsBuf = device.createBuffer({ size: uniformsData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const roadMaskBuf = device.createBuffer({ size: RES * RES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
const erosion = createErosion(device);

const shaderModule = device.createShaderModule({ code: WGSL });
const info = await shaderModule.getCompilationInfo();
for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`WGSL ${m.lineNum}:${m.linePos} ${m.message}`);
const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
});

const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: uniformsBuf } },
        { binding: 1, resource: { buffer: heightBuf } },
        { binding: 2, resource: { buffer: roadMaskBuf } },
        { binding: 3, resource: { buffer: erosion.delta } },
    ],
});
// Roh-Terrain für die Erosion (Entry raw, eigenes auto-Layout: nur Uniform + heights)
const rawPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: shaderModule, entryPoint: 'raw' } });
const rawBind = device.createBindGroup({
    layout: rawPipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: uniformsBuf } },
        { binding: 1, resource: { buffer: heightBuf } },
    ],
});

let heights = new Float32Array(RES * RES);
let roadMask = new Float32Array(RES * RES);

const PRE = 128; // Prepass-Auflösung für das CPU-Routing (→ Plan/Roads.md)

// Readback: Staging MAP_READ + copyBufferToBuffer + mapAsync (→ .clinerules/wgsl.md)
async function readBuffer(buf, bytes) {
    const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buf, 0, staging, 0, bytes);
    queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
}

let terrain128 = new Float32Array(PRE * PRE); // in Metern (→ Plan/Roads.md)

// Nacheinander statt überlappend: erosion.delta muss über das await des Prepass bis zum Final-Pass stehen bleiben,
// eine parallele Seed-Vorschau würde es überschreiben
let gpuChain = Promise.resolve();
function computeMap(p, res) {
    const run = gpuChain.then(() => computeMapNow(p, res));
    gpuChain = run.catch(() => {});
    return run;
}

const NO_ROADS = new Float32Array(MAX_ROADS * ROAD_POINTS * 2), NO_LEVELS = new Float32Array(MAX_ROADS * ROAD_POINTS);

// Roh-Terrain EROSION_RES² nach heightBuf → Erosion → erosion.delta / erosion.flow (→ Plan/Erosion.md)
function runErosion(p, erode) {
    encodeUniforms({ ...p, mapSize: MAP, res: EROSION_RES, roadCount: 0, clearingCount: 0 }, NO_ROADS, NO_LEVELS, [], uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);
    dispatch(EROSION_RES, rawPipeline, rawBind);
    erosion.run(heightBuf, { ...p, mapSize: MAP }, erode);
}

// (Erosion →) Prepass → Straßennetz → Final-Pass in res² für p (maxH gesetzt); auch für die Seed-Vorschau (→ Plan/Roadmap.md R13).
// Je Pass laufen writeBuffer, Dispatch und Kopie ohne await dazwischen (→ .clinerules/wgsl.md)
async function computeMapNow(p, res) {
    const t0 = performance.now();
    const erosionOn = p.erosionStrength > 0; // aus → heutiger Pfad bitgleich
    if (erosionOn) runErosion(p, true);
    // Prepass: 128² Roh-Terrain (+ Erosion, ohne Straßen, mit Rand-Ring; die Randzone sperrt das Routing selbst)
    // → Routing-Daten für roadgen (→ Plan/PresetsAusfahrten.md)
    encodeUniforms({ ...p, mapSize: MAP, res: PRE, roadCount: 0, clearingCount: 0, erosionOn }, NO_ROADS, NO_LEVELS, [], uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);
    dispatch(PRE);
    const terrain = (await readBuffer(heightBuf, PRE * PRE * 4)).map(h => h * p.maxH);
    const tr = performance.now(); // Dispatch + Readback: Zeitstempel erst nach mapAsync, sonst nur Submit gemessen

    const net = generateRoads(p.seed, MAP, { size: PRE, data: terrain }, p);
    const tg = performance.now();
    encodeUniforms({ ...p, mapSize: MAP, res, roadCount: net.count, clearingCount: net.towns.length, erosionOn }, net.points, net.levels, net.towns, uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);
    dispatch(res);
    // Kopien laufen in Submit-Reihenfolge nach dem Dispatch
    const [h, m] = await Promise.all([readBuffer(heightBuf, res * res * 4), readBuffer(roadMaskBuf, res * res * 4)]);
    return { terrain, net, heights: h, roadMask: m, gpuMs: tr - t0 + performance.now() - tg, roadMs: tg - tr };
}

async function generate() {
    const t0 = performance.now();
    params.maxH = autoMaxH(params);
    const map = await computeMap(params, RES);
    ({ terrain: terrain128, heights, roadMask } = map);
    const { points: roads, levels, count, nodes, towns } = map.net;

    // Prepass-Konsole-Check (→ Plan/Roads.md S1): Min/Max ≈ Final-Pass
    let pMn = Infinity, pMx = -Infinity;
    for (const h of terrain128) {
        if (h < pMn) pMn = h;
        if (h > pMx) pMx = h;
    }
    console.log(`Prepass 128²: min ${pMn.toFixed(1)} m · max ${pMx.toFixed(1)} m`);
    console.log(`Road network: ${towns.length} towns · ${nodes.filter(n => n.exit).length} exits · ${count} roads · ${map.roadMs.toFixed(0)} ms`);

    logStats(roads, levels, count);
    ({ slope, relief } = slopeRelief(heights, RES, params.maxH));
    refreshView();
    if (terrain) {
        scene.remove(terrain);
        terrain.geometry.dispose();
    }
    terrain = buildTerrainMesh();
    scene.add(terrain);
    const totalMs = performance.now() - t0;
    console.log(`Regeneration: ${totalMs.toFixed(0)} ms`);
    panel.status(`GPU ${map.gpuMs.toFixed(0)} ms · Roads ${map.roadMs.toFixed(0)} ms · Total ${totalMs.toFixed(0)} ms`);
}

function dispatch(res, pl = pipeline, bg = bind) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pl);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(res / 16, res / 16); // Workgroup 16×16 (→ .clinerules/projekt.md)
    pass.end();
    queue.submit([encoder.finish()]);
}

function logStats(roads, levels, count) {
    // Konsole-Check (→ Plan/Build.md M2 + M3)
    let mn = Infinity, mx = -Infinity, sum = 0, water = 0;
    let roadPx = 0, rMn = Infinity, rMx = -Infinity;
    for (let i = 0; i < heights.length; i++) {
        const h = heights[i] * params.maxH;
        if (h < mn) mn = h;
        if (h > mx) mx = h;
        sum += h;
        if (h < params.waterLevel) water++;
        const m = roadMask[i];
        if (m > 0.5) roadPx++;
        if (m >= 0.999) {
            if (h < rMn) rMn = h;
            if (h > rMx) rMx = h;
        }
    }
    console.log(
        `Heightmap 1024²: min ${mn.toFixed(1)} m · max ${mx.toFixed(1)} m · avg ${(sum / heights.length).toFixed(1)} m · water ${(100 * water / heights.length).toFixed(1)} %`
    );
    console.log(
        `Roads: ${(100 * roadPx / heights.length).toFixed(1)} % · road level ${rMn.toFixed(1)}–${rMx.toFixed(1)} m`
    );

    // Readback-Level vs. CPU-Level an den Polyline-Punkten (→ Plan/Roads.md S3); Fahrbahn darf im
    // Toleranzband liegen (→ Plan/StrassenLandschaft.md); Ausreißer nur an Kreuzungen erwartet
    const nPts = count * ROAD_POINTS, band = params.roadTolerance + 0.5;
    let dMax = 0, nOut = 0;
    for (let k = 0; k < nPts; k++) {
        const px = Math.min(Math.floor(roads[2 * k] / MAP * RES), RES - 1);
        const py = Math.min(Math.floor(roads[2 * k + 1] / MAP * RES), RES - 1);
        const d = Math.abs(heights[py * RES + px] * params.maxH - levels[k]);
        if (d > dMax) dMax = d;
        if (d > band) nOut++;
    }
    if (nPts > 0)
        console.log(`Road level GPU vs. CPU: max Δ ${dMax.toFixed(2)} m · ${nOut}/${nPts} points outside ±${band.toFixed(1)} m`);
}

// Preview + 3D-Farbtextur aus dem aktuellen Readback (auch bei reinem Farbwechsel, ohne Regeneration)
function refreshView() {
    updatePreview();
    terrainTex.needsUpdate = true;
}

// --- 2D-Preview (Farbcodierung nach Höhe) ---
const preview = document.getElementById('preview');
const pctx = preview.getContext('2d');
const pimg = pctx.createImageData(RES, RES);

// Farbrampe (Wasser/Sand/Gras/Fels/Schnee/Straße) — geteilt von 2D-Preview und 3D-Mesh, damit beide bei gleichem Seed identisch bleiben.
// In Metern über waterLevel, nicht relativ zu maxH (das ist automatisch → Farben würden je Preset wandern)
const STOPS = [
    [0, [194, 178, 128]],     // Sand (Ufer)
    [1.5, [108, 146, 72]],    // Gras
    [45, [72, 112, 54]],      // dunkles Grün
    [85, [112, 104, 92]],     // Fels
    [115, [150, 146, 138]],   // Schutt
    [140, [240, 244, 248]],   // Schnee
];
const ROCK = [110, 102, 92];
const ROCK_SLOPE = [0.7, 1.2]; // Hangneigung (m/m ≈ 35°–50°) → Überblendung zu Fels
const RELIEF_TINT = 0.06;      // Helligkeit pro m Kuppe/Mulde (±15 % max)

// '#rrggbb' → [r, g, b] 0–255, gecacht: terrainColor läuft 1M× pro Bild
let roadRGB = [0, 0, 0];
function setRoadColor() {
    const v = parseInt(params.roadColor.slice(1), 16);
    roadRGB = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
setRoadColor();

// Fels-Anteil nach Hangneigung — geteilt von Farbrampe und Splatmap
const rockWeight = s => Math.min(Math.max((s - ROCK_SLOPE[0]) / (ROCK_SLOPE[1] - ROCK_SLOPE[0]), 0), 1);
// Fahrbahn-Anteil aus roadMask (weiche Kante) — geteilt von Farbrampe und Splatmap
const roadWeight = m => Math.min(Math.max((m - 0.5) * 2, 0), 1);

// schreibt 0–255-Werte (→ Plan/Build.md Datenfluss)
function terrainColor(out, o, hm, m, s, rel) {
    let r, g, b;
    if (hm < params.waterLevel) {
        const t = hm / params.waterLevel;
        r = 42 + 20 * t;
        g = 90 + 28 * t;
        b = 158 + 22 * t;
    } else {
        const n = hm - params.waterLevel;
        let a = STOPS[STOPS.length - 2], c = STOPS[STOPS.length - 1];
        for (let i = 0; i < STOPS.length - 1; i++) {
            if (n <= STOPS[i + 1][0]) { a = STOPS[i]; c = STOPS[i + 1]; break; }
        }
        const f = Math.min((n - a[0]) / (c[0] - a[0]), 1);
        r = a[1][0] + (c[1][0] - a[1][0]) * f;
        g = a[1][1] + (c[1][1] - a[1][1]) * f;
        b = a[1][2] + (c[1][2] - a[1][2]) * f;
        const k = rockWeight(s);
        r += (ROCK[0] - r) * k;
        g += (ROCK[1] - g) * k;
        b += (ROCK[2] - b) * k;
        const lit = 1 + Math.min(Math.max(rel * RELIEF_TINT, -0.15), 0.15);
        r *= lit;
        g *= lit;
        b *= lit;
    }
    if (m > 0.5) {
        const f = roadWeight(m);
        r = r * (1 - f) + roadRGB[0] * f;
        g = g * (1 - f) + roadRGB[1] * f;
        b = b * (1 - f) + roadRGB[2] * f;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
}

// Aus dem Readback h (n², 0–1), einmal pro Regeneration (Kanten geclamped):
// slope = Hangneigung |∇h| in m/m (zentrale Differenzen); relief = Höhe − Mittel im Abstand RELIEF_M in m
// (> 0 Kuppe, < 0 Mulde) → Farbe heller/dunkler, macht flache Hügel lesbar
// vereinfacht: eigene Neigung statt masks.js – Zusammenführen mit R11 (→ Plan/Roadmap.md)
const RELIEF_M = 24 * MAP / RES; // ≈ 9 m (24 px bei 1024²)
let slope = new Float32Array(RES * RES);
let relief = new Float32Array(RES * RES);
function slopeRelief(h, n, maxH) {
    const px = MAP / n, k = maxH / (2 * px), r = Math.max(Math.round(RELIEF_M / px), 1);
    const s = new Float32Array(n * n), rel = new Float32Array(n * n);
    const at = (x, y) => h[Math.min(Math.max(y, 0), n - 1) * n + Math.min(Math.max(x, 0), n - 1)];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const gx = (at(x + 1, y) - at(x - 1, y)) * k;
        const gy = (at(x, y + 1) - at(x, y - 1)) * k;
        s[y * n + x] = Math.hypot(gx, gy);
        const avg = (at(x - r, y) + at(x + r, y) + at(x, y - r) + at(x, y + r)) / 4;
        rel[y * n + x] = (at(x, y) - avg) * maxH;
    }
    return { slope: s, relief: rel };
}

// Farbrampe → RGBA-Pixel (Alpha 255) für n² Werte
function colorize(d, n, h, m, s, rel, maxH) {
    for (let i = 0; i < n * n; i++) {
        terrainColor(d, i * 4, h[i] * maxH, m[i], s[i], rel[i]);
        d[i * 4 + 3] = 255;
    }
}

function updatePreview() {
    colorize(pimg.data, RES, heights, roadMask, slope, relief, params.maxH);
    pctx.putImageData(pimg, 0, 0);
}

// --- M4: 3D-Terrain (→ Plan/Build.md M4) ---
const TN = 512; // Vertex je Kante; 1 Unit = 1 m
// Farben = die 1024²-Preview als Textur (→ Plan/Roadmap.md R9): Vertex-Farben auf 512² zeichnen Straßenränder als Sägezahn.
// Textur-Texel k liegt bei (k + 0.5) / RES wie in sampleBilinear → uv = (u, v) ohne Versatz
const terrainTex = new THREE.DataTexture(new Uint8Array(pimg.data.buffer), RES, RES);
terrainTex.colorSpace = THREE.SRGBColorSpace;
terrainTex.magFilter = THREE.LinearFilter;
terrainTex.minFilter = THREE.LinearMipmapLinearFilter;
terrainTex.generateMipmaps = true;
terrainTex.anisotropy = renderer.getMaxAnisotropy();
const terrainMat = new THREE.MeshStandardMaterial({ map: terrainTex, roughness: 1, metalness: 0 });
let terrain = null;

function buildTerrainMesh() {
    const pos = new Float32Array(TN * TN * 3);
    const uv = new Float32Array(TN * TN * 2);
    const idx = new Uint32Array((TN - 1) * (TN - 1) * 6);
    for (let j = 0; j < TN; j++) {
        for (let i = 0; i < TN; i++) {
            const o = (j * TN + i) * 3;
            const u = i / (TN - 1), v = j / (TN - 1);
            pos[o] = -MAP / 2 + u * MAP;
            pos[o + 1] = sampleBilinear(heights, RES, u, v) * params.maxH;
            pos[o + 2] = -MAP / 2 + v * MAP;
            uv[(j * TN + i) * 2] = u;
            uv[(j * TN + i) * 2 + 1] = v;
        }
    }
    let ii = 0;
    for (let j = 0; j < TN - 1; j++) {
        for (let i = 0; i < TN - 1; i++) {
            const a = j * TN + i, b = a + 1, c = a + TN, d = c + 1;
            // (a,c,b)+(c,d,b): CCW von oben → Normals zeigen nach +Y
            idx[ii++] = a; idx[ii++] = c; idx[ii++] = b;
            idx[ii++] = c; idx[ii++] = d; idx[ii++] = b;
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, terrainMat);
}

// Höhe des angezeigten Meshes (Dreiecke wie oben) in m; der 1024²-Readback weicht an Böschungen ±12 cm davon ab
function meshHeight(x, z) {
    const p = terrain.geometry.attributes.position.array;
    const fi = Math.min(Math.max((x / MAP + 0.5) * (TN - 1), 0), TN - 1), fj = Math.min(Math.max((z / MAP + 0.5) * (TN - 1), 0), TN - 1);
    const i = Math.min(Math.floor(fi), TN - 2), j = Math.min(Math.floor(fj), TN - 2), s = fi - i, t = fj - j;
    const y = (i, j) => p[(j * TN + i) * 3 + 1];
    const a = y(i, j), b = y(i + 1, j), c = y(i, j + 1), d = y(i + 1, j + 1);
    return s + t <= 1 ? a + (b - a) * s + (c - a) * t : d + (c - d) * (1 - s) + (b - d) * (1 - t);
}

// --- M5: GUI + Export (→ Plan/Build.md M5) ---
// Debounce + Coalescing: Slider-Drags triggern nur eine Regeneration, keine Überlappung
let genTimer = 0;
let genBusy = false;
let genDirty = false;
function scheduleGenerate() {
    clearTimeout(genTimer);
    genTimer = setTimeout(runGenerate, 150);
}
async function runGenerate() {
    if (genBusy) { genDirty = true; return; }
    genBusy = true;
    panel.busy(true);
    record();
    try {
        await generate();
    } catch (e) {
        console.error('generate:', e);
    } finally {
        genBusy = false;
        panel.busy(false);
        if (genDirty) { genDirty = false; runGenerate(); }
    }
}

// Presets = Startwerte (inkl. Seed) + Overrides (→ Plan/PresetsAusfahrten.md, Plan/UI.md)
const PRESETS = {
    'Rolling hills': { baseLevel: 30, hillAmp: 9, hillWave: 90, hillRoughness: 0.35, mountainAmp: 25, mountainWave: 200, clusterWave: 250,
        mountainCoverage: 25, cliffDrop: 5, cliffWidth: 20, cliffCoverage: 10, rimAmp: 35, rimZone: 60,
        townCount: 6, townSpacing: 70, extraLinks: 3, roadSlopeVar: 15 },
    'Pasture': { baseLevel: 25, hillAmp: 4, hillWave: 100, hillRoughness: 0.3, mountainAmp: 0, mountainCoverage: 0,
        cliffDrop: 0, cliffCoverage: 0, rimAmp: 25, rimZone: 70, rimWave: 120, townCount: 4, townSpacing: 90, extraLinks: 1 },
    'Mountains': { baseLevel: 25, hillAmp: 12, hillWave: 120, hillRoughness: 0.6, mountainAmp: 100, mountainWave: 200, clusterWave: 260,
        mountainCoverage: 45, cliffDrop: 15, cliffCoverage: 15, rimAmp: 70, rimZone: 60,
        townCount: 4, townSpacing: 60, slopePenalty: 7, extraLinks: 1 },
    'Canyon / Plateaus': { baseLevel: 45, hillAmp: 3, hillWave: 120, hillRoughness: 0.35, mountainAmp: 0, mountainCoverage: 0,
        cliffDrop: 45, cliffWave: 120, cliffWidth: 8, cliffAreaWave: 220, cliffCoverage: 70, rimAmp: 30,
        townCount: 5, slopePenalty: 5, roadSlopeVar: 10, roadMaxGrade: 25 }, // 12 % → Rampen ~375 m je Klippe
    'Lakes': { baseLevel: 18.5, hillAmp: 6, hillWave: 110, hillRoughness: 0.35, mountainAmp: 15, mountainCoverage: 10,
        cliffDrop: 4, cliffCoverage: 5, waterLevel: 16, rimAmp: 30, townCount: 5, waterAvoid: 4 },
};
function applyPreset(overrides) {
    Object.assign(params, DEFAULTS, overrides);
    setRoadColor();
    panel.refresh();
    scheduleGenerate();
}
// Save/Load als JSON: alle params außer maxH (automatisch) (→ Plan/SaveLoad.md)
const SAVE_KEYS = Object.keys(params).filter(k => k !== 'maxH');
// 2: Integer-Noise-Hash → gleicher Seed ergibt ein anderes Terrain als in Version 1 (Dateien ohne Feld)
const SAVE_VERSION = 2;
// Fremde JSON (von Hand / aus der GUI kopiert): Schlüssel ohne Groß-/Kleinschreibung ("Seed"), Zahlen oft als
// String → Typ vom Default erzwingen, sonst "45" + 10 = "4510" im Routing; Farbe mit '#'
function pickParams(obj) {
    const src = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
    return Object.fromEntries(SAVE_KEYS.filter(k => k.toLowerCase() in src)
        .map(k => [k, src[k.toLowerCase()]])
        .map(([k, v]) => [k, typeof params[k] === 'number' ? Number(v) : String(v).replace(/^#?/, '#')])
        .filter(([, v]) => !Number.isNaN(v)));
}
// jede JSON in app/presets/ = eigener Eintrag (Save-Format, → Plan/SaveLoad.md)
const ALL_PRESETS = { Defaults: {}, ...PRESETS };
const FILE_PRESETS = import.meta.glob('../presets/*.json', { eager: true, import: 'default' });
for (const [path, p] of Object.entries(FILE_PRESETS))
    ALL_PRESETS[path.slice(path.lastIndexOf('/') + 1, -'.json'.length)] = pickParams(p);

// Undo/Redo: Snapshots von pickParams, ein Eintrag je Regeneration (Slider-Drag = einer), Farbe entprellt
const HISTORY_MAX = 100;
const undoStack = [];
let undoPos = -1;
let colorTimer = 0;
function record() {
    const s = JSON.stringify(pickParams(params));
    if (s === undoStack[undoPos]) return;
    undoStack.splice(undoPos + 1, Infinity, s);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    undoPos = undoStack.length - 1;
    history.replaceState(null, '', '#' + shareHash()); // URL = aktueller Stand → Reload/Link verliert nichts
}

// Share-Link: alle Save-Schlüssel im Hash (nicht nur Abweichungen → Links überleben geänderte Defaults)
function shareHash() {
    return new URLSearchParams({ version: SAVE_VERSION, ...pickParams(params) }).toString();
}
function applyHash() {
    const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
    if (!Object.keys(q).length || location.hash.slice(1) === shareHash()) return false;
    if ((+q.version || 1) < SAVE_VERSION) console.warn(`Link: Version ${q.version ?? 1} < ${SAVE_VERSION} — gleicher Seed, anderes Terrain`);
    applyPreset(pickParams(q));
    return true;
}
window.addEventListener('hashchange', applyHash); // Link in denselben Tab eingefügt → kein Reload
async function copyLink() {
    record();
    await navigator.clipboard.writeText(location.href);
}
function undoRedo(step) {
    record(); // noch nicht erfasste Änderung (entprellte Farbe) zuerst sichern, sonst springt Undo über sie
    const p = undoPos + step;
    if (p < 0 || p >= undoStack.length) return;
    undoPos = p;
    applyPreset(JSON.parse(undoStack[p])); // → runGenerate → record() findet denselben Stand, kein neuer Eintrag
}
window.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.target.tagName === 'INPUT') return; // in Eingabefeldern bleibt das Text-Undo des Browsers
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) undoRedo(-1);
    else if (k === 'y' || (k === 'z' && e.shiftKey)) undoRedo(1);
    else return;
    e.preventDefault();
});

// Seed-Vergleich (→ Plan/Roadmap.md R13): dieselbe Pipeline wie die große Map (Prepass 128² → Netz → Final-Pass),
// Final-Pass nur THUMB² — bei 128² (3 m/px) zerfallen 4-m-Straßen in Punkte
const THUMB = 256;
const COMPARE_COUNT = 12;
async function drawThumb(seed, canvas) {
    const p = { ...params, seed, maxH: autoMaxH(params) };
    const m = await computeMap(p, THUMB);
    const { slope: s, relief: rel } = slopeRelief(m.heights, THUMB, p.maxH);
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(THUMB, THUMB);
    colorize(img.data, THUMB, m.heights, m.roadMask, s, rel, p.maxH);
    ctx.putImageData(img, 0, 0);
}

// Export-Auflösung (→ Plan/Roadmap.md R7): RES = Original 1:1, 2ⁿ+1 = Unreal-Landscape-Größen (resample)
const EXPORT_SIZES = [RES, RES / 2 + 1, RES + 1, 2 * RES + 1];
let exportRes = RES;
const cellSize = n => MAP / (n === RES ? n : n - 1); // m zwischen zwei Samples (Pixelzentren bzw. Vertex-Gitter)

const panel = buildPanel(params, {
    change: scheduleGenerate,
    color: () => {
        setRoadColor();
        refreshView();
        clearTimeout(colorTimer);
        colorTimer = setTimeout(record, 400);
    },
    presets: Object.keys(ALL_PRESETS),
    preset: name => applyPreset(ALL_PRESETS[name]),
    save: saveSettings,
    load: () => loadInput.click(),
    link: copyLink,
    walk: () => walk.start(),
    compare: () => seedGrid(THUMB, COMPARE_COUNT, params.seed, drawThumb, s => {
        params.seed = s;
        panel.refresh();
        scheduleGenerate();
    }),
    exportSizes: EXPORT_SIZES,
    exportSize: n => { exportRes = n; },
    exports: {
        'Heightmap PNG (16-bit)': exportPng16,
        'Heightmap RAW (.r16)': exportR16,
        'Splatmap PNG (RGBA)': exportSplatmap,
        'Slope mask PNG': () => exportMask('slope'),
        'Normal map PNG': () => exportMask('normal'),
        'Curvature mask PNG': () => exportMask('curvature'),
        'Metadata JSON': exportMeta,
        '3D mesh glTF (.glb)': exportGlb,
        'Heightmap PNG (8-bit preview)': exportPng,
    },
    regenerate: runGenerate,
});
panel.guis.World.add(params, 'maxH').name('Max height (auto, m)').decimals(1).disable().listen();

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
}

// id: Dialog merkt sich den zuletzt gewählten Ordner (Projektordner vorwählen kann ein Browser nicht)
async function saveSettings() {
    const json = JSON.stringify({ version: SAVE_VERSION, ...pickParams(params) }, null, 2);
    const name = `heightmap-${params.seed}.json`;
    if (!window.showSaveFilePicker) return download(new Blob([json], { type: 'application/json' }), name);
    try {
        const file = await window.showSaveFilePicker({
            id: 'presets', suggestedName: name,
            types: [{ description: 'Terrain settings', accept: { 'application/json': ['.json'] } }],
        });
        const w = await file.createWritable();
        await w.write(json);
        await w.close();
    } catch (e) {
        if (e.name !== 'AbortError') console.error('Save:', e);
    }
}

const loadInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
loadInput.addEventListener('change', async () => {
    const f = loadInput.files[0];
    loadInput.value = ''; // sonst löst dieselbe Datei beim nächsten Mal kein change aus
    if (!f) return;
    try {
        const obj = JSON.parse(await f.text());
        const v = obj.version ?? 1;
        if (v < SAVE_VERSION) console.warn(`Load ${f.name}: Version ${v} < ${SAVE_VERSION} — gleicher Seed, anderes Terrain`);
        applyPreset(pickParams(obj));
    } catch (e) {
        console.error(`Load ${f.name}:`, e.message);
    }
});

// Graustufen-PNG der rohen Heightmap (0–1 → 0–255), 1:1 zu den Preview-Daten
function exportPng() {
    const c = document.createElement('canvas');
    c.width = RES;
    c.height = RES;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(RES, RES);
    const d = img.data;
    for (let i = 0; i < heights.length; i++) {
        const v = Math.min(Math.max(Math.round(heights[i] * 255), 0), 255);
        d[i * 4] = v;
        d[i * 4 + 1] = v;
        d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    c.toBlob(blob => download(blob, `heightmap-${params.seed}-8bit.png`), 'image/png');
}

async function exportPng16() {
    const n = exportRes;
    download(await encodePng(n, n, quantize16(resample(heights, RES, n)), 1, 16), `heightmap-${params.seed}-${n}-16bit.png`);
}

function exportR16() {
    const n = exportRes;
    download(new Blob([encodeR16(quantize16(resample(heights, RES, n)))], { type: 'application/octet-stream' }), `heightmap-${params.seed}-${n}.r16`);
}

// Splatmap RGBA: R Straße · G Fels · B Wasser + Ufer (bis zur Sand-Grenze der Farbrampe) · A Rest (Gras);
// Vorrang Straße > Wasser > Fels, Summe je Pixel = 255 (→ Plan/Export.md). Eingaben resamplen, nicht RGBA → Summe bleibt 255
async function exportSplatmap() {
    const n = exportRes, hs = resample(heights, RES, n), ms = resample(roadMask, RES, n), ss = resample(slope, RES, n);
    const px = new Uint8Array(n * n * 4), shore = STOPS[1][0];
    for (let i = 0; i < n * n; i++) {
        const h = hs[i] * params.maxH;
        const road = roadWeight(ms[i]);
        const wet = Math.min(Math.max(1 - (h - params.waterLevel) / shore, 0), 1);
        const water = (1 - road) * wet;
        const rock = (1 - road) * (1 - wet) * rockWeight(ss[i]); // (1 − wet), nicht (1 − water): sonst Summe > 1
        const R = Math.floor(road * 255), G = Math.floor(rock * 255), B = Math.floor(water * 255);
        px[i * 4] = R;
        px[i * 4 + 1] = G;
        px[i * 4 + 2] = B;
        px[i * 4 + 3] = 255 - R - G - B; // floor → Summe ≤ 255, A ≥ 0
    }
    download(await encodePng(n, n, px, 4, 8), `splatmap-${params.seed}-${n}.png`);
}

// Masken für Unreal (Neigung, Normale, Krümmung) auf dem Export-Gitter; Konvention in exportMeta (→ .clinerules/export.md)
function curvatureExport(n) {
    const c = curvature(resample(heights, RES, n), n, cellSize(n), params.maxH);
    return { c, scale: curvatureScale(c) };
}
async function exportMask(kind) {
    const n = exportRes;
    let px;
    if (kind === 'curvature') {
        const { c, scale } = curvatureExport(n);
        px = curvatureBytes(c, scale);
    } else {
        const g = gradient(resample(heights, RES, n), n, cellSize(n), params.maxH);
        px = kind === 'slope' ? slopeBytes(slopeDeg(g)) : normalBytes(normals(g));
    }
    download(await encodePng(n, n, px, kind === 'normal' ? 4 : 1, 8), `${kind}-${params.seed}-${n}.png`);
}

// Das angezeigte Mesh (TN², 1 Unit = 1 m, Mitte im Ursprung) + Farbtextur eingebettet (→ .clinerules/export.md).
// vereinfacht: immer TN² statt Export-Größe – 2049² wären ~250 MB Puffer im Browser
async function exportGlb() {
    const glb = await new GLTFExporter().parseAsync(terrain, { binary: true });
    download(new Blob([glb], { type: 'model/gltf-binary' }), `terrain-${params.seed}.glb`);
}

// Maßstab + Konvention für die Engine, dazu alle Einstellungen (Save-Format) → reproduzierbar
function exportMeta() {
    const n = exportRes, grid = n === RES;
    const meta = {
        version: SAVE_VERSION,
        mapSize: MAP,
        resolution: n,
        cellSize: cellSize(n),
        maxH: params.maxH,
        waterLevel: params.waterLevel,
        height: `height_m = value / 65535 * maxH (16-bit PNG; .r16 = raw uint16 little endian, no header); value / 255 * maxH (8-bit preview, always ${RES})`,
        pixels: (grid
            ? 'pixel (i, j) = map ((i + 0.5) / resolution * mapSize, (j + 0.5) / resolution * mapSize) (cell centres)'
            : 'pixel (i, j) = map (i / (resolution - 1) * mapSize, j / (resolution - 1) * mapSize) (vertices, first/last on the map edges)')
            + '; row j = map y (three.js +z)',
        curvatureScale: curvatureExport(n).scale, // m, je Map (→ masks.curvature)
        masks: {
            slope: 'slope_deg = value / 255 * 90 (8-bit gray, 0 = flat)',
            normal: 'tangent space, DirectX / Unreal ("green down"): n = rgb / 255 * 2 - 1, R = +column, G = +row, B = up; flip G for OpenGL / Blender',
            curvature: `height - mean height within ±${CURV_R} m; value = 128 + dev / curvatureScale * 127.5, clamped; curvatureScale = 99th percentile of |dev| of this map (bright = ridge, dark = hollow)`,
            import: 'masks are linear data: import without sRGB (Unreal: Masks / Linear Color; normal map: Normalmap compression)',
        },
        settings: pickParams(params),
    };
    download(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }), `heightmap-${params.seed}-${exportRes}-meta.json`);
}

if (!applyHash()) runGenerate();

const walk = createWalk(camera, renderer.domElement, controls, meshHeight, MAP / 2);
if (import.meta.env.DEV) Object.assign(window.dbg, { walk, erosion, readBuffer });

let lastT = 0;
renderer.setAnimationLoop(t => {
    const dt = Math.min((t - lastT) / 1000, 0.1); // Tab im Hintergrund → kein Sprung
    lastT = t;
    if (walk.active) walk.update(dt);
    else controls.update(); // update() prüft enabled nicht und würde lookAt(target) erzwingen
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
