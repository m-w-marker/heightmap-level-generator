import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPanel } from './ui.js';
import { encodePng } from './png.js';
import { quantize16, encodeR16, sampleBilinear, resample } from './export.js';
import WGSL from './heightmap.wgsl?raw';
import { generateRoads, MAX_ROADS, ROAD_POINTS } from './roadgen.js';
import { encodeUniforms, ROADS_OFFSET, autoMaxH } from './uniforms.js';

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

// Sonne ≈ 30° hoch + schwächeres Himmelslicht → Relief auch bei flachen Hügeln lesbar
scene.add(new THREE.HemisphereLight(0xbdd7ff, 0x3a4a33, 0.7));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.8);
sun.position.set(220, 150, 120);
scene.add(sun);

// --- M2: Compute-Pipeline + 2D-Preview (→ Plan/Build.md M2) ---
const RES = 1024;
const MAP = 400;

const params = {
    seed: 1337,
    baseLevel: 30,
    hillAmp: 8,
    hillWave: 120,
    hillRoughness: 0.5, // Oktaven-Gain: 0.25 glatt rollend … 0.65 zerklüftet
    mountainAmp: 60,
    mountainWave: 180,
    clusterWave: 220,
    mountainCoverage: 30,
    cliffDrop: 20,
    cliffWave: 90,
    cliffWidth: 15,
    cliffAreaWave: 160,
    cliffCoverage: 30,
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
    exitCount: 3,
    extraLinks: 2,
    reuse: 0.4,
};
const DEFAULTS = { ...params }; // Basis jedes Presets

const uniformsData = new Float32Array(ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS);

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

async function generate() {
    const t0 = performance.now();
    params.maxH = autoMaxH(params);

    // Prepass: 128² Roh-Terrain (ohne Straßen, mit Rand-Ring; die Randzone sperrt das Routing selbst)
    // → Routing-Daten für roadgen (→ Plan/PresetsAusfahrten.md)
    encodeUniforms({ ...params, mapSize: MAP, res: PRE, roadCount: 0 },
        new Float32Array(MAX_ROADS * ROAD_POINTS * 2), new Float32Array(MAX_ROADS * ROAD_POINTS), uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);
    dispatch(PRE);
    const pre = await readBuffer(heightBuf, PRE * PRE * 4);
    let gpuMs = performance.now() - t0; // Dispatch + Readback: Zeitstempel erst nach mapAsync, sonst nur Submit gemessen
    for (let i = 0; i < pre.length; i++) terrain128[i] = pre[i] * params.maxH;

    // Prepass-Konsole-Check (→ Plan/Roads.md S1): Min/Max ≈ Final-Pass
    let pMn = Infinity, pMx = -Infinity;
    for (const h of terrain128) {
        if (h < pMn) pMn = h;
        if (h > pMx) pMx = h;
    }
    console.log(`Prepass 128²: min ${pMn.toFixed(1)} m · max ${pMx.toFixed(1)} m`);

    const tr = performance.now();
    const { points: roads, levels, count, nodes } = generateRoads(params.seed, MAP, { size: PRE, data: terrain128 }, params);
    const roadMs = performance.now() - tr;
    console.log(`Road network: ${nodes.filter(n => !n.exit).length} towns · ${nodes.filter(n => n.exit).length} exits · ${count} roads · ${roadMs.toFixed(0)} ms`);
    const tg = performance.now();
    encodeUniforms({ ...params, mapSize: MAP, res: RES, roadCount: count }, roads, levels, uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);
    dispatch(RES);
    // Kopien laufen in Submit-Reihenfolge nach dem Dispatch
    [heights, roadMask] = await Promise.all([readBuffer(heightBuf, RES * RES * 4), readBuffer(roadMaskBuf, RES * RES * 4)]);
    gpuMs += performance.now() - tg;

    logStats(roads, levels, count);
    computeSlope();
    refreshView();
    const totalMs = performance.now() - t0;
    console.log(`Regeneration: ${totalMs.toFixed(0)} ms`);
    panel.status(`GPU ${gpuMs.toFixed(0)} ms · Roads ${roadMs.toFixed(0)} ms · Total ${totalMs.toFixed(0)} ms`);
}

function dispatch(res) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
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

// Preview + 3D-Mesh aus dem aktuellen Readback (auch bei reinem Farbwechsel, ohne Regeneration)
function refreshView() {
    updatePreview();
    if (terrain) {
        scene.remove(terrain);
        terrain.geometry.dispose();
    }
    terrain = buildTerrainMesh();
    scene.add(terrain);
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

// Aus dem Readback, einmal pro Regeneration (Kanten geclamped):
// slope = Hangneigung |∇h| in m/m (zentrale Differenzen); relief = Höhe − Mittel im Abstand RELIEF_R in m
// (> 0 Kuppe, < 0 Mulde) → Farbe heller/dunkler, macht flache Hügel lesbar
const RELIEF_R = 24; // px ≈ 9 m
let slope = new Float32Array(RES * RES);
let relief = new Float32Array(RES * RES);
function computeSlope() {
    const px = MAP / RES, k = params.maxH / (2 * px), H = params.maxH;
    const at = (x, y) => heights[Math.min(Math.max(y, 0), RES - 1) * RES + Math.min(Math.max(x, 0), RES - 1)];
    for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
        const gx = (at(x + 1, y) - at(x - 1, y)) * k;
        const gy = (at(x, y + 1) - at(x, y - 1)) * k;
        slope[y * RES + x] = Math.hypot(gx, gy);
        const avg = (at(x - RELIEF_R, y) + at(x + RELIEF_R, y) + at(x, y - RELIEF_R) + at(x, y + RELIEF_R)) / 4;
        relief[y * RES + x] = (at(x, y) - avg) * H;
    }
}

function updatePreview() {
    const d = pimg.data;
    for (let i = 0; i < RES * RES; i++) {
        terrainColor(d, i * 4, heights[i] * params.maxH, roadMask[i], slope[i], relief[i]);
        d[i * 4 + 3] = 255;
    }
    pctx.putImageData(pimg, 0, 0);
}

// --- M4: 3D-Terrain (→ Plan/Build.md M4) ---
const TN = 512; // Vertex je Kante; 1 Unit = 1 m
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
let terrain = null;

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function buildTerrainMesh() {
    const pos = new Float32Array(TN * TN * 3);
    const col = new Float32Array(TN * TN * 3);
    const idx = new Uint32Array((TN - 1) * (TN - 1) * 6);
    for (let j = 0; j < TN; j++) {
        for (let i = 0; i < TN; i++) {
            const o = (j * TN + i) * 3;
            const u = i / (TN - 1), v = j / (TN - 1);
            pos[o] = -MAP / 2 + u * MAP;
            pos[o + 1] = sampleBilinear(heights, RES, u, v) * params.maxH;
            pos[o + 2] = -MAP / 2 + v * MAP;
            terrainColor(col, o, pos[o + 1], sampleBilinear(roadMask, RES, u, v), sampleBilinear(slope, RES, u, v), sampleBilinear(relief, RES, u, v));
            // Vertex-Farben liest three als linear → sRGB-Rampe umrechnen, sonst doppelt aufgehellt (blass)
            col[o] = srgbToLinear(col[o] / 255);
            col[o + 1] = srgbToLinear(col[o + 1] / 255);
            col[o + 2] = srgbToLinear(col[o + 2] / 255);
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
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, terrainMat);
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
    'Rolling hills': { hillAmp: 9, hillWave: 90, hillRoughness: 0.35, mountainAmp: 25, mountainWave: 200, clusterWave: 250,
        mountainCoverage: 25, cliffDrop: 5, cliffWidth: 20, cliffCoverage: 10, rimAmp: 35, rimZone: 60,
        townCount: 6, townSpacing: 70, extraLinks: 3, roadSlopeVar: 15 },
    'Pasture': { baseLevel: 25, hillAmp: 4, hillWave: 100, hillRoughness: 0.3, mountainAmp: 0, mountainCoverage: 0,
        cliffDrop: 0, cliffCoverage: 0, rimAmp: 25, rimZone: 70, rimWave: 120, townCount: 4, townSpacing: 90, extraLinks: 1 },
    'Mountains': { baseLevel: 25, hillAmp: 12, hillRoughness: 0.6, mountainAmp: 100, mountainWave: 200, clusterWave: 260,
        mountainCoverage: 45, cliffDrop: 15, cliffCoverage: 15, rimAmp: 70, rimZone: 60,
        townCount: 4, townSpacing: 60, slopePenalty: 7, extraLinks: 1 },
    'Canyon / Plateaus': { baseLevel: 45, hillAmp: 3, hillRoughness: 0.35, mountainAmp: 0, mountainCoverage: 0,
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

// Export-Auflösung (→ Plan/Roadmap.md R7): RES = Original 1:1, 2ⁿ+1 = Unreal-Landscape-Größen (resample)
const EXPORT_SIZES = [RES, RES / 2 + 1, RES + 1, 2 * RES + 1];
let exportRes = RES;

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
    exportSizes: EXPORT_SIZES,
    exportSize: n => { exportRes = n; },
    exports: {
        'Heightmap PNG (16-bit)': exportPng16,
        'Heightmap RAW (.r16)': exportR16,
        'Splatmap PNG (RGBA)': exportSplatmap,
        'Metadata JSON': exportMeta,
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

// Maßstab + Konvention für die Engine, dazu alle Einstellungen (Save-Format) → reproduzierbar
function exportMeta() {
    const n = exportRes, grid = n === RES;
    const meta = {
        version: SAVE_VERSION,
        mapSize: MAP,
        resolution: n,
        cellSize: MAP / (grid ? n : n - 1), // m zwischen zwei Samples
        maxH: params.maxH,
        waterLevel: params.waterLevel,
        height: `height_m = value / 65535 * maxH (16-bit PNG; .r16 = raw uint16 little endian, no header); value / 255 * maxH (8-bit preview, always ${RES})`,
        pixels: (grid
            ? 'pixel (i, j) = map ((i + 0.5) / resolution * mapSize, (j + 0.5) / resolution * mapSize) (cell centres)'
            : 'pixel (i, j) = map (i / (resolution - 1) * mapSize, j / (resolution - 1) * mapSize) (vertices, first/last on the map edges)')
            + '; row j = map y (three.js +z)',
        settings: pickParams(params),
    };
    download(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }), `heightmap-${params.seed}-${exportRes}-meta.json`);
}

if (!applyHash()) runGenerate();

renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
